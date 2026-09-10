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

// Estados posibles de una inscripción. "tentative" queda como default
// (legacy) pero la UI ofrece todos los estados.
export const SIGNUP_STATUSES = [
  "yes",
  "tentative",
  "bench",
  "late",
  "no",
] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

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

// Edita una spec del catálogo (rol, clase, spec y/o emoji). Devuelve null si
// no existe o si el cambio choca con otra fila (rol+clase+spec duplicados).
export async function updateRaidSpec(
  guildId: string,
  specId: string,
  input: {
    animated?: boolean;
    className?: string;
    emojiId?: string | null;
    emojiName?: string | null;
    role?: string;
    specName?: string;
  },
): Promise<RaidSpec | null> {
  const data: Record<string, unknown> = {};
  if (input.animated !== undefined) {
    data.animated = input.animated;
  }
  if (input.className !== undefined) {
    data.className = input.className;
  }
  if (input.emojiId !== undefined) {
    data.emojiId = input.emojiId;
  }
  if (input.emojiName !== undefined) {
    data.emojiName = input.emojiName;
  }
  if (input.role !== undefined) {
    data.role = input.role;
  }
  if (input.specName !== undefined) {
    data.specName = input.specName;
  }
  try {
    const updated = await prisma.raidSpec.updateMany({
      where: { id: specId, guildId },
      data,
    });
    if (updated.count === 0) {
      return null;
    }
    const fresh = await prisma.raidSpec.findFirst({
      where: { id: specId, guildId },
    });
    return fresh ? toRaidSpec(fresh) : null;
  } catch {
    return null;
  }
}

export type HubEvent = {
  completedAt?: Date;
  createdAt: Date;
  createdByUserId?: string;
  createdByUsername?: string;
  description?: string;
  discordEventConfig?: EventDiscordConfig;
  discordEventId?: string;
  discordMessageIds: string[];
  durationMinutes?: number;
  guildId: string;
  id: string;
  imageUrl?: string;
  paused: boolean;
  publishChannelId?: string;
  recurrenceEnabled: boolean;
  recurrenceEveryDays?: number;
  recurrenceNextAt?: Date;
  reminderHours: number[];
  reminderSentHours: number[];
  // Rol de Discord mínimo para entrar al roster principal: quien no lo tiene
  // y marca "Voy" se guarda como Bench (estilo Raid Helper).
  requiredRoleId?: string;
  reportSentAt?: Date;
  signupClosedAt?: Date;
  signupDeadline?: Date;
  startsAt: Date;
  status: string;
  title: string;
  type: string;
  updatedAt: Date;
  voiceChannelId?: string;
  signups: EventSignup[];
};

