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
  // Juego al que pertenece la fila (wow | lol | ...).
  game: string;
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
  game: string;
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
    game: record.game,
    guildId: record.guildId,
    id: record.id,
    position: record.position,
    role: record.role,
    specName: record.specName,
    updatedAt: record.updatedAt,
  };
}

// Catálogo de la guild. Sin `game` devuelve TODOS los juegos (la web filtra
// por el juego del evento en el cliente, así hace una sola consulta).
export async function listRaidSpecs(
  guildId: string,
  game?: string | null,
): Promise<RaidSpec[]> {
  const key = game?.trim().toLowerCase();
  const records = await prisma.raidSpec.findMany({
    where: key ? { game: key, guildId } : { guildId },
    orderBy: [{ position: "asc" }, { className: "asc" }, { specName: "asc" }],
  });
  return records.map(toRaidSpec);
}

export async function createRaidSpec(input: {
  animated?: boolean;
  className: string;
  emojiId?: string;
  emojiName?: string;
  game?: string;
  guildId: string;
  role: string;
  specName: string;
}): Promise<RaidSpec | null> {
  const game = input.game?.trim().toLowerCase() || "wow";
  const position =
    (await prisma.raidSpec.count({ where: { game, guildId: input.guildId } })) +
    1;
  try {
    const record = await prisma.raidSpec.create({
      data: {
        animated: input.animated ?? false,
        className: input.className,
        emojiId: input.emojiId,
        emojiName: input.emojiName,
        game,
        guildId: input.guildId,
        position,
        role: input.role,
        specName: input.specName,
      },
    });
    return toRaidSpec(record);
  } catch {
    // Duplicado (guildId+game+role+className+specName ya existe).
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
  // Si se pide (y se recuerda) el nombre de personaje al anotarse.
  characterEnabled: boolean;
  completedAt?: Date;
  createdAt: Date;
  createdByUserId?: string;
  createdByUsername?: string;
  description?: string;
  discordEventConfig?: EventDiscordConfig;
  discordEventId?: string;
  discordMessageIds: string[];
  // Si está activo, al marcar el evento como Completado se borra de Discord
  // (evento agendado + aviso) una vez guardado el registro/informe.
  discordCleanupOnComplete: boolean;
  durationMinutes?: number;
  // Juego del evento: decide roles de inscripción y catálogo.
  game: string;
  guildId: string;
  id: string;
  imageUrl?: string;
  paused: boolean;
  publishChannelId?: string;
  recurrenceEnabled: boolean;
  recurrenceEveryDays?: number;
  recurrenceNextAt?: Date;
  recurrencePublishDaysBefore?: number;
  reminderMessageIds: string[];
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
  tagColor?: string;
  tagLabel?: string;
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
  characterEnabled: boolean;
  completedAt: Date | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUsername: string | null;
  description: string | null;
  discordEventConfig: unknown;
  discordEventId: string | null;
  discordMessageIds: string[];
  discordCleanupOnComplete: boolean;
  durationMinutes: number | null;
  game: string;
  guildId: string;
  id: string;
  imageUrl: string | null;
  paused: boolean;
  publishChannelId: string | null;
  recurrenceEnabled: boolean;
  recurrenceEveryDays: number | null;
  recurrenceNextAt: Date | null;
  recurrencePublishDaysBefore: number | null;
  reminderMessageIds: string[];
  reminderHours: number[];
  reminderSentHours: number[];
  reportSentAt: Date | null;
  requiredRoleId: string | null;
  signupClosedAt: Date | null;
  signupDeadline: Date | null;
  startsAt: Date;
  status: string;
  tagColor: string | null;
  tagLabel: string | null;
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
    characterEnabled: record.characterEnabled,
    completedAt: record.completedAt ?? undefined,
    createdAt: record.createdAt,
    createdByUserId: record.createdByUserId ?? undefined,
    createdByUsername: record.createdByUsername ?? undefined,
    description: record.description ?? undefined,
    discordEventConfig:
      (record.discordEventConfig as EventDiscordConfig | null) ?? undefined,
    discordEventId: record.discordEventId ?? undefined,
    discordMessageIds: record.discordMessageIds,
    discordCleanupOnComplete: record.discordCleanupOnComplete,
    durationMinutes: record.durationMinutes ?? undefined,
    game: record.game,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    paused: record.paused,
    publishChannelId: record.publishChannelId ?? undefined,
    recurrenceEnabled: record.recurrenceEnabled,
    recurrenceEveryDays: record.recurrenceEveryDays ?? undefined,
    recurrenceNextAt: record.recurrenceNextAt ?? undefined,
    recurrencePublishDaysBefore:
      record.recurrencePublishDaysBefore ?? undefined,
    reminderMessageIds: record.reminderMessageIds,
    reminderHours: record.reminderHours,
    reminderSentHours: record.reminderSentHours,
    reportSentAt: record.reportSentAt ?? undefined,
    requiredRoleId: record.requiredRoleId ?? undefined,
    signupClosedAt: record.signupClosedAt ?? undefined,
    signupDeadline: record.signupDeadline ?? undefined,
    startsAt: record.startsAt,
    status: record.status,
    tagColor: record.tagColor ?? undefined,
    tagLabel: record.tagLabel ?? undefined,
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

// Eventos cuyo informe de asistencia (quienes tenían el rol y no se anotaron)
// todavía no se envió. Se dispara apenas CIERRAN las inscripciones (mientras el
// evento todavía no empezó), no al terminar; si el evento no tenía cierre de
// inscripciones cargado, queda el fallback de mandarlo al completarse.
export async function listReportPendingEvents(
  guildId: string,
  now: Date = new Date(),
): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: {
      guildId,
      OR: [
        {
          paused: false,
          signupDeadline: { lte: now, not: null },
          startsAt: { gt: now },
          status: "scheduled",
        },
        { completedAt: { not: null }, status: "completed" },
      ],
      reportSentAt: null,
      requiredRoleId: { not: null },
    },
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
  characterEnabled?: boolean;
  description?: string;
  discordCleanupOnComplete?: boolean;
  durationMinutes?: number;
  game?: string;
  guildId: string;
  imageUrl?: string;
  paused?: boolean;
  recurrenceEnabled?: boolean;
  recurrenceEveryDays?: number | null;
  recurrencePublishDaysBefore?: number | null;
  reminderHours?: number[];
  requiredRoleId?: string | null;
  signupDeadline?: string;
  startsAt: string;
  tagColor?: string | null;
  tagLabel?: string | null;
  title: string;
  type: string;
}): Promise<HubEvent> {
  const everyDays = input.recurrenceEveryDays ?? null;
  const record = await prisma.hubEvent.create({
    data: {
      characterEnabled: input.characterEnabled ?? true,
      createdByUserId: input.createdByUserId,
      createdByUsername: input.createdByUsername,
      description: input.description,
      discordCleanupOnComplete: input.discordCleanupOnComplete ?? false,
      durationMinutes: input.durationMinutes,
      game: input.game?.trim().toLowerCase() || "wow",
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      paused: input.paused ?? false,
      recurrenceEnabled: input.recurrenceEnabled ?? false,
      recurrenceEveryDays: everyDays,
      recurrencePublishDaysBefore: input.recurrencePublishDaysBefore ?? null,
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
      tagColor: input.tagColor?.trim() || null,
      tagLabel: input.tagLabel?.trim() || null,
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
    characterEnabled?: boolean;
    description?: string;
    discordCleanupOnComplete?: boolean;
    durationMinutes?: number | null;
    game?: string;
    imageUrl?: string;
    paused?: boolean;
    recurrenceEnabled?: boolean;
    recurrenceEveryDays?: number | null;
    recurrencePublishDaysBefore?: number | null;
    reminderHours?: number[];
    requiredRoleId?: string | null;
    signupDeadline?: string | null;
    startsAt?: string;
    status?: string;
    tagColor?: string | null;
    tagLabel?: string | null;
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
      characterEnabled: input.characterEnabled,
      completedAt: input.status === "completed" ? new Date() : undefined,
      description: input.description,
      discordCleanupOnComplete: input.discordCleanupOnComplete,
      durationMinutes: input.durationMinutes,
      game: input.game?.trim().toLowerCase() || undefined,
      imageUrl: input.imageUrl,
      paused: input.paused,
      recurrenceEnabled: input.recurrenceEnabled,
      recurrenceEveryDays: input.recurrenceEveryDays,
      recurrencePublishDaysBefore: input.recurrencePublishDaysBefore,
      recurrenceNextAt,
      reminderHours: input.reminderHours,
      requiredRoleId:
        input.requiredRoleId === undefined
          ? undefined
          : input.requiredRoleId || null,
      // Si cambia (o se limpia) el cierre de inscripciones, reseteamos el
      // marcador de "aviso ya actualizado por cierre": si vuelve a ser
      // futuro se re-abre, y si vuelve a pasar se re-renderiza de nuevo.
      signupClosedAt: input.signupDeadline !== undefined ? null : undefined,
      signupDeadline:
        input.signupDeadline === null
          ? null
          : input.signupDeadline
            ? new Date(input.signupDeadline)
            : undefined,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      status: input.status,
      tagColor:
        input.tagColor === undefined
          ? undefined
          : input.tagColor?.trim() || null,
      tagLabel:
        input.tagLabel === undefined
          ? undefined
          : input.tagLabel?.trim() || null,
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
  messageIds: string[] = [],
): Promise<HubEvent | null> {
  const current = await prisma.hubEvent.findFirst({
    where: { id: eventId, guildId },
    select: { reminderMessageIds: true, reminderSentHours: true },
  });
  if (!current) {
    return null;
  }
  const mergedHours = Array.from(
    new Set([...current.reminderSentHours, ...hours]),
  );
  const mergedMessages = Array.from(
    new Set([...current.reminderMessageIds, ...messageIds]),
  );
  await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: {
      reminderMessageIds: mergedMessages,
      reminderSentHours: mergedHours,
    },
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

// Eventos ya publicados en Discord que todavía no empezaron. Se usan para
// re-renderizar los avisos cuando cambia algo global del módulo (roles, ejes
// o emojis del catálogo): el roster del embed queda "congelado" hasta que
// alguien se anota, así que hay que refrescarlo a mano.
export async function listPublishedUpcomingEvents(
  guildId: string,
  now: Date = new Date(),
): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: {
      guildId,
      publishChannelId: { not: null },
      startsAt: { gt: now },
      status: "scheduled",
    },
    include: { signups: { orderBy: { createdAt: "asc" } } },
    orderBy: { startsAt: "asc" },
    take: 25,
  });
  return records.map((record) => toEvent(record));
}

// Guilds que tienen algún evento cargado. Se usa al arrancar el API para
// re-renderizar los avisos ya publicados: el embed queda "congelado" con el
// formato con el que se publicó hasta que alguien se anota (o se guarda el
// evento), así que un cambio de layout no se ve hasta el próximo refresco.
export async function listGuildIdsWithEvents(): Promise<string[]> {
  const rows = await prisma.hubEvent.findMany({
    select: { guildId: true },
    distinct: ["guildId"],
  });
  return rows.map((row) => row.guildId);
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

// Series de recurrencia activas (recurrenceEnabled y no pausadas). No filtra
// por fecha: el scheduler decide en cada tick si ya entró en la ventana de
// publicación (X días antes de la fecha del evento) y crea la ocurrencia.
export async function listRecurrenceSeries(): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: {
      paused: false,
      recurrenceEnabled: true,
      recurrenceEveryDays: { not: null },
      recurrenceNextAt: { not: null },
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
    reminderMessageIds?: string[] | null;
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
  if (input.reminderMessageIds !== undefined) {
    data.reminderMessageIds = input.reminderMessageIds ?? [];
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

// Personaje recordado de un jugador en la guild (para precargar los signups).
export async function getEventPlayerCharacter(
  guildId: string,
  userId: string,
): Promise<string | undefined> {
  const record = await prisma.eventPlayerProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { character: true },
  });
  return record?.character?.trim() || undefined;
}

// Guarda (o borra, con null) el personaje recordado del jugador.
async function setEventPlayerCharacter(
  guildId: string,
  userId: string,
  character: string | null,
): Promise<void> {
  await prisma.eventPlayerProfile.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { character, guildId, userId },
    update: { character },
  });
}

