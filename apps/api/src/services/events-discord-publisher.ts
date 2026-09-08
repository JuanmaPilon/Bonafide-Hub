import { env } from "../config/env.js";

// ── Publicación de eventos del Módulo X en Discord ──────────────────
// El API habla directo con Discord usando el token del bot (igual que la
// publicación de raid logs/comunicados). Dos salidas posibles:
//   1. Scheduled Event real (entity_type VOICE en una sala, o EXTERNAL con
//      una ubicación de texto). Opcionalmente con recurrencia.
//   2. Un mensaje-aviso (embed) en un canal de texto elegido.
// Esta capa NO toca la base de datos: devuelve los ids que el caller
// persiste con setEventDiscordInfo().

export type EventRecurrence = "none" | "daily" | "weekly" | "biweekly";

export type EventDiscordOptions = {
  createScheduledEvent: boolean;
  entityType: "voice" | "external";
  location?: string;
  publishChannelId?: string;
  publishMessage: boolean;
  recurrence: EventRecurrence;
  voiceChannelId?: string;
};

export type EventPublishResult = {
  discordEventId?: string;
  error?: string;
  messageIds: string[];
};

type ScheduledEventPayload = {
  channel_id?: string;
  description?: string;
  entity_metadata?: { location: string };
  entity_type: number;
  image?: string;
  name: string;
  privacy_level: number;
  recurrence_rule?: unknown;
  scheduled_end_time?: string;
  scheduled_start_time: string;
};

// JS getDay(): 0=Dom..6=Sáb → Discord: 0=Lun..6=Dom.
function discordWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function buildRecurrenceRule(
  startsAt: Date,
  recurrence: EventRecurrence,
):
  | {
      by_weekday?: number[];
      frequency: number;
      interval: number;
      start: string;
    }
  | undefined {
  const start = startsAt.toISOString();
  switch (recurrence) {
    case "daily":
      // Todos los días. (Discord no permite interval≠1 en DAILY.)
      return { frequency: 3, interval: 1, start };
    case "weekly":
      // Mismo día de la semana que startsAt.
      return {
        by_weekday: [discordWeekday(startsAt)],
        frequency: 2,
        interval: 1,
        start,
      };
    case "biweekly":
      // Cada dos semanas, mismo día.
      return {
        by_weekday: [discordWeekday(startsAt)],
        frequency: 2,
        interval: 2,
        start,
      };
    default:
      return undefined;
  }
}

async function discordFetch(
  path: string,
  init?: { body?: unknown; method?: string },
): Promise<Response> {
  return fetch(`https://discord.com/api/v10${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN ?? ""}`,
      "Content-Type": "application/json",
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

// Formatea el error de Discord incluyendo el detalle por campo, p. ej.
// "recurrence_rule.start: This field is required". Así el toast muestra
// exactamente qué parte del payload rechazó.
async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      errors?: Record<string, unknown>;
      message?: string;
    };
    const fieldErrors: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") {
        return;
      }
      const record = node as Record<string, unknown>;
      const errors = record._errors;
      if (Array.isArray(errors)) {
        for (const entry of errors) {
          if (entry && typeof entry === "object") {
            const message = (entry as { message?: string }).message;
            if (message) {
              fieldErrors.push(path ? `${path}: ${message}` : message);
            }
          }
        }
        return;
      }
      for (const [key, value] of Object.entries(record)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    };
    walk(data.errors, "");
    const base = data.message ?? `HTTP ${response.status}`;
    if (fieldErrors.length > 0) {
      return `${base} (${fieldErrors.slice(0, 3).join(" | ")})`;
    }
    return base;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// Crea un Scheduled Event en la guild. Devuelve su id o un error.
