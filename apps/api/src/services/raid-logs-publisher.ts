import { env } from "../config/env.js";
import {
  editMessages,
  postMessages,
  splitForDiscord,
} from "./communications-store.js";
import { getGuildConfig } from "./guild-config-store.js";
import {
  buildRaidLogMessage,
  listActiveRaidLogs,
  listRaidLogs,
  markRaidLogsPosted,
  refreshRaidLog,
  updateRaidLogsPostedText,
  type RaidLog,
} from "./raid-logs-store.js";

// Una noche de raid = una entrada (ver raidLogGroupKey en raid-logs-store).
// Este servicio concentra TODO lo que publica o edita un log en Discord, para
// que la publicación manual (rutas del API) y la automática (scheduler) se
// comporten exactamente igual: una sola implementación de las reglas.

const keyOf = (log: RaidLog): string => log.groupKey || log.id;

// Resumen del último ciclo del scheduler. Sirve para responder "¿por qué esta
// entrada no se cerró?" desde afuera (se expone en GET /health) en lugar de
// tener que leer los logs del servidor.
export type RaidLogSyncGroupReport = {
  action:
    | "al-dia"
    | "editado"
    | "error"
    | "esperando"
    | "publicado"
    | "sin-canal";
  error?: string;
  fights: number;
  groupKey: string;
  kills: number;
  parts: {
    code: string;
    fights: number;
    firstFightAt?: string;
    kills: number;
    previousFights: number;
    stableSince?: string;
    status: string;
  }[];
};

type RaidLogSyncStatus = {
  at: string;
  candidates: number;
  error?: string;
  groups: RaidLogSyncGroupReport[];
};

let lastSync: RaidLogSyncStatus = {
  at: new Date(0).toISOString(),
  candidates: 0,
  groups: [],
};

// Último ciclo (para /health).
export function getRaidLogSyncStatus(): RaidLogSyncStatus {
  return lastSync;
}

// Errores del ciclo que no pertenecen a una entrada (se guardan en /health).
export function recordRaidLogSyncError(message: string): void {
  lastSync = { ...lastSync, error: message };
}

function describeParts(parts: RaidLog[]): RaidLogSyncGroupReport["parts"] {
  return parts.map((part) => ({
    code: part.reportCode,
    fights: part.fightCount,
    firstFightAt: part.firstFightAt?.toISOString(),
    kills: part.kills,
    previousFights: part.previousFightCount ?? -1,
    stableSince: part.fightsStableSince?.toISOString(),
    status: part.status,
  }));
}

function partsOfGroup(logs: RaidLog[], log: RaidLog): RaidLog[] {
  const key = keyOf(log);
  return logs.filter(
    (entry) => entry.guildId === log.guildId && keyOf(entry) === key,
  );
}

// Refresca todas las partes de una entrada y devuelve el estado fresco.
// Se vuelve a leer la lista porque al refrescar puede cambiar el título o la
// fecha del report, y con eso la clave del grupo.
async function refreshGroup(
  guildId: string,
  logId: string,
): Promise<RaidLog[]> {
  const before = await listRaidLogs(guildId);
  const target = before.find((log) => log.id === logId);
  if (!target) {
    return [];
  }

  const parts = partsOfGroup(before, target);
  for (const part of parts) {
    await refreshRaidLog(part.id);
  }

  const ids = new Set(parts.map((part) => part.id));
  return (await listRaidLogs(guildId)).filter((log) => ids.has(log.id));
}

function totalsOf(parts: RaidLog[]): {
  fights: number;
  kills: number;
  title: string;
} {
  return {
    fights: parts.reduce((total, part) => total + part.fightCount, 0),
    kills: parts.reduce((total, part) => total + part.kills, 0),
    title: parts[0]?.title ?? parts[0]?.reportCode ?? "Log de raid",
  };
}

// Publica la entrada completa: una noche = un solo mensaje.
export async function publishRaidLogEntry(input: {
  channelId: string;
  guildId: string;
  logId: string;
  token: string;
}): Promise<{ error?: string; logs: RaidLog[]; parts: RaidLog[] }> {
  const parts = await refreshGroup(input.guildId, input.logId);
  if (parts.length === 0) {
    return { error: "Log no encontrado", logs: [], parts: [] };
  }

  const content = buildRaidLogMessage(parts);
  const ids = await postMessages(
    input.token,
    input.channelId,
    splitForDiscord(content),
  );
  if (ids.length === 0) {
    return {
      error: "No se pudo publicar en Discord",
      logs: await listRaidLogs(input.guildId),
      parts,
    };
  }

  await markRaidLogsPosted(
    parts.map((part) => part.id),
    { channelId: input.channelId, content, messageId: ids[0] },
  );

  return { logs: await listRaidLogs(input.guildId), parts };
}

