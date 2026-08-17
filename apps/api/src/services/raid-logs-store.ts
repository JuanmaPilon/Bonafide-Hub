import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

export type RaidFightSummary = {
  difficulty?: number;
  fightPercentage?: number;
  kill?: boolean;
  name?: string;
};

export type RaidLog = {
  createdAt: Date;
  discordPosted: boolean;
  error?: string;
  fightCount: number;
  firstFightAt?: Date;
  guildId: string;
  id: string;
  kills: number;
  lastSyncedAt?: Date;
  reportCode: string;
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
  discordPosted: boolean;
  error: string | null;
  fightCount: number;
  firstFightAt: Date | null;
  guildId: string;
  id: string;
  kills: number;
  lastSyncedAt: Date | null;
  reportCode: string;
  reportUrl: string;
  status: string;
  summary: unknown;
  title: string | null;
  updatedAt: Date;
  zone: number | null;
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
    discordPosted: record.discordPosted,
    error: record.error ?? undefined,
    fightCount: record.fightCount,
    firstFightAt: record.firstFightAt ?? undefined,
    guildId: record.guildId,
    id: record.id,
    kills: record.kills,
    lastSyncedAt: record.lastSyncedAt ?? undefined,
    reportCode: record.reportCode,
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
  };
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

// Consulta el endpoint JSON público de Warcraft Logs (sin API key) para
// reports públicos: https://www.warcraftlogs.com/report/fights/{code}
async function fetchWclReport(code: string): Promise<WclReport> {
  const response = await fetch(
    `https://www.warcraftlogs.com/report/fights/${encodeURIComponent(code)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Bonafide-Hub/0.1",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Warcraft Logs responded ${response.status}`);
  }

  return (await response.json()) as WclReport;
}

// Reduce el report a lo que nos interesa: fights de boss, kills, título.
function summarize(report: WclReport): {
  fights: RaidFightSummary[];
  title?: string;
  zone?: number | null;
} {
  const fights = (report.fights ?? [])
    .filter((fight) => (fight.boss ?? 0) > 0 || Boolean(fight.name))
    .map((fight) => ({
      difficulty: fight.difficulty,
      fightPercentage: fight.fightPercentage,
      kill: fight.kill,
      name: fight.name,
    }));

  return {
    fights,
    title: report.title ?? undefined,
    zone: report.zone ?? null,
  };
}

export async function listRaidLogs(guildId: string): Promise<RaidLog[]> {
  const records = await prisma.raidLog.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
  });
  return records.map(toRaidLog);
}

// Logs que todavía no se publicaron en Discord (para el scheduler del API).
export async function listUnpostedRaidLogs(): Promise<RaidLog[]> {
  const records = await prisma.raidLog.findMany({
    where: { discordPosted: false },
    orderBy: { createdAt: "asc" },
  });
  return records.map(toRaidLog);
}

export async function getRaidLog(id: string): Promise<RaidLog | null> {
  const record = await prisma.raidLog.findUnique({ where: { id } });
  return record ? toRaidLog(record) : null;
}

