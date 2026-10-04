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
const COVERS_TTL_MS = 24 * 60 * 60 * 1000;
const COVERS_RETRY_MS = 10 * 60 * 1000;

export type GameActivityEntry = {
  applicationId: string;
  applicationName: string;
  userId: string;
};

export type GuildGameActivity = {
  applicationId?: string;
  // Portada del juego (cover_image_hash de la aplicación, servida por Discord).
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

type CoverHashes = {
  hashes: Map<string, string>;
  expiresAt: number;
};

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

// Portadas. `GET /applications/{id}` no sirve: Discord lo cerró (401 sin auth,
// 403 con token de bot). La única vía abierta es `GET /applications/detectable`,
// la lista de apps que Discord reconoce, que trae `cover_image_hash` por app;
// el CDN la sirve en app-icons. Es UN request de ~13 MB cada 24 h y se arma un
// índice id -> hash, así que el dashboard no depende de Discord por request.
let covers: CoverHashes | null = null;
let coversInFlight: Promise<Map<string, string>> | null = null;

async function fetchCoverHashes(): Promise<Map<string, string>> {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const hashes = new Map<string, string>();
  try {
    const response = await fetch(`${DISCORD_API_BASE}/applications/detectable`, {
      headers: token ? { authorization: `Bot ${token}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`detectable respondió ${response.status}`);
    }
    const applications = (await response.json()) as {
      cover_image_hash?: string | null;
      id?: string;
    }[];
    for (const application of applications) {
      if (application.id && application.cover_image_hash) {
        hashes.set(application.id, application.cover_image_hash);
      }
    }
    covers = { expiresAt: Date.now() + COVERS_TTL_MS, hashes };
  } catch {
    // Sin lista no hay portadas, pero los juegos se muestran igual. Si había
    // una lista vieja, se conserva y se reintenta dentro de un rato.
    covers = {
      expiresAt: Date.now() + COVERS_RETRY_MS,
      hashes: covers?.hashes ?? hashes,
    };
  }
  return covers.hashes;
}

function refreshCoverHashes(): Promise<Map<string, string>> {
  coversInFlight ??= fetchCoverHashes().finally(() => {
    coversInFlight = null;
  });
  return coversInFlight;
}

function loadCoverHashes(): Promise<Map<string, string>> {
  if (covers && covers.expiresAt > Date.now()) {
    return Promise.resolve(covers.hashes);
  }
  if (covers) {
    // Vencida: se devuelve la que hay y se refresca en segundo plano, para no
    // clavar el request del dashboard esperando un JSON de 13 MB.
    void refreshCoverHashes();
    return Promise.resolve(covers.hashes);
  }
  return refreshCoverHashes();
}

async function resolveApplicationCover(
  applicationId: string,
): Promise<string | undefined> {
  const hash = (await loadCoverHashes()).get(applicationId);
  return hash
    ? `https://cdn.discordapp.com/app-icons/${applicationId}/${hash}.png?size=256`
    : undefined;
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