// Re-escanea la entrada y EDITA el mensaje ya publicado si el texto cambió.
export async function updateRaidLogEntry(input: {
  guildId: string;
  logId: string;
  token: string;
}): Promise<{
  error?: string;
  logs: RaidLog[];
  parts: RaidLog[];
  updated: boolean;
}> {
  const parts = await refreshGroup(input.guildId, input.logId);
  if (parts.length === 0) {
    return { error: "Log no encontrado", logs: [], parts: [], updated: false };
  }

  const published = parts.find(
    (part) => part.discordChannelId && part.discordMessageId,
  );
  if (!published?.discordChannelId || !published.discordMessageId) {
    return {
      error: "La entrada todavía no está publicada en Discord",
      logs: await listRaidLogs(input.guildId),
      parts,
      updated: false,
    };
  }

  const content = buildRaidLogMessage(parts);
  if (content === published.postedMessageText) {
    // Nada cambió: no se toca Discord (evita PATCH innecesarios).
    return {
      logs: await listRaidLogs(input.guildId),
      parts,
      updated: false,
    };
  }

  const edited = await editMessages(
    input.token,
    published.discordChannelId,
    [published.discordMessageId],
    splitForDiscord(content),
  );
  const updated = edited.length > 0;
  if (updated) {
    await updateRaidLogsPostedText(
      parts.map((part) => part.id),
      content,
    );
  }

  return { logs: await listRaidLogs(input.guildId), parts, updated };
}

// Ciclo automático (corre en el scheduler del API cada 2 minutos):
//   - los borradores que ya terminaron se publican solos;
//   - los mensajes publicados que quedaron viejos se corrigen solos.
// Publicar temprano no rompe nada porque la corrección es automática; lo que
// NUNCA se hace es publicar mientras la entrada sigue creciendo.
export async function syncRaidLogGroups(): Promise<void> {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn(
      "[raid-logs] sin DISCORD_BOT_TOKEN no se puede publicar ni editar logs",
    );
    return;
  }

  const logs = await listActiveRaidLogs();
  const groups = new Map<string, RaidLog[]>();
  for (const log of logs) {
    const key = `${log.guildId}|${keyOf(log)}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(log);
    } else {
      groups.set(key, [log]);
    }
  }

  const reports: RaidLogSyncGroupReport[] = [];

  for (const group of groups.values()) {
    const head = group[0];
    try {
      const fresh = await refreshGroup(head.guildId, head.id);
      if (fresh.length === 0) {
        continue;
      }

      const totals = totalsOf(fresh);
      const report: RaidLogSyncGroupReport = {
        action: "esperando",
        fights: totals.fights,
        groupKey: keyOf(head),
        kills: totals.kills,
        parts: describeParts(fresh),
      };
      reports.push(report);

      // Sin fights todavía no hay nada que publicar (un report recién creado
      // aparece con 0 antes de que Warcraft Logs termine de subirlo).
      if (totals.fights === 0) {
        continue;
      }

      // La entrada está lista cuando ninguna parte CON fights sigue creciendo.
      // Una parte vacía no bloquea: si después llegan sus fights, el mensaje
      // se corrige solo (por eso tampoco importa publicar apenas termina).
      const growing = fresh.some(
        (part) => part.fightCount > 0 && part.status !== "synced",
      );
      if (growing) {
        continue;
      }

      const content = buildRaidLogMessage(fresh);
      const published = fresh.find(
        (part) => part.discordChannelId && part.discordMessageId,
      );

      if (!published) {
        const config = await getGuildConfig(head.guildId);
        if (!config.logsChannelId) {
          report.action = "sin-canal";
          continue;
        }
        const ids = await postMessages(
          token,
          config.logsChannelId,
          splitForDiscord(content),
        );
        if (ids.length === 0) {
          report.action = "error";
          report.error = "Discord rechazó el mensaje";
          console.warn(
            `[raid-logs] no se pudo auto-publicar ${head.reportCode}: Discord rechazó el mensaje`,
          );
          continue;
        }
        await markRaidLogsPosted(
          fresh.map((part) => part.id),
          { channelId: config.logsChannelId, content, messageId: ids[0] },
        );
        report.action = "publicado";
        console.log(
          `[raid-logs] auto-publicado ${totals.title} (${fresh.length} report/s, ${totals.fights} fight/s, ${totals.kills} kill/s)`,
        );
        continue;
      }

      const channelId = published.discordChannelId;
      const messageId = published.discordMessageId;
      if (!channelId || !messageId) {
        continue;
      }

      // Si apareció una parte nueva de la misma noche, se engancha al mensaje
      // que ya existe: nunca se publica dos veces la misma noche.
      const unlinked = fresh.filter((part) => !part.discordMessageId);
      if (unlinked.length > 0) {
        await markRaidLogsPosted(
          unlinked.map((part) => part.id),
          {
            channelId,
            content: published.postedMessageText ?? "",
            messageId,
          },
        );
      }

      if (content === published.postedMessageText) {
        report.action = "al-dia";
        continue;
      }

      const edited = await editMessages(
        token,
        channelId,
        [messageId],
        splitForDiscord(content),
      );
      if (edited.length === 0) {
        report.action = "error";
        report.error = "Discord rechazó la edición";
        console.warn(
          `[raid-logs] no se pudo actualizar el mensaje de ${head.reportCode}`,
        );
        continue;
      }
      await updateRaidLogsPostedText(
        fresh.map((part) => part.id),
        content,
      );
      report.action = "editado";
      console.log(
        `[raid-logs] mensaje actualizado ${totals.title} (${fresh.length} report/s, ${totals.fights} fight/s, ${totals.kills} kill/s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reports.push({
        action: "error",
        error: message,
        fights: 0,
        groupKey: keyOf(head),
        kills: 0,
        parts: [],
      });
      console.error(
        `[raid-logs] error sincronizando la entrada ${head.reportCode}`,
        error,
      );
    }
  }

  lastSync = {
    at: new Date().toISOString(),
    candidates: logs.length,
    groups: reports.slice(0, 8),
  };
}