// Config guardada de la publicación en Discord de un evento.
export type EventDiscordConfig = {
  createScheduledEvent?: boolean;
  entityType?: "voice" | "external";
  location?: string;
  publishMessage?: boolean;
  recurrence?: string;
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
  completedAt: Date | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUsername: string | null;
  description: string | null;
  discordEventConfig: unknown;
  discordEventId: string | null;
  discordMessageIds: string[];
  durationMinutes: number | null;
  guildId: string;
  id: string;
  imageUrl: string | null;
  paused: boolean;
  publishChannelId: string | null;
  recurrenceEnabled: boolean;
  recurrenceEveryDays: number | null;
  recurrenceNextAt: Date | null;
  reminderHours: number[];
  reminderSentHours: number[];
  reportSentAt: Date | null;
  requiredRoleId: string | null;
  signupClosedAt: Date | null;
  signupDeadline: Date | null;
  startsAt: Date;
  status: string;
  title: string;
  type: string;
  updatedAt: Date;
  voiceChannelId: string | null;
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
    completedAt: record.completedAt ?? undefined,
    createdAt: record.createdAt,
    createdByUserId: record.createdByUserId ?? undefined,
    createdByUsername: record.createdByUsername ?? undefined,
    description: record.description ?? undefined,
    discordEventConfig:
      (record.discordEventConfig as EventDiscordConfig | null) ?? undefined,
    discordEventId: record.discordEventId ?? undefined,
    discordMessageIds: record.discordMessageIds,
    durationMinutes: record.durationMinutes ?? undefined,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    paused: record.paused,
    publishChannelId: record.publishChannelId ?? undefined,
    recurrenceEnabled: record.recurrenceEnabled,
    recurrenceEveryDays: record.recurrenceEveryDays ?? undefined,
    recurrenceNextAt: record.recurrenceNextAt ?? undefined,
    reminderHours: record.reminderHours,
    reminderSentHours: record.reminderSentHours,
    reportSentAt: record.reportSentAt ?? undefined,
    requiredRoleId: record.requiredRoleId ?? undefined,
    signupClosedAt: record.signupClosedAt ?? undefined,
    signupDeadline: record.signupDeadline ?? undefined,
    startsAt: record.startsAt,
    status: record.status,
    title: record.title,
    type: record.type,
    updatedAt: record.updatedAt,
    voiceChannelId: record.voiceChannelId ?? undefined,
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

// Eventos próximos que ya tienen un recordatorio "vencido" por enviar (falta
// X horas para startsAt y ese aviso todavía no se mandó). El bot los consume
// periódicamente para avisar en el canal del aviso a quienes tienen el rol
// requerido y no se anotaron. Devuelve evento + las horas vencidas a enviar.
export async function listReminderDueEvents(
  guildId: string,
  now: Date = new Date(),
): Promise<Array<{ dueHours: number[]; event: HubEvent }>> {
  const records = await prisma.hubEvent.findMany({
    where: { guildId, status: "scheduled", paused: false },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  const nowMs = now.getTime();
  const due: Array<{ dueHours: number[]; event: HubEvent }> = [];
  for (const record of records) {
    const event = toEvent(record);
    if (!event.requiredRoleId || !event.publishChannelId) {
      continue;
    }
    if (event.reminderHours.length === 0) {
      continue;
    }
    const startsMs = event.startsAt.getTime();
    if (startsMs <= nowMs) {
      continue;
    }
    // Si hay cierre de inscripciones, no tiene sentido avisar después de que
    // ya no se puede anotar.
    const deadlineMs = event.signupDeadline?.getTime();
    if (deadlineMs !== undefined && nowMs > deadlineMs) {
      continue;
    }
    const dueHours = event.reminderHours.filter((hours) => {
      if (event.reminderSentHours.includes(hours)) {
        return false;
      }
      const dueAtMs = startsMs - hours * 60 * 60 * 1000;
      return nowMs >= dueAtMs && nowMs < startsMs;
    });
    if (dueHours.length > 0) {
      due.push({ event, dueHours });
    }
  }
  return due;
}

// Eventos completados a los que todavía no se les mandó el informe de
// asistencia (quienes tenían el rol requerido y no se anotaron).
export async function listReportPendingEvents(
  guildId: string,
): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: { guildId, status: "completed", reportSentAt: null },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  return records
    .filter((record) => record.completedAt !== null && record.requiredRoleId)
    .map((record) => toEvent(record));
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
  paused?: boolean;
  recurrenceEnabled?: boolean;
  recurrenceEveryDays?: number | null;
  reminderHours?: number[];
  requiredRoleId?: string | null;
  signupDeadline?: string;
  startsAt: string;
  title: string;
  type: string;
}): Promise<HubEvent> {
  const everyDays = input.recurrenceEveryDays ?? null;
  const record = await prisma.hubEvent.create({
    data: {
      createdByUserId: input.createdByUserId,
      createdByUsername: input.createdByUsername,
      description: input.description,
      durationMinutes: input.durationMinutes,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      paused: input.paused ?? false,
      recurrenceEnabled: input.recurrenceEnabled ?? false,
      recurrenceEveryDays: everyDays,
      recurrenceNextAt:
        input.recurrenceEnabled && everyDays && everyDays > 0
          ? new Date(
              new Date(input.startsAt).getTime() +
                everyDays * 24 * 60 * 60 * 1000,
            )
          : null,
      reminderHours: input.reminderHours ?? [],
      requiredRoleId: input.requiredRoleId ?? null,
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
    paused?: boolean;
    recurrenceEnabled?: boolean;
    recurrenceEveryDays?: number | null;
    reminderHours?: number[];
    requiredRoleId?: string | null;
    signupDeadline?: string | null;
    startsAt?: string;
    status?: string;
    title?: string;
    type?: string;
  },
): Promise<HubEvent | null> {
  const current = await prisma.hubEvent.findFirst({
    where: { id: eventId, guildId },
    select: {
      recurrenceEnabled: true,
      recurrenceEveryDays: true,
      recurrenceNextAt: true,
      startsAt: true,
    },
  });
  if (!current) {
    return null;
  }

  // Recurrencia: si se activa (o cambia el intervalo/fecha base) recalculamos
  // la próxima publicación como startsAt + X días. Si está apagada, se limpia.
  // Editar otros campos no reancla la serie (conserva recurrenceNextAt).
  const nextEnabled = input.recurrenceEnabled ?? current.recurrenceEnabled;
  const nextEveryDays =
    input.recurrenceEveryDays !== undefined
      ? input.recurrenceEveryDays
      : current.recurrenceEveryDays;
  const nextStartsAt = input.startsAt
    ? new Date(input.startsAt)
    : current.startsAt;
  const recurrenceChanged =
    nextEnabled !== current.recurrenceEnabled ||
    (input.recurrenceEveryDays !== undefined &&
      nextEveryDays !== current.recurrenceEveryDays) ||
    (input.startsAt !== undefined &&
      nextStartsAt.getTime() !== current.startsAt.getTime());
  let recurrenceNextAt = current.recurrenceNextAt;
  if (!nextEnabled || !nextEveryDays || nextEveryDays <= 0) {
    recurrenceNextAt = null;
  } else if (!current.recurrenceNextAt || recurrenceChanged) {
    recurrenceNextAt = new Date(
      nextStartsAt.getTime() + nextEveryDays * 24 * 60 * 60 * 1000,
    );
  }

  const record = await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: {
      completedAt: input.status === "completed" ? new Date() : undefined,
      description: input.description,
      durationMinutes: input.durationMinutes,
      imageUrl: input.imageUrl,
      paused: input.paused,
      recurrenceEnabled: input.recurrenceEnabled,
      recurrenceEveryDays: input.recurrenceEveryDays,
      recurrenceNextAt,
      reminderHours: input.reminderHours,
      requiredRoleId:
        input.requiredRoleId === undefined
          ? undefined
          : input.requiredRoleId || null,
      // Si cambia (o se limpia) el cierre de inscripciones, reseteamos el
      // marcador de "aviso ya actualizado por cierre": si vuelve a ser
      // futuro se re-abre, y si vuelve a pasar se re-renderiza de nuevo.
      signupClosedAt:
        input.signupDeadline !== undefined ? null : undefined,
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

// Marca como enviados ciertos recordatorios (horas) de un evento. Devuelve
// el evento actualizado o null si no existe.
export async function markEventRemindersSent(
  guildId: string,
  eventId: string,
  hours: number[],
): Promise<HubEvent | null> {
  const current = await prisma.hubEvent.findFirst({
    where: { id: eventId, guildId },
    select: { reminderSentHours: true },
  });
  if (!current) {
    return null;
  }
  const merged = Array.from(new Set([...current.reminderSentHours, ...hours]));
  await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: { reminderSentHours: merged },
  });
  return getEvent(guildId, eventId);
}

// Marca como enviado el informe de asistencia de un evento completado.
export async function markEventReportSent(
  guildId: string,
  eventId: string,
): Promise<HubEvent | null> {
  const record = await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: { reportSentAt: new Date() },
  });
  if (record.count === 0) {
    return null;
  }
  return getEvent(guildId, eventId);
}

// Eventos publicados cuyo cierre de inscripciones ya pasó y a los que todavía
// no se les re-renderizó el aviso (embed rojo + botones deshabilitados).
// Solo miramos cierres de las últimas 24 h para no perseguir eventos viejos.
export async function listEventsPendingCloseAnnouncement(
  now: Date = new Date(),
): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: {
      publishChannelId: { not: null },
      signupClosedAt: null,
      signupDeadline: {
        gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        lte: now,
      },
      status: "scheduled",
    },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  return records.map((record) => toEvent(record));
}

