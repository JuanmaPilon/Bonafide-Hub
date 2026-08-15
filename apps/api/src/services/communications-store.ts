import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

export type CommunicationStatus = "draft" | "published";

export type Communication = {
  authorName?: string;
  channelId?: string;
  content: string;
  createdAt: Date;
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

export async function markPublished(id: string): Promise<Communication | null> {
  try {
    const record = await prisma.communication.update({
      where: { id },
      data: { status: "published", publishedAt: new Date() },
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

// Publica los mensajes en un canal de Discord usando el token del bot.
export async function publishToDiscordChannel(
  channelId: string,
  chunks: string[],
): Promise<{ ok: boolean; reason?: string }> {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: "DISCORD_BOT_TOKEN no está configurado" };
  }

  for (const chunk of chunks) {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: chunk }),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      if (response.status === 403 || response.status === 404) {
        return {
          ok: false,
          reason:
            "El bot no tiene permisos para publicar en ese canal (View Channel / Send Messages).",
        };
      }
      return {
        ok: false,
        reason: `Error al publicar en el canal (${response.status}): ${details.slice(0, 200)}`,
      };
    }
  }

  return { ok: true };
}
