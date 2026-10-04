import {
  editMessages,
  postMessages,
  splitForDiscord,
} from "./communications-store.js";
import {
  buildRaidLogMessage,
  listRaidLogs,
  markRaidLogsPosted,
  refreshRaidLog,
  updateRaidLogsPostedText,
  type RaidLog,
} from "./raid-logs-store.js";

// Una noche de raid = una entrada (ver raidLogGroupKey en raid-logs-store).
// Este servicio concentra las acciones explícitas de publicar y actualizar.

const keyOf = (log: RaidLog): string => log.groupKey || log.id;

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