// Marca que el aviso ya fue actualizado por cierre de inscripciones.
export async function markEventSignupClosed(
  guildId: string,
  eventId: string,
): Promise<void> {
  await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: { signupClosedAt: new Date() },
  });
}

// Eventos con recurrencia activa cuya próxima publicación ya venció (y que no
// están pausados). La API crea una copia y avanza la serie.
export async function listEventsPendingRecurrence(
  now: Date = new Date(),
): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: {
      paused: false,
      recurrenceEnabled: true,
      recurrenceEveryDays: { not: null },
      recurrenceNextAt: { lte: now },
    },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  return records.map((record) => toEvent(record));
}

// Avanza la próxima publicación de una serie recurrente.
export async function setEventRecurrenceNext(
  guildId: string,
  eventId: string,
  nextAt: Date,
): Promise<void> {
  await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: { recurrenceNextAt: nextAt },
  });
}

// Guarda (o limpia) la info de publicación en Discord de un evento. Se usa
// después de sincronizar con Discord para persistir los ids resultantes.
export async function setEventDiscordInfo(
  guildId: string,
  eventId: string,
  input: {
    discordEventConfig?: EventDiscordConfig | null;
    discordEventId?: string | null;
    discordMessageIds?: string[] | null;
    publishChannelId?: string | null;
    voiceChannelId?: string | null;
  },
): Promise<HubEvent | null> {
  const data: Record<string, unknown> = {};
  if (input.discordEventConfig !== undefined) {
    data.discordEventConfig = input.discordEventConfig;
  }
  if (input.discordEventId !== undefined) {
    data.discordEventId = input.discordEventId;
  }
  if (input.discordMessageIds !== undefined) {
    data.discordMessageIds = input.discordMessageIds ?? [];
  }
  if (input.publishChannelId !== undefined) {
    data.publishChannelId = input.publishChannelId;
  }
  if (input.voiceChannelId !== undefined) {
    data.voiceChannelId = input.voiceChannelId;
  }

  const record = await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data,
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
