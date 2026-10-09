import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

export type RaidFightSummary = {
  // Id de encuentro de Warcraft Logs: es la identidad del boss, porque el
  // NOMBRE cambia con el idioma del cliente que subió el log ("The Coiled Altar"
  // vs "El Altar Serpenteante").
  boss?: number;
  difficulty?: number;
  fightPercentage?: number;
  kill?: boolean;
  name?: string;
  // Hora absoluta del pull (epoch ms): identifica el pull entre reports. Dos
  // personas loggeando la misma raid traen los mismos pulls con unos segundos de
  // diferencia.
  start?: number;
};

export type RaidLog = {
  createdAt: Date;
  discordChannelId?: string;
  discordMessageId?: string;
  discordPosted: boolean;
  error?: string;
  fightCount: number;
  firstFightAt?: Date;
  // Desde cuándo el report no cambia (null = cambió en la última consulta).
  fightsStableSince?: Date;
  // Clave de la entrada a la que pertenece: los reports de la misma noche y
  // con el mismo título se publican juntos (una subida en dos partes = 1 log).
  groupKey: string;
  guildId: string;
  hidden: boolean;
  id: string;
  kills: number;
  lastSyncedAt?: Date;
  // La entrada está publicada pero el mensaje quedó viejo; requiere actualizarla.
  needsUpdate?: boolean;
  // Texto que se publicó en Discord: se compara con el recién generado para
  // editar el mensaje SOLO si cambió.
  postedMessageText?: string;
  previousFightCount?: number;
  reportCode: string;
  // Cuándo se publicó el informe de la noche en Discord (undefined = falta).
  reportPostedAt?: Date;
  reportUrl: string;
  status: string;
  summary?: {
    fights: RaidFightSummary[];
    title?: string;
    zone?: number | null;
  };
  title?: string;
  updatedAt: Date;
  zone?: number | null;
  // Nombre de la zona (la raid): lo llena el refresh con el catálogo de
  // Warcraft Logs, así la lista no tiene que consultarlo.
  zoneName?: string;
};

type WclFight = {
  boss?: number;
  difficulty?: number;
  end_time?: number;
  fightPercentage?: number;
  id?: number;
  kill?: boolean;
  name?: string;
  start_time?: number;
};

