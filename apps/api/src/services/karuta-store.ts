import { prisma } from "../db/prisma.js";

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

// Grab de una carta ya registrada en la colección: transfiere el dueño.
// Best-effort: si la carta nunca se vio con `kv` no está en la colección y no
// podemos saber su rareza, así que se ignora.
export async function processKarutaGrab(input: {
  code: string;
  grabberUsername?: string;
  guildId: string;
  wishlistCount?: number;
}): Promise<{ processed: boolean; card: KarutaCard | null }> {
  const card = await prisma.karutaCard.findUnique({
    where: { guildId_code: { guildId: input.guildId, code: input.code } },
  });
  if (!card || card.status !== "owned") {
    return { processed: false, card: null };
  }

  const updated = await prisma.karutaCard.update({
    where: { id: card.id },
    data: {
      ownerUsername: input.grabberUsername,
      wishlistCount: input.wishlistCount ?? card.wishlistCount,
      lastSeenAt: new Date(),
    },
  });

  return { processed: true, card: toKarutaCard(updated) };
}

// Transferencia aceptada (kg): cambia el dueño de una carta ya registrada.
// El bot identifica la carta por code y actualiza el dueño.
export async function processKarutaTransfer(input: {
  code: string;
  guildId: string;
  toUsername?: string;
}): Promise<{ processed: boolean; card: KarutaCard | null }> {
  const card = await prisma.karutaCard.findUnique({
    where: { guildId_code: { guildId: input.guildId, code: input.code } },
  });
  if (!card || card.status !== "owned") {
    return { processed: false, card: null };
  }

  const updated = await prisma.karutaCard.update({
    where: { id: card.id },
    data: { ownerUsername: input.toUsername, lastSeenAt: new Date() },
  });

  return { processed: true, card: toKarutaCard(updated) };
}

export type KarutaAlbumImage = { page: number; url: string };

export type KarutaAlbum = {
  albumName?: string;
  background?: string;
  channelId?: string;
  createdAt: Date;
  guildId: string;
  id: string;
  imageUrl?: string;
  images: KarutaAlbumImage[];
  messageId?: string;
  ownerUserId?: string;
  ownerUsername?: string;
  page?: number;
  totalPages?: number;
  updatedAt: Date;
};

function normalizeAlbumImages(raw: unknown): KarutaAlbumImage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const images: KarutaAlbumImage[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "url" in entry &&
      typeof (entry as { url?: unknown }).url === "string"
    ) {
      const page =
        "page" in entry &&
        typeof (entry as { page?: unknown }).page === "number"
          ? ((entry as { page: number }).page as number)
          : 0;
      images.push({ page, url: (entry as { url: string }).url });
    }
  }
  return images.sort((a, b) => a.page - b.page);
}

function toKarutaAlbum(record: {
  albumName: string | null;
  background: string | null;
  channelId: string | null;
  createdAt: Date;
  guildId: string;
  id: string;
  imageUrl: string | null;
  images: unknown;
  messageId: string | null;
  ownerUserId: string | null;
  ownerUsername: string | null;
  page: number | null;
  totalPages: number | null;
  updatedAt: Date;
}): KarutaAlbum {
  return {
    albumName: record.albumName ?? undefined,
    background: record.background ?? undefined,
    channelId: record.channelId ?? undefined,
    createdAt: record.createdAt,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    images: normalizeAlbumImages(record.images),
    messageId: record.messageId ?? undefined,
    ownerUserId: record.ownerUserId ?? undefined,
    ownerUsername: record.ownerUsername ?? undefined,
    page: record.page ?? undefined,
    totalPages: record.totalPages ?? undefined,
    updatedAt: record.updatedAt,
  };
}

