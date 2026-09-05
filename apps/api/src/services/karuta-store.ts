import { prisma } from "../db/prisma.js";

export type KarutaDrop = {
  cardName?: string;
  createdAt: Date;
  guildId: string;
  id: string;
  imageUrl?: string;
  printNumber?: number;
  reasons: string[];
  series?: string;
  sourceMessageId: string;
  userId?: string;
  username?: string;
  wishlistCount?: number;
};

function toKarutaDrop(record: {
  cardName: string | null;
  createdAt: Date;
  guildId: string;
  id: string;
  imageUrl: string | null;
  printNumber: number | null;
  reasons: string[];
  series: string | null;
  sourceMessageId: string;
  userId: string | null;
  username: string | null;
  wishlistCount: number | null;
}): KarutaDrop {
  return {
    cardName: record.cardName ?? undefined,
    createdAt: record.createdAt,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    printNumber: record.printNumber ?? undefined,
    reasons: record.reasons,
    series: record.series ?? undefined,
    sourceMessageId: record.sourceMessageId,
    userId: record.userId ?? undefined,
    username: record.username ?? undefined,
    wishlistCount: record.wishlistCount ?? undefined,
  };
}

export async function listRecentKarutaDrops(
  guildId: string,
  limit = 30,
): Promise<KarutaDrop[]> {
  const records = await prisma.karutaDrop.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return records.map(toKarutaDrop);
}

export async function deleteKarutaDrop(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    const result = await prisma.karutaDrop.deleteMany({
      where: { guildId, id },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

// Idempotente por sourceMessageId: si el bot reintenta el mismo mensaje
// (reconexión, doble evento) no duplica la entrada.
export async function createKarutaDrop(input: {
  cardName?: string;
  guildId: string;
  imageUrl?: string;
  printNumber?: number;
  reasons: string[];
  series?: string;
  sourceMessageId: string;
  userId?: string;
  username?: string;
  wishlistCount?: number;
}): Promise<{ created: boolean; drop: KarutaDrop | null }> {
  try {
    const record = await prisma.karutaDrop.create({
      data: {
        cardName: input.cardName,
        guildId: input.guildId,
        imageUrl: input.imageUrl,
        printNumber: input.printNumber,
        reasons: input.reasons,
        series: input.series,
        sourceMessageId: input.sourceMessageId,
        userId: input.userId,
        username: input.username,
        wishlistCount: input.wishlistCount,
      },
    });
    return { created: true, drop: toKarutaDrop(record) };
  } catch (error) {
    // P2002 = unique constraint violation (sourceMessageId ya existe).
    const isDuplicate =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
    if (isDuplicate) {
      return { created: false, drop: null };
    }
    throw error;
  }
}