async function createScheduledEvent(input: {
  description?: string;
  durationMinutes?: number;
  entityType: "voice" | "external";
  guildId: string;
  location?: string;
  recurrence: EventRecurrence;
  startsAt: Date;
  title: string;
  voiceChannelId?: string;
}): Promise<{ error?: string; id?: string }> {
  const payload: ScheduledEventPayload = {
    entity_type: input.entityType === "voice" ? 2 : 3,
    name: input.title.slice(0, 100),
    privacy_level: 2,
    scheduled_start_time: input.startsAt.toISOString(),
  };

  if (input.description?.trim()) {
    payload.description = input.description.trim().slice(0, 1000);
  }

  if (input.entityType === "voice") {
    if (!input.voiceChannelId) {
      return { error: "Falta la sala de voz para el evento." };
    }
    payload.channel_id = input.voiceChannelId;
  } else {
    payload.entity_metadata = {
      location: (input.location ?? "Evento de la guild").slice(0, 100),
    };
  }

  // Para EXTERNAL el end time es obligatorio; para VOICE es opcional.
  if (input.durationMinutes && input.durationMinutes > 0) {
    payload.scheduled_end_time = new Date(
      input.startsAt.getTime() + input.durationMinutes * 60_000,
    ).toISOString();
  } else if (input.entityType === "external") {
    // Sin duración explícita: una hora por defecto para eventos externos.
    payload.scheduled_end_time = new Date(
      input.startsAt.getTime() + 60 * 60_000,
    ).toISOString();
  }

  const rule = buildRecurrenceRule(input.startsAt, input.recurrence);
  if (rule) {
    payload.recurrence_rule = rule;
  }

  const response = await discordFetch(
    `/guilds/${encodeURIComponent(input.guildId)}/scheduled-events`,
    { method: "POST", body: payload },
  );

  if (!response.ok) {
    const detail = await errorMessage(response);
    // 403 suele ser falta del permiso CREATE_EVENTS (o CONNECT/VIEW_CHANNEL
    // en la sala de voz elegida).
    if (response.status === 403) {
      return {
        error:
          "El bot no tiene permiso para crear eventos (CREATE_EVENTS) o conectarse a la sala elegida.",
      };
    }
    return { error: `Discord no pudo crear el evento: ${detail}` };
  }

  const data = (await response.json()) as { id?: string };
  return { id: data.id };
}

// ── Roster estilo Raid Helper dentro del embed del evento ───────────

export type AnnouncementSignup = {
  character?: string;
  role?: string;
  spec?: string;
  status: string;
  username: string;
  wowClass?: string;
};

export type AnnouncementSpec = {
  animated: boolean;
  className: string;
  emojiId?: string;
  emojiName?: string;
  role: string;
  specName: string;
};

const ROLE_ORDER = ["tank", "healer", "melee", "ranged"] as const;

const ROLE_META: Record<string, { emoji: string; label: string }> = {
  tank: { emoji: "🛡️", label: "Tank" },
  healer: { emoji: "💚", label: "Healer" },
  melee: { emoji: "⚔️", label: "Melee" },
  ranged: { emoji: "🏹", label: "Ranged" },
};

const STATUS_META: Record<string, { emoji: string; label: string }> = {
  yes: { emoji: "✅", label: "Voy" },
  tentative: { emoji: "🤔", label: "Quizás" },
  bench: { emoji: "🪑", label: "Bench" },
  late: { emoji: "⏰", label: "Tarde" },
  no: { emoji: "❌", label: "No asiste" },
};

const EVENT_TYPE_EMOJI: Record<string, string> = {
  raid: "⚔️",
  mplus: "🗝️",
  pvp: "🏆",
  social: "🎉",
};

const RECURRENCE_LABEL: Record<EventRecurrence, string | undefined> = {
  none: undefined,
  daily: "Repite todos los días",
  weekly: "Repite semanalmente",
  biweekly: "Repite cada 2 semanas",
};

// Mención de emoji custom (`<:name:id>` o `<a:name:id>`) para que Discord
// la renderice inline dentro del texto del embed.
function specMention(spec?: AnnouncementSpec): string {
  if (!spec?.emojiId || !spec.emojiName) {
    return "";
  }
  const marker = spec.animated ? "a" : "";
  return `<${marker}:${spec.emojiName}:${spec.emojiId}>`;
}

function signupDisplay(signup: AnnouncementSignup): string {
  // El nombre de Discord es el principal; el personaje (opcional) va entre
  // paréntesis.
  return signup.character
    ? `${signup.username} (${signup.character})`
    : signup.username;
}

// Empuja líneas a un field, partiendo en varios si supera 1024 chars
// (límite de Discord para el value de un field).
function pushField(
  fields: Array<{ name: string; value: string }>,
  name: string,
  lines: string[],
): void {
  if (lines.length === 0) {
    return;
  }
  let value = "";
  for (const line of lines) {
    if (value.length + line.length + 1 > 1024) {
      fields.push({ name, value });
      value = "";
    }
    value = value ? `${value}\n${line}` : line;
  }
  if (value) {
    fields.push({ name, value });
  }
}