type WclReport = {
  fights?: WclFight[];
  start?: number;
  title?: string;
  zone?: number;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toRaidLog(record: {
  createdAt: Date;
  discordChannelId: string | null;
  discordMessageId: string | null;
  discordPosted: boolean;
  error: string | null;
  fightCount: number;
  firstFightAt: Date | null;
  fightsStableSince: Date | null;
  guildId: string;
  hidden: boolean;
  id: string;
  kills: number;
  lastSyncedAt: Date | null;
  postedMessageText: string | null;
  previousFightCount: number;
  reportCode: string;
  reportPostedAt: Date | null;
  reportUrl: string;
  status: string;
  summary: unknown;
  title: string | null;
  updatedAt: Date;
  zone: number | null;
  zoneName: string | null;
}): RaidLog {
  const rawSummary = record.summary;
  const summary =
    rawSummary && typeof rawSummary === "object" && !Array.isArray(rawSummary)
      ? (rawSummary as {
          fights?: RaidFightSummary[];
          title?: string;
          zone?: number | null;
        })
      : undefined;

  return {
    createdAt: record.createdAt,
    discordChannelId: record.discordChannelId ?? undefined,
    discordMessageId: record.discordMessageId ?? undefined,
    discordPosted: record.discordPosted,
    error: record.error ?? undefined,
    fightCount: record.fightCount,
    firstFightAt: record.firstFightAt ?? undefined,
    fightsStableSince: record.fightsStableSince ?? undefined,
    groupKey: raidLogGroupKey({
      firstFightAt: record.firstFightAt,
      reportCode: record.reportCode,
    }),
    guildId: record.guildId,
    hidden: record.hidden,
    id: record.id,
    kills: record.kills,
    lastSyncedAt: record.lastSyncedAt ?? undefined,
    needsUpdate: false,
    postedMessageText: record.postedMessageText ?? undefined,
    previousFightCount: record.previousFightCount,
    reportCode: record.reportCode,
    reportPostedAt: record.reportPostedAt ?? undefined,
    reportUrl: record.reportUrl,
    status: record.status,
    summary: summary
      ? {
          fights: summary.fights ?? [],
          title: summary.title,
          zone: summary.zone,
        }
      : undefined,
    title: record.title ?? undefined,
    updatedAt: record.updatedAt,
    zone: record.zone,
    zoneName: record.zoneName ?? undefined,
  };
}

// Clave de "noche de raid": la fecha, sin el título. El título lo escribe quien
// sube el log, así que dos personas loggeando la MISMA raid quedaban en dos
// entradas (una con más bosses que la otra) y sus fights, kills y pulls se
// contaban dos veces en el tablero. La fecha se corre 6 horas para que una raid
// que cruza la medianoche no se parta en dos entradas (21:00 AR = 00:00 UTC del
// día siguiente).
export function raidLogGroupKey(log: {
  firstFightAt?: Date | null;
  reportCode: string;
}): string {
  if (!log.firstFightAt) {
    // Todavía no sabemos de qué noche es (el report no se refrescó): va solo,
    // y se une a la noche cuando el refresh le traiga la fecha.
    return `code:${log.reportCode}`;
  }
  const nightKey = new Date(log.firstFightAt.getTime() - 6 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `night:${nightKey}`;
}

// Extrae el código de un link de Warcraft Logs (o acepta el código suelto).
export function extractReportCode(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/reports\/([A-Za-z0-9]{8,32})/);
  if (match) {
    return match[1];
  }
  if (/^[A-Za-z0-9]{8,32}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

// Consulta los fights de un report usando la API v1 oficial de Warcraft
// Logs (con API key). Usamos la v1 en lugar del endpoint público de la
// página (/report/fights/{code}) porque ese endpoint pasa por el challenge
// anti-bot de Cloudflare, que bloquea las requests desde IPs de datacenter
// (Railway) con 404 aunque el report sea público.
async function fetchWclReport(code: string): Promise<WclReport> {
  const data = (await fetchWarcraftLogsV1Json(
    `/report/fights/${encodeURIComponent(code)}`,
  )) as WclReport;

  if (!data || typeof data !== "object") {
    throw new Error(`El report ${code} no devolvió datos de Warcraft Logs.`);
  }

  return data;
}

// Reduce el report a lo que nos interesa: fights de boss, kills, título.
function summarize(report: WclReport): {
  fights: RaidFightSummary[];
  title?: string;
  zone?: number | null;
} {
  // Solo fights de boss reales (boss > 0). Trash con nombre (p. ej.
  // "Radian Spellower", "Venomfang Juggernaut") tiene boss=0 y se excluye.
  const reportStart = typeof report.start === "number" ? report.start : null;
  const fights = (report.fights ?? [])
    .filter((fight) => (fight.boss ?? 0) > 0)
    .map((fight) => ({
      boss: fight.boss,
      difficulty: fight.difficulty,
      fightPercentage: fight.fightPercentage,
      kill: fight.kill,
      name: fight.name,
      start:
        reportStart !== null && typeof fight.start_time === "number"
          ? reportStart + fight.start_time
          : undefined,
    }));

  return {
    fights,
    title: report.title ?? undefined,
    zone: report.zone ?? null,
  };
}

export async function listRaidLogs(guildId: string): Promise<RaidLog[]> {
  const records = await prisma.raidLog.findMany({
    where: { guildId, hidden: false },
    orderBy: { createdAt: "desc" },
  });
  const logs = dedupeByReportCode(records.map(toRaidLog));

  // Marca las entradas publicadas cuyo mensaje quedó desactualizado para que
  // la web pueda ofrecer una actualización explícita.
  const groups = new Map<string, RaidLog[]>();
  for (const log of logs) {
    const bucket = groups.get(log.groupKey);
    if (bucket) {
      bucket.push(log);
    } else {
      groups.set(log.groupKey, [log]);
    }
  }
  for (const parts of groups.values()) {
    const published = parts.find(
      (part) => part.discordPosted && part.postedMessageText,
    );
    if (
      !published ||
      published.postedMessageText === buildRaidLogMessage(parts)
    ) {
      continue;
    }
    for (const part of parts) {
      part.needsUpdate = true;
    }
  }

  return logs;
}

// Logs que el usuario ocultó (para poder restaurarlos o borrarlos de verdad).
export async function listHiddenRaidLogs(guildId: string): Promise<RaidLog[]> {
  const records = await prisma.raidLog.findMany({
    where: { guildId, hidden: true },
    orderBy: { createdAt: "desc" },
  });
  return records.map(toRaidLog);
}

// De dos filas del MISMO report se queda con la que más avanzó: la publicada,
// si no la que más fights tiene, y si no la sincronizada más recientemente.
function keepBestReport(first: RaidLog, second: RaidLog): RaidLog {
  if (first.discordPosted !== second.discordPosted) {
    return first.discordPosted ? first : second;
  }
  if (first.fightCount !== second.fightCount) {
    return first.fightCount > second.fightCount ? first : second;
  }
  return (first.lastSyncedAt?.getTime() ?? 0) >=
    (second.lastSyncedAt?.getTime() ?? 0)
    ? first
    : second;
}

// Un mismo report guardado dos veces caería dos veces en la misma entrada (se
// agrupan por título + noche) y el análisis bajaría el report dos veces.
function dedupeByReportCode(logs: RaidLog[]): RaidLog[] {
  const byCode = new Map<string, RaidLog>();
  for (const log of logs) {
    const keeper = byCode.get(log.reportCode);
    byCode.set(log.reportCode, keeper ? keepBestReport(keeper, log) : log);
  }
  return [...byCode.values()];
}

// Saca de circulación los reports repetidos que ya estaban guardados: se ocultan
// (no se borran) y solo si nunca se publicaron, para no dejar el mensaje de
// Discord huérfano. Devuelve cuántos ocultó.
export async function hideDuplicateRaidLogs(guildId: string): Promise<number> {
  const records = await prisma.raidLog.findMany({
    where: { guildId, hidden: false },
    orderBy: { createdAt: "desc" },
  });
  const groups = new Map<string, RaidLog[]>();
  for (const log of records.map(toRaidLog)) {
    const bucket = groups.get(log.reportCode);
    if (bucket) {
      bucket.push(log);
    } else {
      groups.set(log.reportCode, [log]);
    }
  }

  const duplicates: string[] = [];
  for (const parts of groups.values()) {
    if (parts.length < 2) {
      continue;
    }
    const keeper = parts.reduce(keepBestReport);
    for (const part of parts) {
      if (part.id !== keeper.id && !part.discordPosted) {
        duplicates.push(part.id);
      }
    }
  }
  if (duplicates.length === 0) {
    return 0;
  }
  const result = await prisma.raidLog.updateMany({
    data: { hidden: true },
    where: { id: { in: duplicates } },
  });
  return result.count;
}

export async function getRaidLog(id: string): Promise<RaidLog | null> {
  const record = await prisma.raidLog.findUnique({ where: { id } });
  return record ? toRaidLog(record) : null;
}

export async function createRaidLog(input: {
  guildId: string;
  reportCode: string;
  reportUrl: string;
}): Promise<{ created: boolean; log: RaidLog }> {
  // Un mismo report entra una sola vez: pegar el link dos veces (o que lo pegue
  // otra persona) duplicaba la entrada y el análisis bajaba el report una vez
  // por fila, contando cada pull y cada muerte al doble.
  const existing = await prisma.raidLog.findFirst({
    where: { guildId: input.guildId, reportCode: input.reportCode },
  });
  if (existing) {
    // Pedir explícitamente un log oculto lo trae de vuelta.
    const record = existing.hidden
      ? await prisma.raidLog.update({
          data: { hidden: false },
          where: { id: existing.id },
        })
      : existing;
    return { created: false, log: toRaidLog(record) };
  }

  const record = await prisma.raidLog.create({
    data: {
      guildId: input.guildId,
      reportCode: input.reportCode,
      reportUrl: input.reportUrl,
    },
  });
  return { created: true, log: toRaidLog(record) };
}

export async function deleteRaidLog(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    const result = await prisma.raidLog.deleteMany({ where: { guildId, id } });
    return result.count > 0;
  } catch {
    return false;
  }
}

// Ocultar conserva la fila; solo un escaneo manual puede volver a detectar el report.
export async function hideRaidLog(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    const result = await prisma.raidLog.updateMany({
      where: { guildId, id },
      data: { hidden: true },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

// Restaurar un log oculto (vuelve a aparecer en la lista).
export async function showRaidLog(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    const result = await prisma.raidLog.updateMany({
      where: { guildId, id },
      data: { hidden: false },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

// Una entrada se considera terminada si queda estable o supera la duración máxima.
const FINISHED_STABLE_MS = 10 * 60 * 1000;

// Nombre de la raid (zona) para mostrarlo en la web. Best effort: si Warcraft
// Logs no responde, el log se guarda sin nombre (la progresión lo usa para
// etiquetar, no para contar).
async function resolveZoneName(
  zone: number | null,
  previous: { name: string | null; zone: number | null },
): Promise<string | null> {
  if (zone === null) {
    return null;
  }
  if (previous.zone === zone && previous.name) {
    return previous.name;
  }
  try {
    const zones = await getZones();
    return zones.get(zone)?.name ?? previous.name ?? null;
  } catch {
    return previous.name ?? null;
  }
}

// Red de seguridad: una noche de raid no dura más que esto. Warcraft Logs a
// veces sigue ajustando un report viejo (una kill que se recalcula, un fight
// que aparece), y como cualquier cambio reinicia la cuenta de estabilidad, la
// entrada se quedaba "en vivo" para siempre. Pasado este tope desde el primer
// fight, el report se considera cerrado sí o sí.
const MAX_NIGHT_MS = 6 * 60 * 60 * 1000;

// Vuelve a consultar Warcraft Logs y actualiza el log guardado.
// `changed` = el report dejó de crecer (terminó) y todavía no se publicó.
export async function refreshRaidLog(id: string): Promise<{
  changed: boolean;
  error?: string;
  log: RaidLog | null;
}> {
  const current = await prisma.raidLog.findUnique({ where: { id } });
  if (!current) {
    return { changed: false, log: null };
  }

  try {
    const report = await fetchWclReport(current.reportCode);
    const summary = summarize(report);
    const fightCount = summary.fights.length;
    const kills = summary.fights.filter((fight) => fight.kill).length;
    const now = new Date();
    // Fecha real del report según WCL: es la que se muestra y la que agrupa las
    // partes de una misma noche (si no viene, se usa la anterior / ahora).
    const reportStart =
      typeof report.start === "number" && report.start > 0
        ? new Date(report.start)
        : null;
    const firstFightAt =
      reportStart ??
      (fightCount > 0 ? (current.firstFightAt ?? now) : current.firstFightAt);
    const wasPosted = current.discordPosted;

    // ¿Sigue creciendo? Si cambió algo desde la última consulta (fights o
    // kills), reiniciamos el contador de estabilidad (todavía está en vivo).
    const grew =
      fightCount !== current.previousFightCount || kills !== current.kills;
    // Si no cambió, la cuenta de estabilidad arranca en la CONSULTA ANTERIOR
    // (no en ahora): un report que ya llevaba quieto más del umbral se
    // reconoce como terminado en la primera comprobación, sin esperar otro
    // umbral completo (importante para logs viejos que quedaron "en vivo").
    const fightsStableSince = grew
      ? null
      : (current.fightsStableSince ?? current.lastSyncedAt ?? now);
    const quietLongEnough =
      fightCount > 0 &&
      fightsStableSince !== null &&
      now.getTime() - fightsStableSince.getTime() >= FINISHED_STABLE_MS;
    const nightIsOver =
      fightCount > 0 &&
      firstFightAt !== null &&
      now.getTime() - firstFightAt.getTime() >= MAX_NIGHT_MS;
    const isStable = quietLongEnough || nightIsOver;

    const status = fightCount === 0 ? "new" : isStable ? "synced" : "live";
    const zone = summary.zone ?? current.zone ?? null;
    // El nombre de la raid sale del catálogo de Warcraft Logs; se pide solo
    // cuando falta o cambió, y si WCL no responde el log se guarda igual.
    const zoneName = await resolveZoneName(zone, {
      name: current.zoneName,
      zone: current.zone,
    });

    const updated = await prisma.raidLog.update({
      where: { id },
      data: {
        error: null,
        fightCount,
        fightsStableSince,
        firstFightAt,
        kills,
        lastSyncedAt: now,
        previousFightCount: fightCount,
        status,
        summary: {
          fights: summary.fights,
          title: summary.title,
          zone: summary.zone,
        },
        title: summary.title ?? current.title,
        zone,
        zoneName,
      },
    });

    return {
      changed: status === "synced" && !wasPosted,
      log: toRaidLog(updated),
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const failed = await prisma.raidLog.update({
      where: { id },
      data: {
        error: message,
        lastSyncedAt: new Date(),
        status: "failed",
      },
    });
    return { changed: false, error: message, log: toRaidLog(failed) };
  }
}

// Marca las partes de una entrada como publicadas y guarda DÓNDE quedó el
// mensaje + QUÉ decía: con eso se puede editar cuando el log crece después de
// publicado, y se evita editar cuando no cambió nada.
export async function markRaidLogsPosted(
  ids: string[],
  input: { channelId: string; messageId: string; content: string },
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.raidLog.updateMany({
    data: {
      discordChannelId: input.channelId,
      discordMessageId: input.messageId,
      discordPosted: true,
      postedMessageText: input.content,
    },
    where: { id: { in: ids } },
  });
}

// El informe de la noche se manda una sola vez: cuándo se publicó queda en las
// partes del grupo, así un reinicio del API no lo manda de nuevo.
export async function markRaidLogReportPosted(
  ids: string[],
  postedAt: Date,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.raidLog.updateMany({
    data: { reportPostedAt: postedAt },
    where: { id: { in: ids } },
  });
}

// Guarda el texto que quedó en el mensaje después de editarlo.
export async function updateRaidLogsPostedText(
  ids: string[],
  content: string,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.raidLog.updateMany({
    data: { postedMessageText: content },
    where: { id: { in: ids } },
  });
}

// El título de una noche lo pone el report más completo: cuando dos personas
// loggean la misma raid, la que subió más bosses es la que mejor la nombra.
function primaryPart(parts: RaidLog[]): RaidLog | undefined {
  return parts.reduce<RaidLog | undefined>(
    (best, part) => (!best || part.fightCount > best.fightCount ? part : best),
    undefined,
  );
}

// Un log guardado antes de que la tarjeta y el análisis supieran identificar un
// pull no tiene `boss`/`start` en el summary (ni el nombre de la raid): hay que
// refrescarlo una vez para que su tarjeta deje de contar los pulls repetidos.
export function needsRaidLogRefresh(log: RaidLog): boolean {
  return (
    !log.zoneName ||
    (log.summary?.fights ?? []).some((fight) => fight.start === undefined)
  );
}

// Refresca en segundo plano los logs que quedaron viejos (una sola vez cada
// uno). Best effort: si Warcraft Logs falla, se reintenta en el próximo arranque.
export async function backfillRaidLogDetails(): Promise<number> {
  const records = await prisma.raidLog.findMany({
    where: { hidden: false },
    orderBy: { createdAt: "desc" },
  });
  let refreshed = 0;
  for (const log of records.map(toRaidLog)) {
    if (!needsRaidLogRefresh(log)) {
      continue;
    }
    const result = await refreshRaidLog(log.id);
    if (!result.error) {
      refreshed += 1;
    }
  }
  return refreshed;
}

// Mensaje que se publica en el canal. Recibe TODAS las partes de una misma
// noche (ver raidLogGroupKey) y las publica como un solo log.
export function buildRaidLogMessage(logs: RaidLog[]): string {
  const parts = logs;
  const lines: string[] = ["📊 **Log de Raid**"];
  const title = primaryPart(parts)?.title;
  if (title) {
    lines.push(`**${title}**`);
  }
  const fights = parts.reduce((total, log) => total + log.fightCount, 0);
  const kills = parts.reduce((total, log) => total + log.kills, 0);
  const startedAt = parts
    .map((log) => log.firstFightAt)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const date = startedAt
    ? new Date(startedAt).toLocaleDateString("es-AR")
    : null;
  lines.push(
    `⚔️ ${fights} fight/s · 💀 ${kills} kill/s${date ? ` · 📅 ${date}` : ""}`,
  );
  for (const part of parts) {
    lines.push(part.reportUrl);
  }
  return lines.join("\n");
}

// ── Vigilado de perfil (API v1 de Warcraft Logs) ───────────────────
// Requiere WARCRAFT_LOGS_API_KEY (gratis). Filtra SOLO raids para no
// meter logs personales (Mythic+, mazmorras, etc.).

const WCL_V1_BASE = "https://www.warcraftlogs.com/v1";

export async function fetchWarcraftLogsV1Json(path: string): Promise<unknown> {
  const apiKey = env.WARCRAFT_LOGS_API_KEY;
  if (!apiKey) {
    throw new Error("WARCRAFT_LOGS_API_KEY no está configurado");
  }
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `${WCL_V1_BASE}${path}${separator}api_key=${encodeURIComponent(apiKey)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Bonafide-Hub/0.1",
      },
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Warcraft Logs v1 respondió ${response.status}${details ? `: ${details.slice(0, 240)}` : ""}`,
    );
  }

  return response.json();
}

type WclZone = { id: number; name: string; type: string };

let zonesCache: Map<number, WclZone> | null = null;

async function getZones(): Promise<Map<number, WclZone>> {
  if (zonesCache) {
    return zonesCache;
  }
  const data = (await fetchWarcraftLogsV1Json("/zones")) as WclZone[];
  zonesCache = new Map((data ?? []).map((zone) => [Number(zone.id), zone]));
  return zonesCache;
}

type WclCharacterReport = {
  end?: number;
  id: string;
  owner?: string;
  start?: number;
  title?: string;
  zone?: number;
};

async function fetchGuildReports(
  guild: string,
  server: string,
  region: string,
): Promise<WclCharacterReport[]> {
  // La API v1 NO tiene /reports/character (devuelve 404). El endpoint real
  // para listar reports es /reports/guild/{guild}/{server}/{region}.
  const data = (await fetchWarcraftLogsV1Json(
    `/reports/guild/${encodeURIComponent(guild)}/${encodeURIComponent(server)}/${encodeURIComponent(region)}`,
  )) as WclCharacterReport[];
  return Array.isArray(data) ? data : [];
}

export type WatchResult = {
  created: RaidLog[];
  error?: string;
};

// Vigila el gremio: crea un RaidLog por cada report de RAID nuevo (filtra
// Mythic+/mazmorras para no meter logs personales).
export async function syncGuildWatch(input: {
  guild: string;
  guildId: string;
  region: string;
  server: string;
}): Promise<WatchResult> {
  try {
    const [reports, zones] = await Promise.all([
      fetchGuildReports(input.guild, input.server, input.region),
      getZones(),
    ]);

    const existing = await prisma.raidLog.findMany({
      where: { guildId: input.guildId },
      select: { reportCode: true },
    });
    const existingCodes = new Set(existing.map((log) => log.reportCode));

    const created: RaidLog[] = [];
    let skippedByZone = 0;
    for (const report of reports) {
      // Number(undefined) da NaN, y NaN ?? -1 sigue siendo NaN: forzamos -1.
      const zoneId = typeof report.zone === "number" ? Number(report.zone) : -1;
      const zoneInfo = zones.get(zoneId);
      const isRaidZone = zoneInfo?.type === "Raid";
      const titleHasRaid = (report.title ?? "").toLowerCase().includes("raid");

      // Aceptamos raids aunque la zona no esté bien clasificada en WCL:
      // zona raid, O título que diga "raid" (p. ej. "Raid N 20/08/2026").
      // Así un report mixto/no-clasificado igual se guarda y se publica.
      if (!isRaidZone && !titleHasRaid) {
        skippedByZone += 1;
        continue;
      }
      if (existingCodes.has(report.id)) {
        continue;
      }
      const result = await createRaidLog({
        guildId: input.guildId,
        reportCode: report.id,
        reportUrl: `https://www.warcraftlogs.com/reports/${report.id}`,
      });
      existingCodes.add(report.id);
      created.push(result.log);
    }

    // Registrar también escaneos sin resultados ayuda a distinguirlos de fallos.
    console.log(
      `[raid-logs] manual scan ${input.guild}@${input.server} (${input.region}): ` +
        `${reports.length} report/s, ${created.length} nuevo/s, ` +
        `${skippedByZone} fuera de zona raid, ` +
        `${reports.length - created.length - skippedByZone} ya existían`,
    );

    return { created };
  } catch (error) {
    return { created: [], error: getErrorMessage(error) };
  }
}
