import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

// ── Juegos que se juegan en el server ──────────────────────────────
// Discord NO expone por API los "Server Insights" ni el panel de "Juegos
// jugados" del servidor. Lo que sí da el Gateway es `presenceUpdate`, así que
// el bot acumula acá lo que ve: quién está jugando qué, por día.

const DAY_MS = 24 * 60 * 60 * 1000;
// El lote del bot no debería ser grande; el techo es por las dudas.
const MAX_ENTRIES_PER_REPORT = 500;
const MAX_GAMES = 24;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const COVERS_TTL_MS = 24 * 60 * 60 * 1000;
const COVERS_RETRY_MS = 10 * 60 * 1000;

// Herramientas que Discord detecta como "está jugando" y no son juegos (mod
// managers, launchers, editores) y entradas que no se quieren mostrar: la
// presencia reporta un id viejo del mismo juego sin portada al lado del bueno
// (SCP: Discord tiene los dos), y dos tarjetas iguales en la grilla confunden.
// Se filtran al mostrar, no al guardar: la actividad queda en la base y sacarlas
// de acá las devuelve a la grilla.
const NON_GAME_APPLICATIONS = new Set([
  "adobe after effects",
  "adobe photoshop",
  "adobe premiere pro",
  "blender",
  "curseforge",
  "davinci resolve",
  "discord",
  "epic games launcher",
  "godot engine",
  "medal",
  "obs studio",
  "overwolf",
  "scp secret laboratory",
  "steam",
  "unity",
  "unreal engine",
  "visual studio code",
  "wallpaper engine",
]);

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
  byId: Map<string, string>;
  // La portada por nombre guarda también el id de Discord: el CDN arma la URL
  // con el id de la app, así que el id reportado por la presencia no sirve.
  byName: Map<string, { hash: string; id: string }>;
  expiresAt: number;
  iconsById: Map<string, string>;
};

// Día UTC (YYYY-MM-DD): el bot manda cambios de presencia, no fechas.
export function activityDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// El nombre es lo único que tenemos de la app que no está en la lista de
// Discord, así que la blacklist compara normalizado (espacios dobles, mayúsculas).
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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
// índice en memoria, así que el dashboard no depende de Discord por request.
//
// Se buscan tres cosas en orden, porque no todas las apps están cargadas igual:
// la portada por id, la portada por nombre (Discord tiene ids viejos y nuevos
// para el mismo juego) y, si no hay portada, el icono de la app.
let covers: CoverHashes | null = null;
let coversInFlight: Promise<CoverHashes> | null = null;

async function fetchCoverHashes(): Promise<CoverHashes> {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const empty: CoverHashes = {
    byId: new Map<string, string>(),
    byName: new Map<string, { hash: string; id: string }>(),
    expiresAt: 0,
    iconsById: new Map<string, string>(),
  };
  let next = empty;
  try {
    const response = await fetch(`${DISCORD_API_BASE}/applications/detectable`, {
      headers: token ? { authorization: `Bot ${token}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`detectable respondió ${response.status}`);
    }
    const applications = (await response.json()) as {
      aliases?: string[] | null;
      cover_image_hash?: string | null;
      icon_hash?: string | null;
      id?: string;
      name?: string;
    }[];
    next = { ...empty, expiresAt: Date.now() + COVERS_TTL_MS };
    for (const application of applications) {
      if (!application.id) {
        continue;
      }
      // El nombre puede repetirse (ids viejos y nuevos del mismo juego): gana
      // la primera app que tenga portada.
      if (application.cover_image_hash) {
        next.byId.set(application.id, application.cover_image_hash);
        for (const alias of [application.name, ...(application.aliases ?? [])]) {
          const key = normalizeName(String(alias ?? ""));
          if (key && !next.byName.has(key)) {
            next.byName.set(key, {
              hash: application.cover_image_hash,
              id: application.id,
            });
          }
        }
      }
      if (application.icon_hash) {
        next.iconsById.set(application.id, application.icon_hash);
      }
    }
    covers = next;
  } catch {
    // Sin lista no hay portadas, pero los juegos se muestran igual. Si había
    // una lista vieja, se conserva y se reintenta dentro de un rato.
    covers = {
      ...(covers ?? empty),
      expiresAt: Date.now() + COVERS_RETRY_MS,
    };
    return covers;
  }
  return next;
}

function refreshCoverHashes(): Promise<CoverHashes> {
  coversInFlight ??= fetchCoverHashes().finally(() => {
    coversInFlight = null;
  });
  return coversInFlight;
}

function loadCoverHashes(): Promise<CoverHashes> {
  if (covers && covers.expiresAt > Date.now()) {
    return Promise.resolve(covers);
  }
  if (covers) {
    // Vencida: se devuelve la que hay y se refresca en segundo plano, para no
    // clavar el request del dashboard esperando un JSON de 13 MB.
    void refreshCoverHashes();
    return Promise.resolve(covers);
  }
  return refreshCoverHashes();
}

// Portada de la app; si Discord no le cargó ninguna, cae al icono (antes que
// dejar la tarjeta vacía). Devuelve undefined si la app no está en la lista.
function resolveApplicationImage(
  applicationId: string,
  applicationName: string,
  index: CoverHashes,
): string | undefined {
  const imageUrl = (id: string, hash: string): string =>
    `https://cdn.discordapp.com/app-icons/${id}/${hash}.png?size=256`;

  const cover = index.byId.get(applicationId);
  if (cover) {
    return imageUrl(applicationId, cover);
  }
  // La app de la presencia no está en la lista (Discord tiene ids viejos y
  // nuevos del mismo juego): sirve la portada de la que sí está.
  const byName = index.byName.get(normalizeName(applicationName));
  if (byName) {
    return imageUrl(byName.id, byName.hash);
  }
  const icon = index.iconsById.get(applicationId);
  return icon ? imageUrl(applicationId, icon) : undefined;
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
    .filter(([, entry]) => !NON_GAME_APPLICATIONS.has(normalizeName(entry.name)))
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

  const index = await loadCoverHashes();
  return games.map((game) => ({
    ...game,
    coverUrl: game.applicationId
      ? resolveApplicationImage(game.applicationId, game.name, index)
      : undefined,
  }));
}
