import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

// Registro central de vínculos entre una entidad de la app (un rango del
// roster, una clase, lo que se sume después) y su rol/emoji en Discord. El
// catálogo de entidades vive en el código; acá solo se guarda la elección de la
// guild, así todos los módulos leen el mismo mapeo.
export type MappingEmoji = {
  animated?: boolean;
  emojiId?: string;
  emojiName?: string;
  unicode?: string;
};

export type GuildMapping = {
  emoji?: MappingEmoji;
  key: string;
  roleId?: string;
};

// Tope defensivo: el catálogo real es mucho más chico.
const MAX_MAPPINGS = 200;

// Emoji custom de Discord (id + nombre) o unicode. Sin ninguno de los dos no
// hay emoji mapeado.
function normalizeEmoji(value: unknown): MappingEmoji | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const emojiId = String(raw.emojiId ?? "").trim();
  if (/^\d{5,}$/.test(emojiId)) {
    return {
      animated: Boolean(raw.animated),
      emojiId,
      emojiName: String(raw.emojiName ?? "").trim() || "emoji",
    };
  }
  const unicode = String(raw.unicode ?? "")
    .trim()
    .slice(0, 8);
  return unicode ? { unicode } : undefined;
}

// El rol se guarda solo si es un snowflake; cualquier otra cosa es "sin rol".
function normalizeRoleId(value: unknown): string | undefined {
  const roleId = String(value ?? "").trim();
  return /^\d{5,}$/.test(roleId) ? roleId : undefined;
}

export async function listGuildMappings(
  guildId: string,
): Promise<Map<string, GuildMapping>> {
  const records = await prisma.guildMapping.findMany({ where: { guildId } });
  return new Map(
    records.map((record) => [
      record.key,
      {
        emoji: normalizeEmoji(record.emoji),
        key: record.key,
        roleId: normalizeRoleId(record.roleId),
      },
    ]),
  );
}

// Reemplaza los mapeos de la guild por los que llegan. Una entidad sin rol y
// sin emoji se borra, así no queda basura de lo que ya no se mapea.
export async function saveGuildMappings(
  guildId: string,
  mappings: GuildMapping[],
): Promise<void> {
  const clean = mappings
    .slice(0, MAX_MAPPINGS)
    .map((mapping) => ({
      emoji: normalizeEmoji(mapping.emoji),
      key: String(mapping.key ?? "")
        .trim()
        .slice(0, 80),
      roleId: normalizeRoleId(mapping.roleId),
    }))
    .filter((mapping) => mapping.key.length > 0);

  // Un payload vacío borraría TODOS los mapeos: `notIn: []` no filtra nada y el
  // deleteMany se lleva la tabla entera. La web siempre manda el catálogo
  // completo, así que llegar vacío es un bug del cliente, no una intención.
  if (clean.length === 0) {
    throw new Error("No llegó ningún mapeo para guardar.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.guildMapping.deleteMany({
      where: { guildId, key: { notIn: clean.map((mapping) => mapping.key) } },
    });
    for (const mapping of clean) {
      if (!mapping.roleId && !mapping.emoji) {
        await tx.guildMapping.deleteMany({
          where: { guildId, key: mapping.key },
        });
        continue;
      }
      const data = {
        emoji: mapping.emoji
          ? (mapping.emoji as Prisma.InputJsonValue)
          : Prisma.DbNull,
        roleId: mapping.roleId ?? null,
      };
      await tx.guildMapping.upsert({
        create: { guildId, key: mapping.key, ...data },
        update: data,
        where: { guildId_key: { guildId, key: mapping.key } },
      });
    }
  });
}
