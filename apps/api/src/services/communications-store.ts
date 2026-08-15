import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

export type CommunicationStatus = "draft" | "published";

export type Communication = {
  authorName?: string;
  channelId?: string;
  content: string;
  createdAt: Date;
  discordMessageIds: string[];
  guildId: string;
  id: string;
  publishedAt?: Date;
  status: CommunicationStatus;
  title: string;
  updatedAt: Date;
};

function toCommunication(record: {
  authorName: string | null;
  channelId: string | null;
  content: string;
  createdAt: Date;
  discordMessageIds: string[];
  guildId: string;
  id: string;
  publishedAt: Date | null;
  status: string;
  title: string;
  updatedAt: Date;
}): Communication {
  return {
    authorName: record.authorName ?? undefined,
    channelId: record.channelId ?? undefined,
    content: record.content,
    createdAt: record.createdAt,
    discordMessageIds: record.discordMessageIds,
    guildId: record.guildId,
    id: record.id,
    publishedAt: record.publishedAt ?? undefined,
    status: (record.status === "published"
      ? "published"
      : "draft") as CommunicationStatus,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

export async function listCommunications(
  guildId: string,
): Promise<Communication[]> {
  const records = await prisma.communication.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
  });
  return records.map(toCommunication);
}

export async function listPublishedCommunications(
  guildId: string,
): Promise<Communication[]> {
  const records = await prisma.communication.findMany({
    where: { guildId, status: "published" },
    orderBy: { publishedAt: "desc" },
  });
  return records.map(toCommunication);
}

export async function getCommunication(
  id: string,
): Promise<Communication | null> {
  const record = await prisma.communication.findUnique({ where: { id } });
  return record ? toCommunication(record) : null;
}

export async function createCommunication(input: {
  authorName?: string;
  channelId?: string;
  content: string;
  guildId: string;
  title: string;
}): Promise<Communication> {
  const record = await prisma.communication.create({
    data: {
      authorName: input.authorName?.trim() || null,
      channelId: input.channelId?.trim() || null,
      content: input.content,
      guildId: input.guildId,
      title: input.title.trim(),
    },
  });
  return toCommunication(record);
}

export async function updateCommunication(input: {
  authorName?: string;
  channelId?: string;
  content?: string;
  discordMessageIds?: string[];
  id: string;
  title?: string;
}): Promise<Communication | null> {
  const record = await prisma.communication.update({
    where: { id: input.id },
    data: {
      ...(input.authorName !== undefined
        ? { authorName: input.authorName.trim() || null }
        : {}),
      ...(input.channelId !== undefined
        ? { channelId: input.channelId.trim() || null }
        : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.discordMessageIds !== undefined
        ? { discordMessageIds: input.discordMessageIds }
        : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    },
  });
  return toCommunication(record);
}

export async function deleteCommunication(id: string): Promise<boolean> {
  try {
    await prisma.communication.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function markPublished(
  id: string,
  discordMessageIds: string[],
): Promise<Communication | null> {
  try {
    const record = await prisma.communication.update({
      where: { id },
      data: {
        status: "published",
        publishedAt: new Date(),
        discordMessageIds,
      },
    });
    return toCommunication(record);
  } catch {
    return null;
  }
}

// Divide un texto largo en partes de <= maxLength (Discord limita a 2000).
export function splitForDiscord(content: string, maxLength = 1900): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > maxLength) {
    const splitIndex = remaining.lastIndexOf("\n", maxLength);
    const safeSplitIndex = splitIndex > 0 ? splitIndex : maxLength;

    chunks.push(remaining.slice(0, safeSplitIndex).trim());
    remaining = remaining.slice(safeSplitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// ── Mensajes en Discord ─────────────────────────────────────────────
// Guardamos los IDs de los mensajes que publica el bot para poder
// editarlos o borrarlos cuando el comunicado cambia o se re-publica.

async function discordRequest(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  return fetch(`https://discord.com/api/v10${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function postMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<string | null> {
  const response = await discordRequest(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages`,
    { method: "POST", body: { content } },
  );
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { id?: string };
  return data.id ?? null;
}

async function patchMessage(
  token: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<boolean> {
  const response = await discordRequest(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: { content } },
  );
  return response.ok;
}

async function deleteMessage(
  token: string,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const response = await discordRequest(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
  return response.ok;
}

// Publica mensajes nuevos y devuelve sus IDs en orden.
export async function postMessages(
  token: string,
  channelId: string,
  chunks: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const chunk of chunks) {
    const id = await postMessage(token, channelId, chunk);
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

// Borra mensajes existentes.
export async function deleteMessages(
  token: string,
  channelId: string,
  messageIds: string[],
): Promise<void> {
  for (const id of messageIds) {
    await deleteMessage(token, channelId, id);
  }
}

// Edita en el lugar los mensajes existentes, publica los que faltan y
// borra los sobrantes. Devuelve los IDs finales en orden.
export async function syncMessages(
  token: string,
  channelId: string,
  existingIds: string[],
  chunks: string[],
): Promise<string[]> {
  const finalIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const oldId = existingIds[i];
    if (oldId) {
      const edited = await patchMessage(token, channelId, oldId, chunks[i]);
      if (edited) {
        finalIds.push(oldId);
      } else {
        // El mensaje pudo haber sido borrado: lo re-publicamos.
        const newId = await postMessage(token, channelId, chunks[i]);
        if (newId) {
          finalIds.push(newId);
        }
      }
    } else {
      const newId = await postMessage(token, channelId, chunks[i]);
      if (newId) {
        finalIds.push(newId);
      }
    }
  }
  // Sobrantes (ahora hay menos mensajes que antes).
  for (let i = chunks.length; i < existingIds.length; i++) {
    await deleteMessage(token, channelId, existingIds[i]);
  }
  return finalIds;
}

// Tras editar un comunicado publicado, refleja el cambio en Discord.
// Si se cambió de canal, borra los mensajes viejos y publica en el nuevo.
export async function syncCommunicationAfterEdit(
  existing: Communication,
  updated: Communication,
): Promise<Communication> {
  const token = env.DISCORD_BOT_TOKEN;
  const hadMessages = existing.discordMessageIds.length > 0;
  if (!token || !hadMessages) {
    return updated;
  }

  const oldChannel = existing.channelId;
  const newChannel = updated.channelId;

  if (!newChannel) {
    // Se quitó el canal: borramos los mensajes publicados.
    if (oldChannel) {
      await deleteMessages(token, oldChannel, existing.discordMessageIds);
    }
    return (
      (await updateCommunication({ id: updated.id, discordMessageIds: [] })) ??
      updated
    );
  }

  const chunks = splitForDiscord(updated.content);
  let messageIds: string[];
  if (newChannel !== oldChannel) {
    if (oldChannel) {
      await deleteMessages(token, oldChannel, existing.discordMessageIds);
    }
    messageIds = await postMessages(token, newChannel, chunks);
  } else {
    messageIds = await syncMessages(
      token,
      newChannel,
      existing.discordMessageIds,
      chunks,
    );
  }

  return (
    (await updateCommunication({ id: updated.id, discordMessageIds: messageIds })) ??
    updated
  );
}
