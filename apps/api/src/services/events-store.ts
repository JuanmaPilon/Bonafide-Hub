import { Prisma, prisma } from "../db/prisma.js";
import { listTemplateSpecs } from "./event-templates.js";
import {
  listRosterProfiles,
  type RosterProfile,
} from "./roster-store.js";
import {
  DEFAULT_TAG_COLOR,
  MAX_TAGS,
  normalizeTags,
  tagsFromRecord,
  type Tag,
} from "./tags.js";

// Etiquetas de un evento: los helpers viven en tags.ts (los comparte con los
// comunicados). Se mantienen los nombres viejos para no tocar los call sites.
export const MAX_EVENT_TAGS = MAX_TAGS;
export const DEFAULT_EVENT_TAG_COLOR = DEFAULT_TAG_COLOR;
export const normalizeEventTags = normalizeTags;
export type EventTag = Tag;

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

// Catálogo de clases/specs de un juego. La BASE sale del CÓDIGO
// (event-templates): así no depende de que alguien lo cargue a mano en la base.
// Las filas guardadas se agregan solo si NO están en la plantilla, así una guild
// que ya tenía sus propias clases/specs no pierde nada.
// Sin `game` devuelve TODOS los juegos (la web filtra por el juego del evento
// en el cliente, así hace una sola consulta).
export async function listRaidSpecs(
  guildId: string,
  game?: string | null,
): Promise<RaidSpec[]> {
  const key = game?.trim().toLowerCase();
  const records = await prisma.raidSpec.findMany({
    where: key ? { game: key, guildId } : { guildId },
    orderBy: [{ position: "asc" }, { className: "asc" }, { specName: "asc" }],
  });
  const stored = records.map(toRaidSpec);
  const storedByKey = new Map(
    stored.map((spec) => [
      `${spec.game}|${spec.className}|${spec.specName}`,
      spec,
    ]),
  );

  // La plantilla define QUÉ clases/specs existen y en qué orden. Si la guild ya
  // tenía guardada esa fila, se conserva lo suyo (emoji, id, fechas): el emoji
  // por spec que hayan cargado antes no se pierde.
  const codeKeys = new Set<string>();
  const fromCode: RaidSpec[] = listTemplateSpecs(key).map((spec) => {
    const mappingKey = `${spec.game}|${spec.className}|${spec.specName}`;
    codeKeys.add(mappingKey);
    const saved = storedByKey.get(mappingKey);
    return {
      animated: saved?.animated ?? false,
      className: spec.className,
      createdAt: saved?.createdAt ?? new Date(),
      emojiId: saved?.emojiId,
      emojiName: saved?.emojiName,
      game: spec.game,
      guildId,
      // El id de las del código es derivado y estable: no son filas de la tabla.
      id: saved?.id ?? mappingKey,
      position: saved?.position ?? 0,
      role: spec.role,
      specName: spec.specName,
      updatedAt: saved?.updatedAt ?? new Date(),
    };
  });

  // Lo que la guild tenga cargado y NO esté en la plantilla se agrega al final.
  return [
    ...fromCode,
    ...stored.filter(
      (spec) =>
        !codeKeys.has(`${spec.game}|${spec.className}|${spec.specName}`),
    ),
  ];
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
  // Mensaje de la encuesta nativa de Discord (plantilla "encuesta").
  discordPollMessageId?: string;
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
  // Duración de la encuesta en horas (vacío = la de Discord: 24 h).
  pollHours?: number;
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
  tags: EventTag[];
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
  // Clase del roster de quien no eligió una al anotarse: en Discord el botón
  // de "no asisto" no abre el asistente, así que sin esto queda sin emoji en
  // el aviso. Es sólo para mostrar (el emoji del aviso y de la web): no cambia
  // la columna del roster ni lo que está guardado.
  rosterClass?: { className: string; specName: string };
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
  discordPollMessageId: string | null;
  discordCleanupOnComplete: boolean;
  durationMinutes: number | null;
  game: string;
  guildId: string;
  id: string;
  imageUrl: string | null;
  paused: boolean;
  pollHours: number | null;
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
  tags: unknown;
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

function toSignup(
  record: SignupRecord,
  roster?: Map<string, RosterProfile>,
  game?: string,
): EventSignup {
  // Sólo para quien no eligió clase: el emoji del aviso sale del roster, que es
  // la ficha que la guild ya tiene cargada.
  const profile = record.wowClass ? undefined : roster?.get(record.userId);
  return {
    character: record.character ?? undefined,
    createdAt: record.createdAt,
    guildId: record.guildId,
    id: record.id,
    note: record.note ?? undefined,
    role: record.role ?? undefined,
    rosterClass:
      profile && profile.game === game
        ? { className: profile.className, specName: profile.specName }
        : undefined,
    spec: record.spec ?? undefined,
    status: record.status,
    updatedAt: record.updatedAt,
    userId: record.userId,
    username: record.username,
    wowClass: record.wowClass ?? undefined,
  };
}

// Etiquetas de un evento: la lista guardada y, si está vacía, la etiqueta
// única del modelo viejo (así los eventos anteriores siguen mostrando la suya
// sin migrar la base).
function eventTags(record: EventRecord): EventTag[] {
  return tagsFromRecord(record);
}

function toEvent(
  record: EventRecord,
  roster?: Map<string, RosterProfile>,
): HubEvent {
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
    discordPollMessageId: record.discordPollMessageId ?? undefined,
    discordCleanupOnComplete: record.discordCleanupOnComplete,
    durationMinutes: record.durationMinutes ?? undefined,
    game: record.game,
    guildId: record.guildId,
    id: record.id,
    imageUrl: record.imageUrl ?? undefined,
    paused: record.paused,
    pollHours: record.pollHours ?? undefined,
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
    tags: eventTags(record),
    title: record.title,
    type: record.type,
    updatedAt: record.updatedAt,
    voiceChannelId: record.voiceChannelId ?? undefined,
    signups: record.signups.map((signup) =>
      toSignup(signup, roster, record.game),
    ),
  };
}

