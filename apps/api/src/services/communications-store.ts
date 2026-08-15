import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

export type CommunicationStatus = "draft" | "published";

// Una instancia es una publicación concreta en Discord (cada vez que se
// publica una plantilla se crea una instancia con snapshot del contenido).
export type CommunicationInstance = {
  authorName?: string;
  channelId: string;
  communicationId: string;
  content: string;
  discordMessageIds: string[];
  guildId: string;
  id: string;
  publishedAt: Date;
  title: string;
};

export type Communication = {
  authorName?: string;
  channelId?: string;
  content: string;
  createdAt: Date;
  guildId: string;
  id: string;
  instances: CommunicationInstance[];
  status: CommunicationStatus;
  title: string;
  updatedAt: Date;
};

function toCommunicationInstance(record: {
  authorName: string | null;
  channelId: string;
  communicationId: string;
  content: string;
  discordMessageIds: string[];
  guildId: string;
  id: string;
  publishedAt: Date;
  title: string;
}): CommunicationInstance {
  return {
    authorName: record.authorName ?? undefined,
    channelId: record.channelId,
    communicationId: record.communicationId,
    content: record.content,
    discordMessageIds: record.discordMessageIds,
    guildId: record.guildId,
    id: record.id,
    publishedAt: record.publishedAt,
    title: record.title,
  };
}

function toCommunication(record: {
  authorName: string | null;
  channelId: string | null;
  content: string;
  createdAt: Date;
  guildId: string;
  id: string;
  instances: Array<{
    authorName: string | null;
    channelId: string;
    communicationId: string;
    content: string;
    discordMessageIds: string[];
    guildId: string;
    id: string;
    publishedAt: Date;
    title: string;
  }>;
  status: string;
  title: string;
  updatedAt: Date;
}): Communication {
  return {
    authorName: record.authorName ?? undefined,
    channelId: record.channelId ?? undefined,
    content: record.content,
    createdAt: record.createdAt,
    guildId: record.guildId,
    id: record.id,
    instances: record.instances.map(toCommunicationInstance),
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
    include: { instances: { orderBy: { publishedAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return records.map(toCommunication);
}

export async function getCommunication(
  id: string,
): Promise<Communication | null> {
  const record = await prisma.communication.findUnique({
    where: { id },
    include: { instances: { orderBy: { publishedAt: "desc" } } },
  });
  return record ? toCommunication(record) : null;
}

// Mensajes publicados (instancias) visibles para los miembros del hub.
export async function listPublishedInstances(
  guildId: string,
): Promise<CommunicationInstance[]> {
  const records = await prisma.communicationInstance.findMany({
    where: { guildId },
    orderBy: { publishedAt: "desc" },
  });
  return records.map(toCommunicationInstance);
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
    include: { instances: { orderBy: { publishedAt: "desc" } } },
  });
  return toCommunication(record);
}

export async function updateCommunication(input: {
  authorName?: string;
  channelId?: string;
  content?: string;
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
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    },
    include: { instances: { orderBy: { publishedAt: "desc" } } },
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

// ── Instancias (mensajes publicados) ────────────────────────────────

export async function createCommunicationInstance(input: {
  authorName?: string;
  channelId: string;
  communicationId: string;
  content: string;
  discordMessageIds: string[];
  guildId: string;
  title: string;
}): Promise<CommunicationInstance> {
  const record = await prisma.communicationInstance.create({
    data: {
      authorName: input.authorName?.trim() || null,
      channelId: input.channelId,
      communicationId: input.communicationId,
      content: input.content,
      discordMessageIds: input.discordMessageIds,
      guildId: input.guildId,
      title: input.title.trim(),
    },
  });
  return toCommunicationInstance(record);
}

export async function getCommunicationInstance(
  id: string,
): Promise<CommunicationInstance | null> {
  const record = await prisma.communicationInstance.findUnique({
    where: { id },
  });
  return record ? toCommunicationInstance(record) : null;
}

export async function deleteCommunicationInstance(
  id: string,
): Promise<boolean> {
  try {
    await prisma.communicationInstance.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function markCommunicationPublished(
  id: string,
): Promise<Communication | null> {
  try {
    const record = await prisma.communication.update({
      where: { id },
      data: { status: "published" },
      include: { instances: { orderBy: { publishedAt: "desc" } } },
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
    {
      method: "POST",
      // allowed_mentions: solo usuarios y roles (nunca @everyone/@here).
      body: { content, allowed_mentions: { parse: ["users", "roles"] } },
    },
  );
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { id?: string };
  return data.id ?? null;
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
