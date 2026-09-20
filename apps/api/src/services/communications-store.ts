import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

export type CommunicationStatus = "draft" | "published";

export type Communication = {
  authorName?: string;
  channelId?: string;
  content: string;
  createdAt: Date;
  // IDs de los mensajes en Discord (varios si el texto se partió en partes).
  discordMessageIds: string[];
  guildId: string;
  id: string;
  // Última publicación. Sin fecha = borrador.
  publishedAt?: Date;
  status: CommunicationStatus;
  tagColor?: string;
  tagLabel?: string;
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
  tagColor: string | null;
  tagLabel: string | null;
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
    tagColor: record.tagColor ?? undefined,
    tagLabel: record.tagLabel ?? undefined,
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

export async function getCommunication(
  id: string,
): Promise<Communication | null> {
  const record = await prisma.communication.findUnique({ where: { id } });
  return record ? toCommunication(record) : null;
}

// Comunicados publicados: es lo que ve el hub (cualquier miembro de la guild).
export async function listPublishedCommunications(
  guildId: string,
): Promise<Communication[]> {
  const records = await prisma.communication.findMany({
    where: { guildId, status: "published" },
    orderBy: { publishedAt: "desc" },
  });
  return records.map(toCommunication);
}

export async function createCommunication(input: {
  authorName?: string;
  channelId?: string;
  content: string;
  guildId: string;
  tagColor?: string;
  tagLabel?: string;
  title: string;
}): Promise<Communication> {
  const record = await prisma.communication.create({
    data: {
      authorName: input.authorName?.trim() || null,
      channelId: input.channelId?.trim() || null,
      content: input.content,
      guildId: input.guildId,
      tagColor: input.tagColor?.trim() || null,
      tagLabel: input.tagLabel?.trim() || null,
      title: input.title.trim(),
    },
  });
  return toCommunication(record);
}

export async function updateCommunication(input: {
  authorName?: string;
  channelId?: string;
  content?: string;
  id: string;
  tagColor?: string;
  tagLabel?: string;
  title?: string;
}): Promise<Communication | null> {
  try {
    // El comunicado es una sola fila (plantilla y mensaje publicado son lo
    // mismo), así que el tag no hay que propagarlo a ningún lado.
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
        ...(input.tagColor !== undefined
          ? { tagColor: input.tagColor.trim() || null }
          : {}),
        ...(input.tagLabel !== undefined
          ? { tagLabel: input.tagLabel.trim() || null }
          : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      },
    });
    return toCommunication(record);
  } catch {
    return null;
  }
}

export async function deleteCommunication(id: string): Promise<boolean> {
  try {
    await prisma.communication.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// ── Publicación ─────────────────────────────────────────────────────
// Un comunicado tiene UN juego de mensajes en Discord: al publicarlo (o al
// guardar cambios de uno ya publicado, que se editan en su lugar) se guardan
// acá sus IDs, el canal y la fecha de la última publicación.

export async function setCommunicationPublication(input: {
  channelId?: string;
  discordMessageIds: string[];
  id: string;
  // Fecha de la publicación. Se manda solo la PRIMERA vez: después, editar no
  // cambia la fecha que se muestra en el hub (para eso está updatedAt).
  publishedAt?: Date;
}): Promise<Communication | null> {
  try {
    const record = await prisma.communication.update({
      where: { id: input.id },
      data: {
        ...(input.channelId !== undefined
          ? { channelId: input.channelId.trim() || null }
          : {}),
        discordMessageIds: input.discordMessageIds,
        ...(input.publishedAt !== undefined
          ? { publishedAt: input.publishedAt }
          : {}),
        status: "published",
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

async function editMessage(
  token: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<boolean> {
  const response = await discordRequest(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: { content, allowed_mentions: { parse: ["users", "roles"] } },
    },
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

// Edita mensajes existentes en su lugar (sin republicar). Si el número de
// partes cambió, borra las viejas y publica las nuevas, devolviendo los IDs.
export async function editMessages(
  token: string,
  channelId: string,
  messageIds: string[],
  chunks: string[],
): Promise<string[]> {
  if (messageIds.length === chunks.length) {
    const edited: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const ok = await editMessage(
        token,
        channelId,
        messageIds[index],
        chunks[index],
      );
      if (ok) {
        edited.push(messageIds[index]);
      }
    }
    return edited;
  }

  await deleteMessages(token, channelId, messageIds);
  return postMessages(token, channelId, chunks);
}