export async function createRaidLog(input: {
  guildId: string;
  reportCode: string;
  reportUrl: string;
}): Promise<RaidLog> {
  const record = await prisma.raidLog.create({
    data: {
      guildId: input.guildId,
      reportCode: input.reportCode,
      reportUrl: input.reportUrl,
    },
  });
  return toRaidLog(record);
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

// Vuelve a consultar Warcraft Logs y actualiza el log guardado.
// `changed` = aparecieron fights y todavía no se publicaron en Discord.
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
    const firstFightAt =
      fightCount > 0 ? (current.firstFightAt ?? now) : current.firstFightAt;
    const wasPosted = current.discordPosted;

    const updated = await prisma.raidLog.update({
      where: { id },
      data: {
        error: null,
        fightCount,
        firstFightAt,
        kills,
        lastSyncedAt: now,
        status: fightCount > 0 ? "synced" : "new",
        summary: {
          fights: summary.fights,
          title: summary.title,
          zone: summary.zone,
        },
        title: summary.title ?? current.title,
        zone: summary.zone ?? current.zone,
      },
    });

    return {
      changed: fightCount > 0 && !wasPosted,
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

export async function markRaidLogPosted(id: string): Promise<void> {
  await prisma.raidLog.update({
    where: { id },
    data: { discordPosted: true },
  });
}

// Mensaje que se publica en el canal de Discord.
export function buildRaidLogMessage(log: RaidLog): string {
  const lines: string[] = ["📊 **Log de Raid**"];
  if (log.title) {
    lines.push(`**${log.title}**`);
  }
  const date = log.firstFightAt
    ? new Date(log.firstFightAt).toLocaleDateString("es-AR")
    : null;
  lines.push(
    `⚔️ ${log.fightCount} fight/s · 💀 ${log.kills} kill/s${date ? ` · 📅 ${date}` : ""}`,
  );
  lines.push(log.reportUrl);
  return lines.join("\n");
}

// ── Vigilado de perfil (API v1 de Warcraft Logs) ───────────────────
// Requiere WARCRAFT_LOGS_API_KEY (gratis). Filtra SOLO raids para no
// meter logs personales (Mythic+, mazmorras, etc.).

const WCL_V1_BASE = "https://www.warcraftlogs.com/v1";

async function fetchV1Json(path: string): Promise<unknown> {
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
    throw new Error(`Warcraft Logs v1 responded ${response.status}`);
  }

  return response.json();
}

type WclZone = { id: number; name: string; type: string };

let zonesCache: Map<number, WclZone> | null = null;

async function getZones(): Promise<Map<number, WclZone>> {
  if (zonesCache) {
    return zonesCache;
  }
  const data = (await fetchV1Json("/zones")) as WclZone[];
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

async function fetchCharacterReports(
  character: string,
  server: string,
  region: string,
): Promise<WclCharacterReport[]> {
  const data = (await fetchV1Json(
    `/reports/character/${encodeURIComponent(character)}/${encodeURIComponent(server)}/${encodeURIComponent(region)}`,
  )) as WclCharacterReport[];
  return Array.isArray(data) ? data : [];
}

export type WatchResult = {
  created: RaidLog[];
  error?: string;
};

// Vigila el perfil: crea un RaidLog por cada report de RAID nuevo (filtra
// Mythic+/mazmorras para no meter logs personales).
export async function syncCharacterWatch(input: {
  character: string;
  guildId: string;
  region: string;
  server: string;
}): Promise<WatchResult> {
  try {
    const [reports, zones] = await Promise.all([
      fetchCharacterReports(input.character, input.server, input.region),
      getZones(),
    ]);

    const existing = await prisma.raidLog.findMany({
      where: { guildId: input.guildId },
      select: { reportCode: true },
    });
    const existingCodes = new Set(existing.map((log) => log.reportCode));

    const created: RaidLog[] = [];
    for (const report of reports) {
      const zoneInfo = zones.get(Number(report.zone ?? -1));
      // Solo raids: excluye dungeons/Mythic+/etc. (logs personales).
      if (!zoneInfo || zoneInfo.type !== "Raid") {
        continue;
      }
      // Capa extra de check: el título debe indicar que es raid
      // (ej: "Raid Jueves Mítica"). Evita logs personales que por algún
      // motivo tengan zone de raid.
      const title = (report.title ?? "").toLowerCase();
      if (!title.includes("raid")) {
        continue;
      }
      if (existingCodes.has(report.id)) {
        continue;
      }
      const createdLog = await createRaidLog({
        guildId: input.guildId,
        reportCode: report.id,
        reportUrl: `https://www.warcraftlogs.com/reports/${report.id}`,
      });
      existingCodes.add(report.id);
      created.push(createdLog);
    }

    return { created };
  } catch (error) {
    return { created: [], error: getErrorMessage(error) };
  }
}

// Guilds con vigilado configurado (para el scheduler del API).
export async function listWatchGuildConfigs(): Promise<
  Array<{ character: string; guildId: string; region: string; server: string }>
> {
  const records = await prisma.guildConfig.findMany({
    where: { logsWatchCharacter: { not: null } },
    select: {
      guildId: true,
      logsWatchCharacter: true,
      logsWatchRegion: true,
      logsWatchServer: true,
    },
  });

  return records
    .filter((record) => record.logsWatchCharacter && record.logsWatchServer)
    .map((record) => ({
      character: record.logsWatchCharacter as string,
      guildId: record.guildId,
      region: record.logsWatchRegion ?? "EU",
      server: record.logsWatchServer as string,
    }));
}
