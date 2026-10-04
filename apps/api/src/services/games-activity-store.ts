import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

// ── Juegos que se juegan en el server ──────────────────────────────
// Discord NO expone por API los "Server Insights" ni el panel de "Juegos
// jugados" del servidor. Lo que sí da el Gateway es `presenceUpdate`, así que
// el bot acumula acá lo que ve: quién está jugando qué, por día.

const DAY_MS = 24 * 60 * 60 * 1000;
// El lote del bot no debería ser grande; el techo es por las dudas.
const MAX_ENTRIES_PER_REPORT = 500;
const MAX_GAMES = 12;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const COVER_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const COVER_FAIL_TTL_MS = 10 * 60 * 1000;

export type GameActivityEntry = {
  applicationId: string;
  applicationName: string;
  userId: string;
};

export type GuildGameActivity = {
  applicationId?: string;
  // Portada del juego (cover_image de la aplicación, servida por Discord).
  coverUrl?: string;
  // Días distintos con actividad registrada.
  days: number;
  name: string;
  // Jugadores distintos que aparecieron jugándolo. Ordena la lista.
  players: number;
};

type ActivityRow = {
  applicationId?: string | null;
  applicationName: string;
  day: string;
  userId: string;
};

const coverCache = new Map<string, { coverUrl?: string; expiresAt: number }>();

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

// Portada del juego. `GET /applications/{id}` es público y devuelve
// `cover_image` (el hash de la portada que Discord muestra en su panel de
// "Juegos jugados"); el CDN la sirve en app-icons. Se cachea por app —también
// los fallos— para que el dashboard no dependa de Discord en cada request.
async function resolveApplicationCover(
  applicationId: string,
): Promise<string | undefined> {
  const cached = coverCache.get(applicationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.coverUrl;
  }

  const token = env.DISCORD_BOT_TOKEN?.trim();
  let coverUrl: string | undefined;
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${encodeURIComponent(applicationId)}`,
      {
        headers: token
          ? { accept: "application/json", authorization: `Bot ${token}` }
          : { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.ok) {
      const application = (await response.json()) as {
        cover_image?: string | null;
      };
      if (application.cover_image) {
        coverUrl = `https://cdn.discordapp.com/app-icons/${applicationId}/${application.cover_image}.png?size=256`;
      }
    }
  } catch {
    // Sin portada la tarjeta queda con el nombre.
  }

  coverCache.set(applicationId, {
    coverUrl,
    expiresAt: Date.now() + (coverUrl ? COVER_CACHE_TTL_MS : COVER_FAIL_TTL_MS),
  });
  return coverUrl;
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

  const covers = await Promise.all(
    games.map((game) =>
      game.applicationId
        ? resolveApplicationCover(game.applicationId)
        : Promise.resolve(undefined),
    ),
  );
  return games.map((game, index) => ({ ...game, coverUrl: covers[index] }));
}