// Ficha del roster por persona, sólo si alguna inscripción quedó sin clase: en
// el caso normal no cuesta una consulta de más.
async function rosterClassesFor(
  records: Array<{ signups: Array<{ wowClass?: string | null }> }>,
  guildId: string,
): Promise<Map<string, RosterProfile> | undefined> {
  const haceFalta = records.some((record) =>
    record.signups.some((signup) => !signup.wowClass),
  );
  return haceFalta ? await listRosterProfiles(guildId) : undefined;
}

export async function listEvents(guildId: string): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: { guildId },
    orderBy: { startsAt: "asc" },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  const roster = await rosterClassesFor(records, guildId);
  return records.map((record) => toEvent(record, roster));
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
  if (!record) {
    return null;
  }
  const roster = await rosterClassesFor([record], guildId);
  return toEvent(record, roster);
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
  pollHours?: number | null;
  recurrenceEnabled?: boolean;
  recurrenceEveryDays?: number | null;
  recurrencePublishDaysBefore?: number | null;
  reminderHours?: number[];
  requiredRoleId?: string | null;
  signupDeadline?: string;
  startsAt: string;
  tags?: unknown;
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
      pollHours: input.pollHours ?? null,
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
      tags: normalizeEventTags(input.tags),
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
    pollHours?: number | null;
    recurrenceEnabled?: boolean;
    recurrenceEveryDays?: number | null;
    recurrencePublishDaysBefore?: number | null;
    reminderHours?: number[];
    requiredRoleId?: string | null;
    signupDeadline?: string | null;
    startsAt?: string;
    status?: string;
    tags?: unknown;
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
      pollHours:
        input.pollHours === undefined ? undefined : input.pollHours || null,
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
      // Al guardar etiquetas se limpian las columnas viejas: si no, una lista
      // vacía haría reaparecer la etiqueta única del modelo anterior.
      tagColor: input.tags === undefined ? undefined : null,
      tagLabel: input.tags === undefined ? undefined : null,
      tags:
        input.tags === undefined ? undefined : normalizeEventTags(input.tags),
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

// Margen después del final para dar por terminado un evento (por si se
// estira) y duración asumida cuando el evento no la tiene cargada.
const EVENT_AUTO_COMPLETE_GRACE_MS = 60 * 60 * 1000;
const EVENT_DEFAULT_DURATION_MINUTES = 180;