// Álbumes de Karuta, más recientes primero.
export async function listKarutaAlbums(
  guildId: string,
  limit = 100,
): Promise<KarutaAlbum[]> {
  const records = await prisma.karutaAlbum.findMany({
    where: { guildId },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return records.map(toKarutaAlbum);
}

// Todos los álbumes (de todas las guilds), más recientes primero. Lo usa el
// sincronizador que renueva las URLs de imagen vencidas.
export async function listAllKarutaAlbums(limit = 200): Promise<KarutaAlbum[]> {
  const records = await prisma.karutaAlbum.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return records.map(toKarutaAlbum);
}

// Upsert best-effort de un álbum (ka). Guarda la imagen de cada página que
// se ve: si llega una página nueva, la agrega; si ya existía, la reemplaza.
export async function upsertKarutaAlbum(input: {
  albumName?: string;
  background?: string;
  channelId?: string;
  guildId: string;
  imageUrl?: string;
  messageId?: string;
  ownerUserId?: string;
  ownerUsername?: string;
  page?: number;
  totalPages?: number;
}): Promise<KarutaAlbum> {
  const pageNumber = input.page ?? 1;

  const existing = await prisma.karutaAlbum.findFirst({
    where: {
      guildId: input.guildId,
      albumName: input.albumName,
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    const existingImages = normalizeAlbumImages(existing.images);
    const nextImages = [...existingImages];
    if (input.imageUrl) {
      const index = nextImages.findIndex((image) => image.page === pageNumber);
      if (index >= 0) {
        nextImages[index] = { page: pageNumber, url: input.imageUrl };
      } else {
        nextImages.push({ page: pageNumber, url: input.imageUrl });
        nextImages.sort((a, b) => a.page - b.page);
      }
    }

    const updated = await prisma.karutaAlbum.update({
      where: { id: existing.id },
      data: {
        background: input.background,
        channelId: input.channelId ?? existing.channelId,
        imageUrl: input.imageUrl ?? existing.imageUrl,
        images: nextImages,
        messageId: input.messageId ?? existing.messageId,
        ownerUsername: input.ownerUsername,
        page: pageNumber,
        totalPages: input.totalPages,
      },
    });
    return toKarutaAlbum(updated);
  }

  const created = await prisma.karutaAlbum.create({
    data: {
      albumName: input.albumName,
      background: input.background,
      channelId: input.channelId,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      images: input.imageUrl ? [{ page: pageNumber, url: input.imageUrl }] : [],
      messageId: input.messageId,
      ownerUserId: input.ownerUserId,
      ownerUsername: input.ownerUsername,
      page: pageNumber,
      totalPages: input.totalPages,
    },
  });
  return toKarutaAlbum(created);
}

export async function deleteKarutaAlbum(
  guildId: string,
  id: string,
): Promise<boolean> {
  try {
    // Las páginas cacheadas se borran en cascada (relación KarutaAlbumPage).
    const result = await prisma.karutaAlbum.deleteMany({
      where: { guildId, id },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

// ── Imágenes de páginas cacheadas (bytes propios) ───────────────────
// Guarda (o reemplaza) la imagen de una página con los bytes ya descargados.
export async function saveKarutaAlbumPageImage(input: {
  albumId: string;
  data: Buffer;
  guildId: string;
  mimeType: string;
  page: number;
}): Promise<void> {
  await prisma.karutaAlbumPage.upsert({
    create: {
      albumId: input.albumId,
      data: new Uint8Array(input.data),
      guildId: input.guildId,
      mimeType: input.mimeType,
      page: input.page,
    },
    update: {
      data: new Uint8Array(input.data),
      mimeType: input.mimeType,
    },
    where: { albumId_page: { albumId: input.albumId, page: input.page } },
  });
}

// Qué páginas de estos álbumes ya están cacheadas (sin traer los bytes).
export async function listCachedKarutaAlbumPages(
  albumIds: string[],
): Promise<Array<{ albumId: string; page: number }>> {
  if (albumIds.length === 0) {
    return [];
  }
  return prisma.karutaAlbumPage.findMany({
    select: { albumId: true, page: true },
    where: { albumId: { in: albumIds } },
  });
}

// Bytes de una página cacheada (para servirla por el API público).
export async function getKarutaAlbumPageImage(
  guildId: string,
  albumId: string,
  page: number,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const record = await prisma.karutaAlbumPage.findFirst({
    select: { data: true, mimeType: true },
    where: { albumId, guildId, page },
  });
  if (!record) {
    return null;
  }
  return { data: Buffer.from(record.data), mimeType: record.mimeType };
}
