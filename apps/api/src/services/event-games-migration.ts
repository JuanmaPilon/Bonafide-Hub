import { prisma } from "../db/prisma.js";
import { EVENT_TEMPLATES } from "./event-templates.js";
import {
  normalizeEventGames,
  normalizeEventRoles,
  type EventGameConfig,
} from "./guild-config-store.js";

// ── Migración: roles globales → roles por juego ─────────────────────
// Antes del "juego por evento", la guild tenía UNA sola lista de roles
// (`GuildConfig.eventRoles`) para todos los eventos. Ahora cada juego tiene la
// suya (`GuildConfig.eventGames`) y los eventos eligen un juego.
//
// Para no perder una configuración de roles hecha a mano, al arrancar el API
// miramos las configs que todavía no tienen `eventGames` y guardamos sus roles
// viejos como el juego que corresponda:
//
//   - si las claves coinciden con una plantilla (tank/healer/melee/ranged →
//     WoW; top/jungle/mid/adc/support → LoL) queda como ese juego;
//   - si no coinciden con ninguna, queda como el juego "custom" para que el
//     staff lo vea en el panel y lo ubique donde quiera.
//
// Es idempotente: si `eventGames` ya tiene datos, no toca nada.
export async function migrateLegacyEventRoles(): Promise<void> {
  const records = await prisma.guildConfig.findMany({
    select: { eventGames: true, eventRoles: true, guildId: true },
  });

  for (const record of records) {
    // Ya configurado (o ya migrado): nada que hacer.
    if ((normalizeEventGames(record.eventGames) ?? []).length > 0) {
      continue;
    }
    const legacy = normalizeEventRoles(record.eventRoles) ?? [];
    if (legacy.length === 0) {
      continue;
    }

    const legacyKeys = new Set(legacy.map((role) => role.key));
    const template = EVENT_TEMPLATES.find((entry) => {
      const templateKeys = new Set(entry.roles.map((role) => role.key));
      // Mismo conjunto de claves (sin importar el orden): ese es el juego.
      return (
        entry.roles.length === legacy.length &&
        entry.roles.every((role) => legacyKeys.has(role.key)) &&
        [...legacyKeys].every((key) => templateKeys.has(key))
      );
    });

    const game: EventGameConfig = template
      ? { key: template.key, label: template.label, roles: legacy }
      : { key: "custom", label: "Personalizado", roles: legacy };

    await prisma.guildConfig.update({
      where: { guildId: record.guildId },
      data: { eventGames: [game] },
    });

    console.log(
      `[eventos] roles viejos migrados a los juegos de la guild ${record.guildId} (juego: ${game.key}, ${legacy.length} roles)`,
    );
  }
}