// Momento en que el evento ya terminó: inicio + duración (o 3 h) + 1 h. Es la
// referencia del cierre automático: nadie marca "Completado" solo, así que sin
// esto el evento quedaba en la grilla y su aviso en Discord para siempre.
export function eventAutoCompleteAt(event: HubEvent): Date {
  const minutes = event.durationMinutes ?? EVENT_DEFAULT_DURATION_MINUTES;
  return new Date(
    event.startsAt.getTime() + minutes * 60_000 + EVENT_AUTO_COMPLETE_GRACE_MS,
  );
}

// Eventos que ya terminaron y siguen "scheduled" (los que hay que completar
// solos). Quedan afuera:
//  - los pausados: pausar congela el evento a propósito;
//  - los moldes de una serie (recurrenceEnabled) SIN limpieza en Discord: ahí
//    cerrar la ocurrencia no aporta nada (no hay nada que borrar) y la tarjeta
//    desaparecería de la grilla hasta que se publique la próxima ocurrencia.
//    Con la limpieza activada sí se cierran: el cierre archiva la ocurrencia,
//    mueve la serie y la re-publica sola (ver applyEventCompletion).
export async function listEventsPendingAutoComplete(
  now: Date = new Date(),
): Promise<HubEvent[]> {
  const records = await prisma.hubEvent.findMany({
    where: {
      OR: [{ recurrenceEnabled: false }, { discordCleanupOnComplete: true }],
      paused: false,
      // Filtro grueso en SQL (descarta los que ni empezaron) y fino en memoria,
      // porque el final depende de la duración de cada evento.
      startsAt: { lte: new Date(now.getTime() - EVENT_AUTO_COMPLETE_GRACE_MS) },
      status: "scheduled",
    },
    include: { signups: { orderBy: { createdAt: "asc" } } },
  });
  return records
    .map((record) => toEvent(record))
    .filter((event) => eventAutoCompleteAt(event).getTime() <= now.getTime());
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
    discordPollMessageId?: string | null;
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
  if (input.discordPollMessageId !== undefined) {
    data.discordPollMessageId = input.discordPollMessageId;
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

// ¿Es la misma clase? Se compara sin distinguir mayúsculas ni espacios, y
// cuando falta algún dato se considera que SÍ lo es (no invalidamos nada por
// falta de información).
function sameClass(left?: string | null, right?: string | null): boolean {
  const a = left?.trim().toLowerCase();
  const b = right?.trim().toLowerCase();
  if (!a || !b) {
    return true;
  }
  return a === b;
}

// Personaje recordado de un jugador en la guild (para precargar los signups).
// `wowClass` es la clase con la que se está anotando AHORA: si cambió de clase
// el nombre viejo no aplica (juega otro personaje) y devolvemos undefined para
// que se lo vuelvan a pedir.
export async function getEventPlayerCharacter(
  guildId: string,
  userId: string,
  wowClass?: string,
): Promise<string | undefined> {
  const record = await prisma.eventPlayerProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { character: true, wowClass: true },
  });
  const character = record?.character?.trim();
  if (!character || !sameClass(record?.wowClass, wowClass)) {
    return undefined;
  }
  return character;
}

// Datos recordados del jugador (los usa el bot para saber si el personaje que
// tiene sirve para la clase que está eligiendo).
export async function getEventPlayerProfile(
  guildId: string,
  userId: string,
): Promise<{ character?: string; wowClass?: string }> {
  const record = await prisma.eventPlayerProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { character: true, wowClass: true },
  });
  return {
    character: record?.character?.trim() || undefined,
    wowClass: record?.wowClass?.trim() || undefined,
  };
}

