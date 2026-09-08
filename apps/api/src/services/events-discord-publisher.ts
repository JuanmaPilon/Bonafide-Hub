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
): { by_weekday?: number[]; frequency: number; interval: number } | undefined {
  switch (recurrence) {
    case "daily":
      // Todos los días. (Discord no permite interval≠1 en DAILY.)
      return { frequency: 3, interval: 1 };
    case "weekly":
      // Mismo día de la semana que startsAt.
      return {
        by_weekday: [discordWeekday(startsAt)],
        frequency: 2,
        interval: 1,
      };
    case "biweekly":
      // Cada dos semanas, mismo día.
      return {
        by_weekday: [discordWeekday(startsAt)],
        frequency: 2,
        interval: 2,
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

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? `HTTP ${response.status}`;
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

function buildEmbed(input: {
  description?: string;
  imageUrl?: string;
  recurrence: EventRecurrence;
  startsAt: Date;
  title: string;
  type?: string;
}) {
  const recurrenceLabel: Record<EventRecurrence, string | undefined> = {
    none: undefined,
    daily: "Repite todos los días",
    weekly: "Repite semanalmente",
    biweekly: "Repite cada 2 semanas",
  };
  const typeLabel = input.type ?? "evento";
  const timestamp = Math.floor(input.startsAt.getTime() / 1000);
  const fields: Array<{ inline: boolean; name: string; value: string }> = [
    { inline: true, name: "Inicio", value: `<t:${timestamp}:F>` },
    { inline: true, name: "Hace", value: `<t:${timestamp}:R>` },
  ];
  if (recurrenceLabel[input.recurrence]) {
    fields.push({
      inline: false,
      name: "Repetición",
      value: recurrenceLabel[input.recurrence]!,
    });
  }

  const embed: Record<string, unknown> = {
    title: input.title.slice(0, 256),
    color: 0x6aa8ff,
    fields,
    footer: { text: `Bonafide Hub · ${typeLabel}` },
  };
  if (input.description?.trim()) {
    embed.description = input.description.trim().slice(0, 4096);
  }
  if (input.imageUrl?.startsWith("https://") || input.imageUrl?.startsWith("http://")) {
    embed.thumbnail = { url: input.imageUrl };
  }
  return embed;
}

// Publica el aviso-embed en un canal. Devuelve el id del mensaje o error.
async function postAnnouncement(input: {
  channelId: string;
  description?: string;
  discordEventId?: string;
  guildId: string;
  imageUrl?: string;
  recurrence: EventRecurrence;
  startsAt: Date;
  title: string;
  type?: string;
}): Promise<{ error?: string; messageId?: string }> {
  const content = input.discordEventId
    ? `📅 Evento creado: https://discord.com/events/${encodeURIComponent(input.guildId)}/${encodeURIComponent(input.discordEventId)}`
    : "";
  const response = await discordFetch(
    `/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: "POST",
      body: {
        allowed_mentions: { parse: ["users", "roles"] },
        content,
        embeds: [
          buildEmbed({
            description: input.description,
            imageUrl: input.imageUrl,
            recurrence: input.recurrence,
            startsAt: input.startsAt,
            title: input.title,
            type: input.type,
          }),
        ],
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
  guildId: string;
  imageUrl?: string;
  options: EventDiscordOptions;
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
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      recurrence: options.recurrence,
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