// Construye el/los embeds del aviso con info del evento + roster.
export function buildEventAnnouncementEmbeds(input: {
  description?: string;
  discordEventId?: string;
  durationMinutes?: number;
  guildId: string;
  imageUrl?: string;
  location?: string;
  recurrence: EventRecurrence;
  signupDeadline?: Date;
  signups: AnnouncementSignup[];
  specs: AnnouncementSpec[];
  startsAt: Date;
  title: string;
  type?: string;
}): Array<Record<string, unknown>> {
  const typeLabel = input.type ?? "evento";
  const timestamp = Math.floor(input.startsAt.getTime() / 1000);

  const lines: string[] = [`🕒 <t:${timestamp}:F> (<t:${timestamp}:R>)`];
  const recurrenceLabel = RECURRENCE_LABEL[input.recurrence];
  if (recurrenceLabel) {
    lines.push(`🔁 ${recurrenceLabel}`);
  }
  if (input.durationMinutes && input.durationMinutes > 0) {
    const end = Math.floor(
      (input.startsAt.getTime() + input.durationMinutes * 60_000) / 1000,
    );
    lines.push(
      `⏱️ Duración: ${input.durationMinutes} min (hasta <t:${end}:t>)`,
    );
  }
  if (input.signupDeadline) {
    const dl = Math.floor(input.signupDeadline.getTime() / 1000);
    lines.push(`🔒 Cierre de inscripciones: <t:${dl}:F>`);
  }
  if (input.location) {
    lines.push(`📍 ${input.location}`);
  }

  // Conteo por estado (solo los que tengan al menos uno).
  const counts: string[] = [];
  for (const [status, meta] of Object.entries(STATUS_META)) {
    const count = input.signups.filter(
      (signup) => signup.status === status,
    ).length;
    if (count > 0) {
      counts.push(`${meta.emoji} ${count}`);
    }
  }
  lines.push(counts.length > 0 ? counts.join(" · ") : "Sin anotados todavía.");

  const fields: Array<{ name: string; value: string }> = [];
  const resolveSpec = (
    signup: AnnouncementSignup,
  ): AnnouncementSpec | undefined =>
    input.specs.find(
      (spec) =>
        spec.role === signup.role &&
        spec.className === signup.wowClass &&
        spec.specName === signup.spec,
    );

  const linesFor = (members: AnnouncementSignup[]): string[] =>
    members.map((signup) => {
      const spec = resolveSpec(signup);
      const mention = specMention(spec);
      const name = `**${signupDisplay(signup)}**`;
      return mention ? `${mention} ${name}` : `❔ ${name}`;
    });

  const confirmed = input.signups.filter((signup) => signup.status === "yes");
  for (const role of ROLE_ORDER) {
    const members = confirmed.filter((signup) => signup.role === role);
    if (members.length === 0) {
      continue;
    }
    const meta = ROLE_META[role];
    pushField(
      fields,
      `${meta.emoji} ${meta.label} (${members.length})`,
      linesFor(members),
    );
  }
  // Confirmados sin rol o con rol legacy (dps): se agrupan aparte.
  const leftovers = confirmed.filter(
    (signup) => !signup.role || !ROLE_ORDER.includes(signup.role as never),
  );
  if (leftovers.length > 0) {
    pushField(fields, `⭐ Otros (${leftovers.length})`, linesFor(leftovers));
  }

  const bench = input.signups.filter((signup) => signup.status === "bench");
  if (bench.length > 0) {
    pushField(fields, `🪑 Bench (${bench.length})`, linesFor(bench));
  }
  const late = input.signups.filter((signup) => signup.status === "late");
  if (late.length > 0) {
    pushField(fields, `⏰ Llegan tarde (${late.length})`, linesFor(late));
  }

  const embed: Record<string, unknown> = {
    title: `${EVENT_TYPE_EMOJI[input.type ?? ""] ?? "📅"} ${input.title.slice(0, 250)}`,
    color: 0x6aa8ff,
    description: lines.join("\n"),
    fields,
    footer: { text: `Bonafide Hub · ${typeLabel}` },
  };
  if (input.discordEventId) {
    embed.url = `https://discord.com/events/${encodeURIComponent(input.guildId)}/${encodeURIComponent(input.discordEventId)}`;
  }
  if (input.description?.trim()) {
    embed.description = `${lines.join("\n")}\n\n${input.description.trim().slice(0, 1024)}`;
  }
  if (
    input.imageUrl?.startsWith("https://") ||
    input.imageUrl?.startsWith("http://")
  ) {
    embed.thumbnail = { url: input.imageUrl };
  }
  return [embed];
}

// Edita un mensaje-aviso existente con embeds nuevos (auto-refresh del
// roster cuando cambian las inscripciones). Devuelve si Discord lo aceptó.
export async function updateEventAnnouncement(input: {
  channelId: string;
  embeds: Array<Record<string, unknown>>;
  messageId: string;
}): Promise<boolean> {
  const response = await discordFetch(
    `/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}`,
    { method: "PATCH", body: { embeds: input.embeds } },
  );
  return response.ok;
}