// Guarda (o borra, con null) el personaje recordado del jugador.
// `wowClass === undefined` deja la clase guardada como estaba.
async function setEventPlayerCharacter(
  guildId: string,
  userId: string,
  character: string | null,
  wowClass?: string | null,
): Promise<void> {
  const classValue =
    wowClass === undefined ? undefined : wowClass?.trim() || null;
  await prisma.eventPlayerProfile.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { character, guildId, userId, wowClass: classValue ?? null },
    update:
      classValue === undefined
        ? { character }
        : { character, wowClass: classValue },
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
    // Vino un personaje: se guarda en la inscripción y se recuerda CON la
    // clase que eligió, para saber más adelante si sigue siendo el mismo PJ.
    character = providedCharacter;
    await setEventPlayerCharacter(
      input.guildId,
      input.userId,
      character,
      input.wowClass ?? null,
    );
  } else if (input.character !== undefined && existing?.character) {
    // Lo vaciaron a propósito en una inscripción que ya tenía personaje.
    character = null;
    await setEventPlayerCharacter(input.guildId, input.userId, null, null);
  } else {
    // No lo mandaron (o es una inscripción nueva sin personaje): heredamos el
    // que el jugador usó la última vez CON ESA MISMA CLASE, así no hay que
    // escribirlo de nuevo. Si cambió de clase no se hereda nada.
    character =
      (await getEventPlayerCharacter(
        input.guildId,
        input.userId,
        input.wowClass,
      )) ?? null;
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

function archivedEventTitle(title: string, startsAt: Date): string {
  const dateParts = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    weekday: "long",
    year: "numeric",
  }).formatToParts(startsAt);
  const getPart = (type: string): string =>
    dateParts.find((part) => part.type === type)?.value ?? "";

  return `${title.trim()} - ${getPart("weekday").toUpperCase()} ${getPart("day")}/${getPart("month")}/${getPart("year")}`;
}

// Archiva la ocurrencia que terminó: crea una fila "completed" con los datos de
// esa fecha y MUEVE las inscripciones, así el historial del admin conserva el
// roster de cada ocurrencia aunque el molde de la serie siga avanzando.
export async function archiveEventOccurrence(
  guildId: string,
  eventId: string,
): Promise<HubEvent | null> {
  const event = await prisma.hubEvent.findFirst({
    where: { id: eventId, guildId },
  });
  if (!event) {
    return null;
  }

  const archived = await prisma.hubEvent.create({
    data: {
      characterEnabled: event.characterEnabled,
      completedAt: new Date(),
      createdByUserId: event.createdByUserId,
      createdByUsername: event.createdByUsername,
      description: event.description,
      durationMinutes: event.durationMinutes,
      game: event.game,
      guildId,
      imageUrl: event.imageUrl,
      // La copia del historial no repite la serie ni su publicación.
      recurrenceEnabled: false,
      reminderHours: [],
      requiredRoleId: event.requiredRoleId,
      signupDeadline: event.signupDeadline,
      startsAt: event.startsAt,
      status: "completed",
      tags: (event.tags ?? []) as Prisma.InputJsonValue,
      title: archivedEventTitle(event.title, event.startsAt),
      type: event.type,
    },
  });

  await prisma.eventSignup.updateMany({
    data: { eventId: archived.id },
    where: { eventId, guildId },
  });

  return getEvent(guildId, archived.id);
}

// ¿Ya hay otro evento de la misma serie en esa fecha exacta? El molde no debe
// pisar una ocurrencia ya publicada (quedarían dos avisos para la misma fecha).
export async function eventExistsAt(
  guildId: string,
  startsAt: Date,
  title: string,
  excludeEventId: string,
): Promise<boolean> {
  const found = await prisma.hubEvent.findFirst({
    where: {
      guildId,
      id: { not: excludeEventId },
      startsAt,
      title,
    },
    select: { id: true },
  });
  return Boolean(found);
}

// Limpia la ocurrencia de una serie: borra el rastro en Discord de esa fecha y
// reinicia los marcadores, conservando el molde (config, recurrencia y
// publicación) y moviéndolo a la próxima fecha de la serie.
export async function resetEventOccurrence(
  guildId: string,
  eventId: string,
  input: {
    recurrenceNextAt: Date;
    // El cierre de inscripciones viaja con la serie (mismo offset respecto del
    // inicio): si no, queda en el pasado y el evento aparece "cerrado".
    signupDeadline: Date | null;
    startsAt: Date;
  },
): Promise<HubEvent | null> {
  const result = await prisma.hubEvent.updateMany({
    where: { id: eventId, guildId },
    data: {
      completedAt: null,
      discordEventId: null,
      discordMessageIds: [],
      discordPollMessageId: null,
      recurrenceNextAt: input.recurrenceNextAt,
      reminderMessageIds: [],
      // Si no se limpian, la ocurrencia nueva nunca manda sus recordatorios.
      reminderSentHours: [],
      reportSentAt: null,
      signupClosedAt: null,
      signupDeadline: input.signupDeadline,
      startsAt: input.startsAt,
      status: "scheduled",
    },
  });
  if (result.count === 0) {
    return null;
  }
  return getEvent(guildId, eventId);
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
  await setEventPlayerCharacter(guildId, userId, null, null);
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
