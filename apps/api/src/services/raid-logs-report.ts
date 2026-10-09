import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { postMessages } from "./communications-store.js";
import { getGuildConfig } from "./guild-config-store.js";
import { analyzeRaidLogNight } from "./raid-logs-analysis.js";
import {
  listRaidLogs,
  markRaidLogReportPosted,
  refreshRaidLog,
  type RaidLog,
} from "./raid-logs-store.js";

// El informe de la noche: análisis + cruce con los anotados, publicado una sola
// vez, cuando la raid terminó. Se apoya en el estado que ya calcula el refresh
// ("en vivo" mientras el report crece, "synced" cuando se quedó quieto).
const REPORT_QUIET_MS = 45 * 60 * 1000;
// Un report que quedó sin crecer y sin fecha de estabilidad (por ejemplo, uno
// viejo que se agregó después) cuenta como terminado pasado este tiempo.
const REPORT_NIGHT_MS = 6 * 60 * 60 * 1000;
const REPORT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
// Los reports "en vivo" se refrescan solos: sin eso, la noche nunca pasa a
// "terminada" y el informe no sale.
const SYNC_STALE_MS = 5 * 60 * 1000;
const LIST_LIMIT = 6;

const keyOf = (log: RaidLog): string => log.groupKey || log.id;

function partsOfGroup(logs: RaidLog[], log: RaidLog): RaidLog[] {
  const key = keyOf(log);
  return logs.filter((entry) => keyOf(entry) === key);
}

// Mismas etiquetas que la web (apps/web/src/raidLogsReport.ts): el mensaje no
// puede mostrar las claves internas ("healthstones", "food").
const CONSUMABLE_LABEL: Record<string, string> = {
  flask: "flask",
  food: "comida",
  healthPotions: "vida",
  healthstones: "piedra",
  potions: "pota",
  prepot: "prepot",
};

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

// Fecha en hora argentina y en palabras ("7 de octubre"): el API corre en UTC y
// no dependemos del ICU de la imagen para el mes.
function nightLabel(value: Date): string {
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
  }).formatToParts(value);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const day = get("day");
  const month = MESES[get("month") - 1] ?? "";
  return `${day} de ${month} de ${get("year")}`;
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

// Qué consumibles hay que mirar: los que el API pudo medir en la noche.
function consumableLines(
  analysis: Awaited<ReturnType<typeof analyzeRaidLogNight>>,
): string[] {
  const consumables = analysis.consumables;
  if (!consumables) {
    return [];
  }
  const expected = consumables.expected ?? consumables.categories;
  const reactive = consumables.categories.filter(
    (category) => !expected.includes(category),
  );
  const lines: string[] = [];
  for (const category of expected) {
    const missing = consumables.players
      .map((player) => ({
        absent: player.pulls - (player.counts[category] ?? 0),
        name: player.name,
      }))
      .filter((entry) => entry.absent > 0)
      .sort((left, right) => right.absent - left.absent);
    if (missing.length === 0) {
      continue;
    }
    const shown = missing
      .slice(0, LIST_LIMIT)
      .map((entry) => entry.name)
      .join(", ");
    lines.push(
      `**Sin ${CONSUMABLE_LABEL[category] ?? category}** (${missing.length}): ${shown}${missing.length > LIST_LIMIT ? ` y ${missing.length - LIST_LIMIT} más` : ""}`,
    );
  }
  for (const category of reactive) {
    const users = consumables.players
      .map((player) => ({ name: player.name, used: player.counts[category] ?? 0 }))
      .filter((entry) => entry.used > 0)
      .sort((left, right) => right.used - left.used);
    if (users.length === 0) {
      continue;
    }
    lines.push(
      `**Usaron ${CONSUMABLE_LABEL[category] ?? category}**: ${users
        .slice(0, LIST_LIMIT)
        .map((entry) => `${entry.name} (${entry.used})`)
        .join(", ")}${users.length > LIST_LIMIT ? ` y ${users.length - LIST_LIMIT} más` : ""}`,
    );
  }
  return lines;
}