// Upsert de la inscripción del usuario actual. Devuelve la inscripción.
// El personaje se recuerda por jugador: si no viene en el request se hereda el
// último que usó (así no hay que escribirlo en cada evento); si viene vacío se
// olvida.
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
  const existing = await prisma.eventSignup.findUnique({
    where: {
      eventId_userId: { eventId: input.eventId, userId: input.userId },
    },
    select: { character: true },
  });
  const providedCharacter = input.character?.trim();
  let character: string | null;
  if (providedCharacter) {
    // Vino un personaje: se guarda en la inscripción y se recuerda.
    character = providedCharacter;
    await setEventPlayerCharacter(input.guildId, input.userId, character);
  } else if (input.character !== undefined && existing?.character) {
    // Lo vaciaron a propósito en una inscripción que ya tenía personaje.
    character = null;
    await setEventPlayerCharacter(input.guildId, input.userId, null);
  } else {
    // No lo mandaron (o es una inscripción nueva sin personaje): heredamos el
    // que el jugador usó la última vez, así no hay que escribirlo de nuevo.
    character =
      (await getEventPlayerCharacter(input.guildId, input.userId)) ?? null;
  }
  const record = await prisma.eventSignup.upsert({
    where: {
      eventId_userId: { eventId: input.eventId, userId: input.userId },
    },
    create: {
      character,
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
      character,
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

// Resetear la inscripción: borra la fila de este evento Y olvida el personaje
// recordado del jugador, así la próxima vez se anota desde cero (rol,
// clase/spec y personaje). Distinto de "quitar inscripción", que solo borra la
// fila (el personaje recordado se mantiene).
export async function resetSignup(
  guildId: string,
  eventId: string,
  userId: string,
): Promise<boolean> {
  const deleted = await deleteSignup(guildId, eventId, userId);
  await setEventPlayerCharacter(guildId, userId, null);
  return deleted;
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
