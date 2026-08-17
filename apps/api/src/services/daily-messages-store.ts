import { prisma } from "../db/prisma.js";

export type DailyMessage = {
  content: string;
  createdAt: Date;
  enabled: boolean;
  guildId: string;
  id: string;
  updatedAt: Date;
};

function toDailyMessage(record: {
  content: string;
  createdAt: Date;
  enabled: boolean;
  guildId: string;
  id: string;
  updatedAt: Date;
}): DailyMessage {
  return {
    content: record.content,
    createdAt: record.createdAt,
    enabled: record.enabled,
    guildId: record.guildId,
    id: record.id,
    updatedAt: record.updatedAt,
  };
}

export async function listDailyMessages(
  guildId: string,
): Promise<DailyMessage[]> {
  const records = await prisma.dailyMessage.findMany({
    where: { guildId },
    orderBy: { createdAt: "asc" },
  });
  return records.map(toDailyMessage);
}

// Solo las habilitadas, para el bot (el loro no debe usar las pausadas).
export async function listEnabledDailyMessages(
  guildId: string,
): Promise<DailyMessage[]> {
  const records = await prisma.dailyMessage.findMany({
    where: { guildId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  return records.map(toDailyMessage);
}

export async function createDailyMessage(input: {
  content: string;
  guildId: string;
}): Promise<DailyMessage> {
  const record = await prisma.dailyMessage.create({
    data: {
      content: input.content,
      guildId: input.guildId,
      enabled: true,
    },
  });
  return toDailyMessage(record);
}

export async function updateDailyMessage(input: {
  content?: string;
  enabled?: boolean;
  guildId: string;
  id: string;
}): Promise<DailyMessage | null> {
  try {
    const updated = await prisma.dailyMessage.updateMany({
      where: { id: input.id, guildId: input.guildId },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    const record = await prisma.dailyMessage.findUnique({
      where: { id: input.id },
    });
    return record ? toDailyMessage(record) : null;
  } catch {
    return null;
  }
}

export async function deleteDailyMessage(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    const result = await prisma.dailyMessage.deleteMany({
      where: { guildId, id },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}
