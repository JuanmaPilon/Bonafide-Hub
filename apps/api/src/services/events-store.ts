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

// Roles de combate estilo Raid Helper (4 ejes). "dps" queda como valor
// legacy aceptado en inscripciones viejas pero no se ofrece en el catálogo.
export const RAID_ROLES = ["tank", "healer", "melee", "ranged"] as const;
export const COMBAT_ROLES = RAID_ROLES;
export const SIGNUP_ROLES = [...RAID_ROLES, "dps"] as const;

export const EVENT_TYPES = ["raid", "mplus", "pvp", "social"] as const;

export type WowClass = (typeof WOW_CLASSES)[number];
export type RaidRole = (typeof RAID_ROLES)[number];
export type CombatRole = RaidRole;
export type EventType = (typeof EVENT_TYPES)[number];
export type SignupStatus = "yes" | "tentative" | "no";

// ── Catálogo de specs configurable por guild (RaidSpec) ─────────────

export type RaidSpec = {
  animated: boolean;
  className: string;
  createdAt: Date;
  emojiId?: string;
  emojiName?: string;
  guildId: string;
  id: string;
  position: number;
  role: string;
  specName: string;
  updatedAt: Date;
};

type RaidSpecRecord = {
  animated: boolean;
  className: string;
  createdAt: Date;
  emojiId: string | null;
  emojiName: string | null;
  guildId: string;
  id: string;
  position: number;
  role: string;
  specName: string;
  updatedAt: Date;
};

function toRaidSpec(record: RaidSpecRecord): RaidSpec {
  return {
    animated: record.animated,
    className: record.className,
    createdAt: record.createdAt,
    emojiId: record.emojiId ?? undefined,
    emojiName: record.emojiName ?? undefined,
    guildId: record.guildId,
    id: record.id,
    position: record.position,
    role: record.role,
    specName: record.specName,
    updatedAt: record.updatedAt,
  };
}

export async function listRaidSpecs(guildId: string): Promise<RaidSpec[]> {
  const records = await prisma.raidSpec.findMany({
    where: { guildId },
    orderBy: [{ position: "asc" }, { className: "asc" }, { specName: "asc" }],
  });
  return records.map(toRaidSpec);
}

export async function createRaidSpec(input: {
  animated?: boolean;
  className: string;
  emojiId?: string;
  emojiName?: string;
  guildId: string;
  role: string;
  specName: string;
}): Promise<RaidSpec | null> {
  const position =
    (await prisma.raidSpec.count({ where: { guildId: input.guildId } })) + 1;
  try {
    const record = await prisma.raidSpec.create({
      data: {
        animated: input.animated ?? false,
        className: input.className,
        emojiId: input.emojiId,
        emojiName: input.emojiName,
        guildId: input.guildId,
        position,
        role: input.role,
        specName: input.specName,
      },
    });
    return toRaidSpec(record);
  } catch {
    // Duplicado (guildId+role+className+specName ya existe).
    return null;
  }
}

export async function deleteRaidSpec(
  guildId: string,
  specId: string,
): Promise<boolean> {
  const result = await prisma.raidSpec.deleteMany({
    where: { id: specId, guildId },
  });
  return result.count > 0;
}

export type HubEvent = {
  createdAt: Date;
  createdByUserId?: string;
  createdByUsername?: string;
  description?: string;
  durationMinutes?: number;
  guildId: string;
  id: string;
  imageUrl?: string;
  signupDeadline?: Date;
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
  spec?: string;
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
  durationMinutes: number | null;
  guildId: string;
  id: string;
  imageUrl: string | null;
  signupDeadline: Date | null;
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
  spec: string | null;
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
    spec: record.spec ?? undefined,
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
    durationMinutes: record.durationMinutes ?? undefined,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    signupDeadline: record.signupDeadline ?? undefined,
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
  durationMinutes?: number;
  guildId: string;
  imageUrl?: string;
  signupDeadline?: string;
  startsAt: string;
  title: string;
  type: string;
}): Promise<HubEvent> {
  const record = await prisma.hubEvent.create({
    data: {
      createdByUserId: input.createdByUserId,
      createdByUsername: input.createdByUsername,
      description: input.description,
      durationMinutes: input.durationMinutes,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      signupDeadline: input.signupDeadline
        ? new Date(input.signupDeadline)
        : null,
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
    durationMinutes?: number | null;
    imageUrl?: string;
    signupDeadline?: string | null;
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
      durationMinutes: input.durationMinutes,
      imageUrl: input.imageUrl,
      signupDeadline:
        input.signupDeadline === null
          ? null
          : input.signupDeadline
            ? new Date(input.signupDeadline)
            : undefined,
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
  spec?: string;
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
      spec: input.spec,
      status: input.status,
      userId: input.userId,
      username: input.username,
      wowClass: input.wowClass,
    },
    update: {
      character: input.character,
      note: input.note,
      role: input.role,
      spec: input.spec,
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

export type EventImage = {
  createdAt: Date;
  dataUrl: string;
  guildId: string;
  id: string;
  name?: string;
  updatedAt: Date;
};

export async function listEventImages(guildId: string): Promise<EventImage[]> {
  const records = await prisma.eventImage.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
  });
  return records.map((record) => ({
    createdAt: record.createdAt,
    dataUrl: record.dataUrl,
    guildId: record.guildId,
    id: record.id,
    name: record.name ?? undefined,
    updatedAt: record.updatedAt,
  }));
}

export async function createEventImage(input: {
  dataUrl: string;
  guildId: string;
  name?: string;
}): Promise<EventImage> {
  const record = await prisma.eventImage.create({
    data: {
      dataUrl: input.dataUrl,
      guildId: input.guildId,
      name: input.name,
    },
  });
  return {
    createdAt: record.createdAt,
    dataUrl: record.dataUrl,
    guildId: record.guildId,
    id: record.id,
    name: record.name ?? undefined,
    updatedAt: record.updatedAt,
  };
}

export async function deleteEventImage(
  guildId: string,
  imageId: string,
): Promise<boolean> {
  const result = await prisma.eventImage.deleteMany({
    where: { id: imageId, guildId },
  });
  return result.count > 0;
}
