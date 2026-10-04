import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { DISCORD_API_BASE } from "./discord-cdn.js";

// ── Juegos que se juegan en el server ──────────────────────────────
// Discord NO expone por API los "Server Insights" (ese panel donde se ven los
// juegos del servidor). Lo que sí da el Gateway es `presenceUpdate`, así que el
// bot acumula acá lo que ve: quién está jugando qué, por día.

const DAY_MS = 24 * 60 * 60 * 1000;
// El lote del bot no debería ser grande; el techo es por las dudas.
const MAX_ENTRIES_PER_REPORT = 500;
const MAX_GAMES = 12;
const ICON_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ICON_FAIL_TTL_MS = 10 * 60 * 1000;

export type GameActivityEntry = {
  applicationId: string;
  applicationName: string;
  userId: string;
};

export type GuildGameActivity = {
  applicationId?: string;
  // Días distintos con actividad registrada.
  days: number;
  iconUrl?: string;
  name: string;
  // Jugadores distintos que aparecieron jugándolo.
  players: number;
};

type ActivityRow = {
  applicationId?: string | null;
  applicationName: string;
  day: string;
  userId: string;
};

const iconCache = new Map<string, { expiresAt: number; iconUrl?: string }>();

// Día UTC (YYYY-MM-DD): el bot manda cambios de presencia, no fechas.
export function activityDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Guarda el lote que manda el bot. El upsert por (guild, persona, app, día) es
// lo que mantiene la tabla chica: un juego visto 200 veces en un día es 1 fila.
export async function recordGameActivity(
  guildId: string,
  entries: GameActivityEntry[],
): Promise<number> {
  const day = activityDay();
  const batch = new Map<string, GameActivityEntry>();
  for (const entry of entries.slice(0, MAX_ENTRIES_PER_REPORT)) {
    const applicationId = entry?.applicationId?.trim();
    const applicationName = entry?.applicationName?.trim();
    const userId = entry?.userId?.trim();
    if (!applicationId || !applicationName || !userId) {
      continue;
    }
    batch.set(`${userId}:${applicationId}`, {
      applicationId,
      applicationName,
      userId,
    });
  }
  if (batch.size === 0) {
    return 0;
  }

  const operations = [...batch.values()].map((entry) =>
    prisma.memberGameActivity.upsert({
      create: {
        applicationId: entry.applicationId,
        applicationName: entry.applicationName,
        day,
        guildId,
        userId: entry.userId,
      },
      update: { applicationName: entry.applicationName },
      where: {
        guildId_userId_applicationId_day: {
          applicationId: entry.applicationId,
          day,
          guildId,
          userId: entry.userId,
        },
      },
    }),
  );
  await prisma.$transaction(operations);
  return operations.length;
}

// Icono del juego: la actividad trae el applicationId de Discord, y con eso se
// llega al icono de la aplicación en su CDN. Se cachea: un juego nuevo = 1
// request, el resto sale de memoria.
async function resolveApplicationIcon(
  applicationId: string,
): Promise<string | undefined> {
  const cached = iconCache.get(applicationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.iconUrl;
  }

  const token = env.DISCORD_BOT_TOKEN?.trim();
  let iconUrl: string | undefined;
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${encodeURIComponent(applicationId)}`,
      {
        headers: token
          ? { accept: "application/json", authorization: `Bot ${token}` }
          : { accept: "application/json" },
      },
    );
    if (response.ok) {
      const application = (await response.json()) as { icon?: string | null };
      if (application.icon) {
        iconUrl = `https://cdn.discordapp.com/app-icons/${applicationId}/${application.icon}.png?size=128`;
      }
    }
  } catch {
    // Sin icono la web cae a la tarjeta con el nombre.
  }

  iconCache.set(applicationId, {
    expiresAt: Date.now() + (iconUrl ? ICON_CACHE_TTL_MS : ICON_FAIL_TTL_MS),
    iconUrl,
  });
  return iconUrl;
}

export async function listGuildGameActivity(input: {
  days: number;
  guildId: string;
}): Promise<GuildGameActivity[]> {
  const since = activityDay(
    new Date(Date.now() - (input.days - 1) * DAY_MS),
  );
  const rows = (await prisma.memberGameActivity.findMany({
    select: {
      applicationId: true,
      applicationName: true,
      day: true,
      userId: true,
    },
    where: { day: { gte: since }, guildId: input.guildId },
  })) as ActivityRow[];

  const byApplication = new Map<
    string,
    { activeDays: Set<string>; name: string; players: Set<string> }
  >();
  for (const row of rows) {
    const applicationId = row.applicationId;
    if (!applicationId) {
      continue;
    }
    const entry = byApplication.get(applicationId) ?? {
      activeDays: new Set<string>(),
      name: row.applicationName,
      players: new Set<string>(),
    };
    // El nombre puede cambiar del lado de Discord: vale el último visto.
    entry.name = row.applicationName;
    entry.activeDays.add(row.day);
    entry.players.add(row.userId);
    byApplication.set(applicationId, entry);
  }

  const games: GuildGameActivity[] = [...byApplication.entries()]
    .map(([applicationId, entry]) => ({
      applicationId,
      days: entry.activeDays.size,
      name: entry.name,
      players: entry.players.size,
    }))
    .sort(
      (a, b) =>
        b.players - a.players ||
        b.days - a.days ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_GAMES);

  const icons = await Promise.all(
    games.map((game) => resolveApplicationIcon(game.applicationId ?? "")),
  );
  return games.map((game, index) => ({ ...game, iconUrl: icons[index] }));
}