// Botones que van fijos en el mensaje-aviso (los maneja el bot con el
// prefijo `eventsign:` en custom_id) para inscribirse desde Discord.
export function buildEventSignupActionRows(
  eventId: string,
): Array<Record<string, unknown>> {
  const statusButtons = [
    { customId: "yes", emoji: "✅", label: "Asistir", style: 3 },
    { customId: "bench", emoji: "🪑", label: "Bench", style: 2 },
    { customId: "late", emoji: "⏰", label: "Tarde", style: 2 },
    { customId: "tentative", emoji: "🤔", label: "Quizás", style: 2 },
    { customId: "no", emoji: "❌", label: "No asisto", style: 2 },
  ];
  const actionButtons = [
    { customId: "pick", emoji: "⚙️", label: "Clase y spec", style: 1 },
    { customId: "remove", emoji: "🗑️", label: "Quitar inscripción", style: 4 },
  ];
  const row = (
    buttons: Array<{
      customId: string;
      emoji: string;
      label: string;
      style: number;
    }>,
  ) => ({
    components: buttons.map((button) => ({
      custom_id: `eventsign:${eventId}:${button.customId}`,
      emoji: { name: button.emoji },
      label: button.label,
      style: button.style,
      type: 2,
    })),
    type: 1,
  });
  return [row(statusButtons), row(actionButtons)];
}

// Publica el aviso-embed en un canal. Devuelve el id del mensaje o error.
async function postAnnouncement(
  input: {
    channelId: string;
    discordEventId?: string;
    eventId: string;
    guildId: string;
    signupDeadline?: Date;
    signups: AnnouncementSignup[];
    specs: AnnouncementSpec[];
  } & Parameters<typeof buildEventAnnouncementEmbeds>[0],
): Promise<{
  error?: string;
  messageId?: string;
}> {
  const embeds = buildEventAnnouncementEmbeds(input);
  const response = await discordFetch(
    `/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: "POST",
      body: {
        allowed_mentions: { parse: ["users", "roles"] },
        components: buildEventSignupActionRows(input.eventId),
        embeds,
      },
    },
  );
  if (!response.ok) {
    const detail = await errorMessage(response);
    return { error: `No se pudo publicar el aviso: ${detail}` };
  }
  const data = (await response.json()) as { id?: string };
  return { messageId: data.id };
}

// Sincroniza un evento hacia Discord según las opciones elegidas. No toca
// la DB: devuelve ids + errores para que el caller los persista.
export async function syncEventToDiscord(input: {
  description?: string;
  discordEventId?: string;
  durationMinutes?: number;
  eventId: string;
  guildId: string;
  imageUrl?: string;
  options: EventDiscordOptions;
  signupDeadline?: Date;
  signups?: AnnouncementSignup[];
  specs?: AnnouncementSpec[];
  startsAt: Date;
  title: string;
  type?: string;
}): Promise<EventPublishResult> {
  const { options } = input;
  const result: EventPublishResult = { messageIds: [] };

  // 1) Scheduled Event (si se pidió).
  if (options.createScheduledEvent) {
    const created = await createScheduledEvent({
      description: input.description,
      durationMinutes: input.durationMinutes,
      entityType: options.entityType,
      guildId: input.guildId,
      location: options.location,
      recurrence: options.recurrence,
      startsAt: input.startsAt,
      title: input.title,
      voiceChannelId: options.voiceChannelId,
    });
    if (created.error) {
      result.error = created.error;
      return result;
    }
    result.discordEventId = created.id;
  }

  // 2) Aviso en canal (si se pidió).
  if (options.publishMessage && options.publishChannelId) {
    const announcement = await postAnnouncement({
      channelId: options.publishChannelId,
      description: input.description,
      discordEventId: result.discordEventId ?? input.discordEventId,
      durationMinutes: input.durationMinutes,
      eventId: input.eventId,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      location:
        options.entityType === "external" ? options.location : undefined,
      recurrence: options.recurrence,
      signupDeadline: input.signupDeadline,
      signups: input.signups ?? [],
      specs: input.specs ?? [],
      startsAt: input.startsAt,
      title: input.title,
      type: input.type,
    });
    if (announcement.error) {
      result.error = result.error ?? announcement.error;
    } else if (announcement.messageId) {
      result.messageIds = [announcement.messageId];
    }
  }

  return result;
}

// Limpia lo publicado en Discord (scheduled event + mensajes-aviso). Es
// best-effort: cada paso falla silenciosamente si ya no existe.
export async function cleanupEventDiscord(input: {
  discordEventId?: string;
  guildId: string;
  publishChannelId?: string;
  discordMessageIds?: string[];
}): Promise<void> {
  if (input.discordEventId) {
    await discordFetch(
      `/guilds/${encodeURIComponent(input.guildId)}/scheduled-events/${encodeURIComponent(input.discordEventId)}`,
      { method: "DELETE" },
    );
  }
  if (input.publishChannelId) {
    for (const messageId of input.discordMessageIds ?? []) {
      await discordFetch(
        `/channels/${encodeURIComponent(input.publishChannelId)}/messages/${encodeURIComponent(messageId)}`,
        { method: "DELETE" },
      );
    }
  }
}