// Texto del informe: lo que se ve en Discord. Los números del análisis y del
// cruce de asistencia, con las listas largas recortadas.
export function buildRaidLogReportMessage(input: {
  analysis: Awaited<ReturnType<typeof analyzeRaidLogNight>>;
  night: string;
  parts: RaidLog[];
}): string {
  const { analysis } = input;
  const kills = analysis.encounters.filter((encounter) => encounter.kill).length;
  const bosses = new Set(
    analysis.encounters.map((encounter) => encounter.boss ?? encounter.name),
  ).size;
  const title = input.parts.find((part) => part.title)?.title ?? "Raid";
  const lines: string[] = [
    `**Informe de raid · ${input.night}** (${title})`,
    `${count(analysis.encounters.length, "pull", "pulls")} · ${count(kills, "kill", "kills")} · ${count(analysis.encounters.length - kills, "wipe", "wipes")} · ${count(bosses, "boss", "bosses")}`,
  ];

  const top = analysis.averageDps.slice(0, 3);
  if (top.length > 0) {
    lines.push(
      `**DPS promedio**: ${top
        .map((player) => `${player.name} ${player.averageDps.toLocaleString("es-AR")}`)
        .join(" · ")}`,
    );
  }
  const deaths = analysis.deathsByPlayer.filter((player) => player.deaths > 0);
  const totalDeaths = deaths.reduce((sum, player) => sum + player.deaths, 0);
  if (deaths.length > 0) {
    lines.push(
      `**Muertes** (${totalDeaths}): ${deaths
        .slice(0, 3)
        .map((player) => `${player.name} ${player.deaths}`)
        .join(" · ")}`,
    );
  }
  lines.push(...consumableLines(analysis));

  const attendance = analysis.attendance;
  if (attendance) {
    if (attendance.event) {
      lines.push(
        `**Anotados que vinieron**: ${attendance.signedPresent}/${attendance.signedTotal}`,
      );
    }
    if (attendance.unsignedPresent.length > 0) {
      lines.push(
        `**Vinieron sin anotarse** (${attendance.unsignedPresent.length}): ${attendance.unsignedPresent
          .slice(0, LIST_LIMIT)
          .map((player) => player.name)
          .join(", ")}`,
      );
    }
    const absent = [
      ...attendance.signedAbsent.map((signup) => signup.name),
      ...attendance.unmatchedSignups.map((signup) => `${signup.name} (sin PJ)`),
    ];
    if (absent.length > 0) {
      lines.push(
        `**Anotados que no aparecieron** (${absent.length}): ${absent
          .slice(0, LIST_LIMIT)
          .join(", ")}${absent.length > LIST_LIMIT ? ` y ${absent.length - LIST_LIMIT} más` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

// Botones para bajar el informe: el CSV y el PDF salen de la web (mismo
// contenido), así que se linkea a la noche con el formato pedido.
function reportComponents(logId: string): unknown[] {
  const base = env.FRONTEND_APP_URL.replace(/\/$/, "");
  const link = (label: string, report: "csv" | "pdf") => ({
    label,
    style: 5,
    type: 2,
    url: `${base}/?log=${encodeURIComponent(logId)}&report=${report}#/raids/logs`,
  });
  return [
    {
      components: [link("Descargar CSV", "csv"), link("Descargar PDF", "pdf")],
      type: 1,
    },
  ];
}

// Una noche terminada: ninguna parte creció en el umbral y ninguna quedó "en
// vivo". La fecha de estabilidad más reciente del grupo es la que manda.
function nightIsOver(parts: RaidLog[], now: number): boolean {
  if (parts.some((part) => part.status === "live")) {
    return false;
  }
  const stableSince = parts
    .map((part) => part.fightsStableSince?.getTime() ?? 0)
    .reduce((max, value) => Math.max(max, value), 0);
  if (stableSince > 0) {
    return now - stableSince >= REPORT_QUIET_MS;
  }
  const firstFight = parts
    .map((part) => part.firstFightAt?.getTime())
    .filter((value): value is number => value !== undefined)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  return Number.isFinite(firstFight) && now - firstFight >= REPORT_NIGHT_MS;
}

// Refresca los reports que siguen creciendo y publica el informe de las noches
// que terminaron (una sola vez cada una).
export async function syncRaidLogsAndPublishReports(): Promise<{
  posted: number;
  refreshed: number;
}> {
  const token = env.DISCORD_BOT_TOKEN;
  const now = Date.now();
  const pending = await prisma.raidLog.findMany({
    select: { guildId: true },
    where: { hidden: false, reportPostedAt: null },
  });
  const guildIds = [...new Set(pending.map((row) => row.guildId))];
  let posted = 0;
  let refreshed = 0;

  for (const guildId of guildIds) {
    const logs = await listRaidLogs(guildId);
    // 1) Reports todavía en curso: se refrescan para saber cuándo terminaron.
    for (const log of logs) {
      const stale =
        !log.lastSyncedAt ||
        now - log.lastSyncedAt.getTime() >= SYNC_STALE_MS;
      if (log.status !== "failed" && stale) {
        await refreshRaidLog(log.id);
        refreshed += 1;
      }
    }

    if (!token) {
      continue;
    }
    const config = await getGuildConfig(guildId);
    if (!config.logsChannelId) {
      continue;
    }

    const fresh = await listRaidLogs(guildId);
    const handled = new Set<string>();
    for (const log of fresh) {
      const key = keyOf(log);
      if (handled.has(key) || log.reportPostedAt !== undefined) {
        continue;
      }
      handled.add(key);
      const parts = partsOfGroup(fresh, log);
      if (parts.some((part) => part.reportPostedAt !== undefined)) {
        continue;
      }
      if (parts.every((part) => part.fightCount === 0)) {
        continue;
      }
      if (!nightIsOver(parts, now)) {
        continue;
      }

      try {
        const analysis = await analyzeRaidLogNight(guildId, log.id);
        const night = nightLabel(log.firstFightAt ?? log.createdAt);
        const content = buildRaidLogReportMessage({ analysis, night, parts });
        const ids = await postMessages(token, config.logsChannelId, [content], {
          components: reportComponents(log.id),
        });
        if (ids.length === 0) {
          console.error(
            `[raid-logs] no se pudo publicar el informe de ${log.reportCode}`,
          );
          continue;
        }
        await markRaidLogReportPosted(
          parts.map((part) => part.id),
          new Date(),
        );
        posted += 1;
      } catch (error) {
        console.error(
          `[raid-logs] informe de ${log.reportCode} falló:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return { posted, refreshed };
}

export function startRaidLogReportSync(): () => void {
  const run = (): void => {
    void syncRaidLogsAndPublishReports().catch((error) => {
      console.error(
        "[raid-logs] sync de informes falló:",
        error instanceof Error ? error.message : error,
      );
    });
  };
  const timer = setInterval(run, REPORT_SYNC_INTERVAL_MS);
  run();
  return () => clearInterval(timer);
}
