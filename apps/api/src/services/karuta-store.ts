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

export type KarutaCard = {
  cardName?: string;
  code: string;
  createdAt: Date;
  edition?: number;
  firstSeenAt: Date;
  guildId: string;
  id: string;
  imageUrl?: string;
  lastSeenAt: Date;
  ownerUserId?: string;
  ownerUsername?: string;
  printNumber?: number;
  series?: string;
  status: string;
  wishlistCount?: number;
};

function toKarutaCard(record: {
  cardName: string | null;
  code: string;
  createdAt: Date;
  edition: number | null;
  firstSeenAt: Date;
  guildId: string;
  id: string;
  imageUrl: string | null;
  lastSeenAt: Date;
  ownerUserId: string | null;
  ownerUsername: string | null;
  printNumber: number | null;
  series: string | null;
  status: string;
  wishlistCount: number | null;
}): KarutaCard {
  return {
    cardName: record.cardName ?? undefined,
    code: record.code,
    createdAt: record.createdAt,
    edition: record.edition ?? undefined,
    firstSeenAt: record.firstSeenAt,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    lastSeenAt: record.lastSeenAt,
    ownerUserId: record.ownerUserId ?? undefined,
    ownerUsername: record.ownerUsername ?? undefined,
    printNumber: record.printNumber ?? undefined,
    series: record.series ?? undefined,
    status: record.status,
    wishlistCount: record.wishlistCount ?? undefined,
  };
}

// Cartas raras actualmente poseídas (status=owned), más recientes primero.
export async function listOwnedKarutaCards(
  guildId: string,
  limit = 100,
): Promise<KarutaCard[]> {
  const records = await prisma.karutaCard.findMany({
    where: { guildId, status: "owned" },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
  });
  return records.map(toKarutaCard);
}

// Upsert de posesión: 1 carta (code) = 1 dueño actual. Si alguien ya la
// tenía y aparece con otro dueño (trade/drop), se actualiza el dueño.
export async function upsertKarutaCard(input: {
  cardName?: string;
  code: string;
  edition?: number;
  guildId: string;
  imageUrl?: string;
  ownerUserId?: string;
  ownerUsername?: string;
  printNumber?: number;
  series?: string;
  wishlistCount?: number;
}): Promise<KarutaCard> {
  const now = new Date();
  const record = await prisma.karutaCard.upsert({
    where: { guildId_code: { guildId: input.guildId, code: input.code } },
    create: {
      cardName: input.cardName,
      code: input.code,
      edition: input.edition,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      ownerUserId: input.ownerUserId,
      ownerUsername: input.ownerUsername,
      printNumber: input.printNumber,
      series: input.series,
      status: "owned",
      wishlistCount: input.wishlistCount,
    },
    update: {
      cardName: input.cardName,
      edition: input.edition,
      imageUrl: input.imageUrl,
      ownerUserId: input.ownerUserId,
      ownerUsername: input.ownerUsername,
      printNumber: input.printNumber,
      series: input.series,
      status: "owned",
      wishlistCount: input.wishlistCount,
      lastSeenAt: now,
    },
  });
  return toKarutaCard(record);
}

// Marca una carta como quemada (kb) o fuera de la colección. Best-effort:
// el bot la identifica por nombre + dueño; kb no muestra el code, así que si
// no hay nombre usamos la carta más reciente del dueño (red manual en la web).
export async function burnKarutaCard(input: {
  cardName?: string;
  guildId: string;
  ownerUsername?: string;
}): Promise<KarutaCard | null> {
  if (!input.ownerUsername) {
    return null;
  }

  let match: { id: string } | null = null;

  if (input.cardName) {
    match = await prisma.karutaCard.findFirst({
      where: {
        guildId: input.guildId,
        cardName: input.cardName,
        ownerUsername: input.ownerUsername,
        status: "owned",
      },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  if (!match) {
    match = await prisma.karutaCard.findFirst({
      where: {
        guildId: input.guildId,
        ownerUsername: input.ownerUsername,
        status: "owned",
      },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  if (!match) {
    return null;
  }

  const updated = await prisma.karutaCard.update({
    where: { id: match.id },
    data: { status: "burned", lastSeenAt: new Date() },
  });
  return toKarutaCard(updated);
}

export async function deleteKarutaCard(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    const result = await prisma.karutaCard.deleteMany({
      where: { guildId, id },
    });
    return result.count > 0;
  } catch {
    return false;
  }
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
