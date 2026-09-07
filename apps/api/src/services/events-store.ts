import { prisma } from "../db/prisma.js";

// ── Catálogo de opciones del Módulo X ───────────────────────────────
// Clases de WoW, roles de combate y tipos de evento. Se definen acá como
// fuente de verdad y se exponen a la web para poblar los selects.

export const WOW_CLASSES = [
  "Death Knight",
  "Demon Hunter",
  "Druid",
  "Evoker",
  "Hunter",
  "Mage",
  "Monk",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
] as const;

export const COMBAT_ROLES = ["tank", "healer", "dps"] as const;

export const EVENT_TYPES = ["raid", "mplus", "pvp", "social"] as const;

export type WowClass = (typeof WOW_CLASSES)[number];
export type CombatRole = (typeof COMBAT_ROLES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type SignupStatus = "yes" | "tentative" | "no";

export type HubEvent = {
  createdAt: Date;
  createdByUserId?: string;
  createdByUsername?: string;
  description?: string;
  guildId: string;
  id: string;
  imageUrl?: string;
  startsAt: Date;
  status: string;
  title: string;
  type: string;
  updatedAt: Date;
  signups: EventSignup[];
};

export type EventSignup = {
  character?: string;
  createdAt: Date;
  guildId: string;
  id: string;
  note?: string;
  role?: string;
  status: string;
  updatedAt: Date;
  userId: string;
  username: string;
  wowClass?: string;
};

type EventRecord = {
  createdAt: Date;
  createdByUserId: string | null;
  createdByUsername: string | null;
  description: string | null;
  guildId: string;
  id: string;
  imageUrl: string | null;
  startsAt: Date;
  status: string;
  title: string;
  type: string;
  updatedAt: Date;
  signups: SignupRecord[];
};

type SignupRecord = {
  character: string | null;
  createdAt: Date;
  guildId: string;
  id: string;
  note: string | null;
  role: string | null;
  status: string;
  updatedAt: Date;
  userId: string;
  username: string;
  wowClass: string | null;
};

function toSignup(record: SignupRecord): EventSignup {
  return {
    character: record.character ?? undefined,
    createdAt: record.createdAt,
    guildId: record.guildId,
    id: record.id,
    note: record.note ?? undefined,
    role: record.role ?? undefined,
    status: record.status,
    updatedAt: record.updatedAt,
    userId: record.userId,
    username: record.username,
    wowClass: record.wowClass ?? undefined,
  };
}

function toEvent(record: EventRecord): HubEvent {
  return {
    createdAt: record.createdAt,
    createdByUserId: record.createdByUserId ?? undefined,
    createdByUsername: record.createdByUsername ?? undefined,
    description: record.description ?? undefined,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    startsAt: record.startsAt,
    status: record.status,
    title: record.title,
    type: record.type,
    updatedAt: record.updatedAt,
    signups: record.signups.map(toSignup),
  };
}

export async function listEvents(guildId: string): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: { guildId },
    orderBy: { startsAt: "asc" },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  return records.map((record) => toEvent(record));
}

export async function getEvent(
  guildId: string,
  eventId: string,
): Promise<HubEvent | null> {
  const record = await prisma.hubEvent.findFirst({
    where: { id: eventId, guildId },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  return record ? toEvent(record) : null;
}

export async function createEvent(input: {
  createdByUserId?: string;
  createdByUsername?: string;
  description?: string;
  guildId: string;
  imageUrl?: string;
  startsAt: string;
  title: string;
  type: string;
}): Promise<HubEvent> {
  const record = await prisma.hubEvent.create({
    data: {
      createdByUserId: input.createdByUserId,
      createdByUsername: input.createdByUsername,
      description: input.description,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      startsAt: new Date(input.startsAt),
      title: input.title,
      type: input.type,
    },
    include: { signups: true },
  });
  return toEvent(record);
}

export async function updateEvent(
  guildId: string,
  eventId: string,
  input: {
    description?: string;
    imageUrl?: string;
    startsAt?: string;
    status?: string;
    title?: string;
    type?: string;
  },
): Promise<HubEvent | null> {
  const record = await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: {
      description: input.description,
      imageUrl: input.imageUrl,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      status: input.status,
      title: input.title,
      type: input.type,
    },
  });
  if (record.count === 0) {
    return null;
  }
  return getEvent(guildId, eventId);
}

export async function deleteEvent(
  guildId: string,
  eventId: string,
): Promise<boolean> {
  const result = await prisma.hubEvent.deleteMany({
    where: { id: eventId, guildId },
  });
  return result.count > 0;
}

// Upsert de la inscripción del usuario actual. Devuelve la inscripción.
export async function upsertSignup(input: {
  character?: string;
  eventId: string;
  guildId: string;
  note?: string;
  role?: string;
  status: string;
  userId: string;
  username: string;
  wowClass?: string;
}): Promise<EventSignup> {
  const record = await prisma.eventSignup.upsert({
    where: {
      eventId_userId: { eventId: input.eventId, userId: input.userId },
    },
    create: {
      character: input.character,
      eventId: input.eventId,
      guildId: input.guildId,
      note: input.note,
      role: input.role,
      status: input.status,
      userId: input.userId,
      username: input.username,
      wowClass: input.wowClass,
    },
    update: {
      character: input.character,
      note: input.note,
      role: input.role,
      status: input.status,
      username: input.username,
      wowClass: input.wowClass,
    },
  });
  return toSignup(record);
}

export async function deleteSignup(
  guildId: string,
  eventId: string,
  userId: string,
): Promise<boolean> {
  const result = await prisma.eventSignup.deleteMany({
    where: { guildId, eventId, userId },
  });
  return result.count > 0;
}
