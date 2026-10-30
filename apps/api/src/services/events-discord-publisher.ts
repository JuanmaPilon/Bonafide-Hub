import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { formatDurationHours } from "./duration.js";
import type { EventTag } from "./events-store.js";

// ── Publicación de eventos del Módulo X en Discord ──────────────────
// El API habla directo con Discord usando el token del bot (igual que la
// publicación de raid logs/comunicados). Dos salidas posibles:
//   1. Scheduled Event real (entity_type VOICE en una sala, o EXTERNAL con
//      una ubicación de texto). Opcionalmente con recurrencia.
//   2. Un mensaje-aviso (embed) en un canal de texto elegido.
// Esta capa NO toca la base de datos: devuelve los ids que el caller
// persiste con setEventDiscordInfo().

// Día de la semana con el que se anuncia el cierre de inscripciones. Discord no
// tiene un estilo de timestamp que sea "día + hora" (los suyos son fecha
// completa o sólo la hora), así que el día se calcula acá en la zona de la guild
// y la hora viaja como timestamp de Discord, que se localiza sola para cada uno.
const GUILD_TIME_ZONE = "America/Argentina/Buenos_Aires";

function weekdayName(date: Date): string {
  const name = new Intl.DateTimeFormat("es-AR", {
    timeZone: GUILD_TIME_ZONE,
    weekday: "long",
  }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

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
  // Mensaje de la encuesta nativa (eventos de la plantilla "encuesta").
  pollMessageId?: string;
};

type ScheduledEventPayload = {
  channel_id?: string;
  description?: string;
  entity_metadata?: { location: string };
  // Solo al CREAR: Discord no permite cambiar el entity_type de un evento
  // agendado existente (el PATCH lo rechaza).
  entity_type?: number;
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

// ── Mensajes directos (MD) ──────────────────────────────────────────
// El staff puede avisarle a un miembro que le cambió la inscripción a un
// evento. Se manda por MD del bot: primero se abre (o reutiliza) el canal
// privado con `POST /users/@me/channels` y después se postea el mensaje.
// Devuelve un error "humano" (apto para un toast) cuando no se pudo avisar.
export async function sendDirectMessage(
  userId: string,
  payload: { content?: string; embeds?: unknown[] },
): Promise<{ error?: string; ok: boolean }> {
  if (!env.DISCORD_BOT_TOKEN) {
    return { error: "Falta DISCORD_BOT_TOKEN en el API.", ok: false };
  }

  try {
    const channelResponse = await discordFetch("/users/@me/channels", {
      body: { recipient_id: userId },
      method: "POST",
    });
    if (!channelResponse.ok) {
      // 403 = el miembro tiene los MD cerrados (o no comparte servidor con
      // el bot): es el caso más común, así que damos un mensaje claro.
      if (channelResponse.status === 403) {
        return {
          error: "El miembro no acepta mensajes directos del bot.",
          ok: false,
        };
      }
      return { error: await errorMessage(channelResponse), ok: false };
    }

    const channel = (await channelResponse.json()) as { id: string };
    const messageResponse = await discordFetch(
      `/channels/${channel.id}/messages`,
      { body: payload, method: "POST" },
    );
    if (!messageResponse.ok) {
      return { error: await errorMessage(messageResponse), ok: false };
    }

    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Error de red",
      ok: false,
    };
  }
}

// Duración por defecto de un evento sin duración cargada (la misma que usa el
// cierre automático): sirve para saber cuándo terminó.
const DEFAULT_EVENT_DURATION_MINUTES = 180;

// Próximo minuto exacto. Discord rechaza un evento agendado con el inicio en el
// pasado, y redondear para arriba evita que el request llegue ya pasado.
function nextSchedulableMinute(): Date {
  return new Date(Math.ceil((Date.now() + 60_000) / 60_000) * 60_000);
}

// Pone el evento agendado "en curso". Los eventos de voz quedan en "Iniciará
// pronto" hasta que alguien aprieta "Iniciar": cuando el evento ya empezó (un
// cumpleaños de hoy, que empieza a las 00:00) lo arrancamos nosotros, si no
// queda anunciado para siempre y nunca arranca.
async function startScheduledEvent(input: {
  discordEventId: string;
  guildId: string;
}): Promise<void> {
  const response = await discordFetch(
    `/guilds/${encodeURIComponent(input.guildId)}/scheduled-events/${encodeURIComponent(input.discordEventId)}`,
    { method: "PATCH", body: { status: 2 } },
  ).catch(() => null);
  if (!response || response.ok || response.status === 404) {
    return;
  }
  console.warn(
    `[eventos] no se pudo iniciar el evento agendado ${input.discordEventId} (${response.status})`,
  );
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

// Actualiza un Scheduled Event existente (título, fecha, duración, lugar).
// Se usa cuando el staff edita el evento: en vez de borrar y recrear el
// evento agendado (lo que pierde los "interesados" de Discord y cambia su
// id), lo parcheamos.
async function updateScheduledEvent(input: {
  description?: string;
  discordEventId: string;
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
    name: input.title.slice(0, 100),
    privacy_level: 2,
    scheduled_start_time: input.startsAt.toISOString(),
  };

  if (input.description?.trim()) {
    payload.description = input.description.trim().slice(0, 1000);
  }
  if (input.entityType === "voice" && input.voiceChannelId) {
    payload.channel_id = input.voiceChannelId;
  }
  if (input.entityType === "external" && input.location) {
    payload.entity_metadata = { location: input.location.slice(0, 100) };
  }
  if (input.durationMinutes && input.durationMinutes > 0) {
    payload.scheduled_end_time = new Date(
      input.startsAt.getTime() + input.durationMinutes * 60_000,
    ).toISOString();
  } else if (input.entityType === "external") {
    payload.scheduled_end_time = new Date(
      input.startsAt.getTime() + 60 * 60_000,
    ).toISOString();
  }
  const rule = buildRecurrenceRule(input.startsAt, input.recurrence);
  if (rule) {
    payload.recurrence_rule = rule;
  }

  const response = await discordFetch(
    `/guilds/${encodeURIComponent(input.guildId)}/scheduled-events/${encodeURIComponent(input.discordEventId)}`,
    { method: "PATCH", body: payload },
  );
  if (!response.ok) {
    // 404 = el evento agendado ya no existe (lo borraron a mano): avisamos y
    // el caller decide (publicar de nuevo / recrear).
    if (response.status === 404) {
      return { error: "not_found" };
    }
    const detail = await errorMessage(response);
    return { error: `Discord no pudo actualizar el evento: ${detail}` };
  }
  return { id: input.discordEventId };
}

// Contenido actual del mensaje-aviso (null si no se pudo leer).
async function fetchMessageContent(
  channelId: string,
  messageId: string,
): Promise<string | null> {
  try {
    const response = await discordFetch(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { content?: string };
    return data.content ?? "";
  } catch {
    return null;
  }
}

// Contenido del mensaje-aviso según los roles que tienen que enterarse:
//   - el rol mínimo del evento (el que exige la inscripción), y
//   - el rol de Bench del roster, si está mapeado: el bench es parte del roster
//     (tiene que enterarse), pero sin el rol mínimo su inscripción queda Bench.
//
// Devuelve "" sin roles (limpia una mención vieja que haya quedado).
export function announcementContent(input: {
  benchRoleId?: string;
  // Cumpleaños: la persona a etiquetar. Una mención dentro del embed se dibuja
  // pero NO notifica, así que tiene que ir en el contenido del mensaje.
  birthdayUserId?: string;
  requiredRoleId?: string;
}): string {
  const roles = [input.requiredRoleId, input.benchRoleId]
    .map((roleId) => roleId?.trim())
    .filter((roleId): roleId is string => Boolean(roleId));
  const parts = [...new Set(roles)].map((roleId) => `<@&${roleId}>`);
  const userId = input.birthdayUserId?.trim();
  if (userId) {
    parts.push(`<@${userId}>`);
  }
  return parts.join(" ");
}

// Contenido que DEBE tener el aviso. Devuelve `undefined` (no tocar) cuando el
// mensaje YA dice exactamente eso: así los refrescos no reescriben el contenido.
// Si el mensaje tiene la mención con decoración vieja (p. ej. `🛡️ <@&rol>`), se
// normaliza al refrescar sin notificar (el PATCH va con
// `allowed_mentions: { parse: [] }`).
export async function resolveAnnouncementContent(input: {
  benchRoleId?: string;
  birthdayUserId?: string;
  channelId: string;
  messageId: string;
  requiredRoleId?: string;
}): Promise<string | undefined> {
  const desired = announcementContent(input);
  const current = await fetchMessageContent(input.channelId, input.messageId);
  if (current === null) {
    // No pudimos leer el mensaje: no lo tocamos.
    return undefined;
  }
  return current.trim() === desired ? undefined : desired;
}

// ── Roster estilo Raid Helper dentro del embed del evento ───────────

export type AnnouncementSignup = {
  character?: string;
  role?: string;
  // Clase del roster para quien no eligió una en la inscripción (p. ej. quien
  // sólo marcó "no asisto" desde Discord: ese botón no abre el asistente). Es
  // para el emoji del renglón: no lo mueve de columna.
  rosterClass?: { className: string; specName: string };
  spec?: string;
  status: string;
  // Id del miembro: lo usan el contador del roster y el match con el rol
  // mínimo (los signups de la DB lo traen siempre).
  userId?: string;
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

// Rol de inscripción configurable (lo define el panel; p. ej. tank/healer o
// Top/Jungle/Mid/ADC/Support si la guild juega LoL).
export type EventRoleOption = {
  animated: boolean;
  emoji?: string;
  emojiId?: string;
  emojiName?: string;
  key: string;
  label: string;
};

const ROLE_ORDER = ["tank", "healer", "melee", "ranged"] as const;

const ROLE_META: Record<string, { emoji: string; label: string }> = {
  tank: { emoji: "🛡️", label: "Tank" },
  healer: { emoji: "💚", label: "Healer" },
  melee: { emoji: "⚔️", label: "Melee" },
  ranged: { emoji: "🏹", label: "Range" },
};

const DEFAULT_ROLE_OPTIONS: EventRoleOption[] = ROLE_ORDER.map((key) => ({
  animated: false,
  emoji: ROLE_META[key].emoji,
  key,
  label: ROLE_META[key].label,
}));

// Emoji visible de un rol: custom de Discord inline (`<:nombre:id>`) o el
// unicode configurado.
function roleEmoji(role: EventRoleOption): string {
  if (role.emojiId && role.emojiName) {
    return `<${role.animated ? "a" : ""}:${role.emojiName}:${role.emojiId}>`;
  }
  return role.emoji ?? ROLE_META[role.key]?.emoji ?? "❔";
}

// Mención de emoji custom (`<:name:id>` o `<a:name:id>`) para que Discord
// la renderice inline dentro del texto del embed.
function specMention(spec?: AnnouncementSpec): string {
  if (!spec?.emojiId || !spec.emojiName) {
    return "";
  }
  const marker = spec.animated ? "a" : "";
  return `<${marker}:${spec.emojiName}:${spec.emojiId}>`;
}

// Comentario del roster: ver `memberLabel` dentro de buildEventAnnouncementEmbeds.

// Empuja líneas a un field, partiendo en varios si supera 1024 chars
// (límite de Discord para el value de un field). `inline` los pone en
// columnas (3 por fila), que es lo que mantiene el embed "horizontal".
// `quote` antepone "> " a cada línea: Discord las une en un solo bloque con
// barra vertical a la izquierda. Esa barra es lo que separa un rol del
// siguiente cuando el cliente apila los campos (celular), donde antes quedaba
// todo como una lista suelta de nombres.
function pushField(
  fields: Array<{ inline?: boolean; name: string; value: string }>,
  name: string,
  lines: string[],
  inline = false,
  quote = false,
): void {
  if (lines.length === 0) {
    return;
  }
  const rendered = quote ? lines.map((line) => `> ${line}`) : lines;
  let value = "";
  for (const line of rendered) {
    if (value.length + line.length + 1 > 1024) {
      fields.push({ inline, name, value });
      value = "";
    }
    value = value ? `${value}\n${line}` : line;
  }
  if (value) {
    fields.push({ inline, name, value });
  }
}

// Espacio vertical entre bloques del embed. Discord no tiene márgenes en los
// fields, así que se empuja un campo "vacío" (ancho cero): cada línea del value
// suma la altura de un renglón, y así se regula cuánto aire queda.
function pushSpacer(
  fields: Array<{ inline?: boolean; name: string; value: string }>,
  lines = 1,
): void {
  fields.push({
    inline: false,
    name: "\u200b",
    value: Array.from({ length: Math.max(1, lines) }, () => "\u200b").join(
      "\n",
    ),
  });
}

// Icono de la guild, para usarlo como thumbnail + icono del footer (le da
// "cara" al aviso). Se cachea en memoria: cambia poco y no queremos pedirlo
// en cada refresco del roster.
const guildIconCache = new Map<
  string,
  { expiresAt: number; url: string | undefined }
>();

export async function fetchGuildIconUrl(
  guildId: string,
): Promise<string | undefined> {
  const cached = guildIconCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  let url: string | undefined;
  try {
    const response = await discordFetch(
      `/guilds/${encodeURIComponent(guildId)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as { icon?: string | null };
      if (data.icon) {
        const extension = data.icon.startsWith("a_") ? "gif" : "png";
        url = `https://cdn.discordapp.com/icons/${guildId}/${data.icon}.${extension}?size=128`;
      }
    }
  } catch {
    // Sin icono: el embed se arma igual.
  }
  guildIconCache.set(guildId, {
    expiresAt: Date.now() + 60 * 60 * 1000,
    url,
  });
  return url;
}

// URL que Discord puede mostrar para la imagen del evento. Si la imagen es
// una data URL (la que sube la web a la biblioteca), la exponemos por una
// ruta pública del API (PUBLIC_API_URL) para que Discord pueda renderizarla.
function resolveEmbedImageUrl(
  guildId: string,
  eventId: string | undefined,
  imageUrl: string | undefined,
): string | undefined {
  if (!imageUrl) {
    return undefined;
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    return imageUrl;
  }
  if (imageUrl.startsWith("data:image/")) {
    // URL pública del API. En Railway el dominio público llega por
    // RAILWAY_PUBLIC_DOMAIN si no se configuró PUBLIC_API_URL a mano.
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    const configured = env.PUBLIC_API_URL?.trim();
    const base = (
      configured || (railwayDomain ? `https://${railwayDomain}` : "")
    ).replace(/\/+$/, "");
    if (!base || !eventId) {
      return undefined;
    }
    // El "v" es el hash de la imagen: Discord cachea las imágenes por URL, así
    // que al cambiar la guardada la URL cambia y la vuelve a pedir; con la misma
    // imagen la URL no cambia y sigue usando la que ya tiene.
    const version = createHash("sha1")
      .update(imageUrl)
      .digest("hex")
      .slice(0, 8);
    return `${base}/public/guilds/${encodeURIComponent(guildId)}/events/${encodeURIComponent(eventId)}/image?v=${version}`;
  }
  return undefined;
}

// Color del aviso. Sale de la PRIMERA etiqueta del evento: ahí es donde el staff
// pone la dificultad de la raid ("Heroico", "Mítico"…) con su color, y el mismo
// criterio sirve para cualquier otro tipo de evento (las etiquetas son libres).
// Los estados mandan sobre la etiqueta: pausado gris, inscripciones cerradas
// rojo. Sin etiquetas queda el color de siempre.
const EVENT_EMBED_COLOR = 0x6aa8ff;
const EVENT_EMBED_PAUSED_COLOR = 0x8b93a7;
const EVENT_EMBED_CLOSED_COLOR = 0xe5484d;

// "#ff8a5c" → 0xff8a5c (Discord quiere el entero). null si no es un hex válido.
function hexColorToInt(value: string | undefined): number | null {
  const hex = (value ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  return Number.parseInt(hex, 16);
}

function eventEmbedColor(
  input: { paused?: boolean; signupsClosed?: boolean; tags?: EventTag[] },
  fallback: number,
): number {
  if (input.paused === true) {
    return EVENT_EMBED_PAUSED_COLOR;
  }
  if (input.signupsClosed === true) {
    return EVENT_EMBED_CLOSED_COLOR;
  }
  return hexColorToInt(input.tags?.[0]?.color) ?? fallback;
}

// Construye el/los embeds del aviso con info del evento + roster.
export function buildEventAnnouncementEmbeds(input: {
  classLabel?: string;
  description?: string;
  discordEventId?: string;
  durationMinutes?: number;
  eventId?: string;
  gameLabel?: string;
  guildId: string;
  guildIconUrl?: string;
  imageUrl?: string;
  location?: string;
  paused?: boolean;
  // Cuántos miembros forman el roster esperado del evento (rol mínimo + bench
  // del roster). Es el denominador del "Roster X/Y" del aviso.
  expectedCount?: number;
  // Cuántos de esos ya respondieron (cualquier estado, bench incluido).
  rosterSignedCount?: number;
  // Rol de Bench del roster: el aviso también lo menciona (el bench es parte
  // del roster y tiene que enterarse).
  benchRoleId?: string;
  recurrence: EventRecurrence;
  // Recurrencia PROPIA del evento (cada X días, la maneja el API). Manda sobre
  // la recurrencia del evento agendado de Discord.
  ownRecurrenceEveryDays?: number;
  requiredRoleId?: string;
  roles?: EventRoleOption[];
  signupDeadline?: Date;
  signups: AnnouncementSignup[];
  specLabel?: string;
  specs: AnnouncementSpec[];
  startsAt: Date;
  tags?: EventTag[];
  title: string;
  type?: string;
  // Si es false el evento es informativo: el aviso no lleva roster, ni cierre,
  // ni conteo de asistencia. Los cumpleaños van siempre así.
  signupEnabled?: boolean;
  // Si el juego no usa personaje, el aviso no muestra el botón "Personaje".
  characterEnabled?: boolean;
  // Cumpleaños: la persona a etiquetar en el aviso. Además del embed, viaja en
  // el contenido del mensaje, que es lo único que notifica en Discord.
  birthdayUserId?: string;
}): Array<Record<string, unknown>> {
  const typeLabel = input.type ?? "evento";
  const timestamp = Math.floor(input.startsAt.getTime() / 1000);

  // Evento informativo (cumpleaños incluido): el aviso anuncia, no convoca.
  // Reusa el molde (título, descripción, imagen, etiquetas, footer) pero sin los
  // campos de un evento de raid: no hay roster, ni cierre de inscripciones, ni
  // conteo de asistencia, y en Discord no lleva botones.
  if (input.signupEnabled === false) {
    const esCumple = input.type === "birthday";
    // La mención al cumpleañero va también en el texto del embed (ahí no
    // notifica, pero se lee como su nombre); la notificación sale por el
    // contenido del mensaje, ver announcementContent.
    const saludo =
      esCumple && input.birthdayUserId
        ? `\n\n¡Feliz cumpleaños, <@${input.birthdayUserId}>! 🎉`
        : "";

    const simple: Record<string, unknown> = {
      title: input.title.slice(0, 250),
      color: eventEmbedColor(
        { paused: input.paused, tags: input.tags },
        esCumple ? 0xff73fa : EVENT_EMBED_COLOR,
      ),
      description:
        [
          esCumple
            ? `🎂 **Todo el día · <t:${timestamp}:D>**`
            : `🗓️ **<t:${timestamp}:F>**`,
          input.description?.trim(),
        ]
          .filter(Boolean)
          .join("\n\n") + saludo,
      fields: [],
      footer: { text: `Bonafide Hub · ${typeLabel}` },
      timestamp: new Date().toISOString(),
    };
    if (input.guildIconUrl) {
      simple.thumbnail = { url: input.guildIconUrl };
      simple.footer = {
        icon_url: input.guildIconUrl,
        text: `Bonafide Hub · ${typeLabel}`,
      };
    }
    const tagLabels = (input.tags ?? [])
      .map((tag) => tag.label.trim())
      .filter(Boolean);
    if (tagLabels.length > 0) {
      simple.author = {
        ...(input.guildIconUrl ? { icon_url: input.guildIconUrl } : {}),
        name: `🏷️ ${tagLabels.join(" · ").slice(0, 250)}`,
      };
    }
    const imagen = resolveEmbedImageUrl(
      input.guildId,
      input.eventId,
      input.imageUrl,
    );
    if (imagen) {
      simple.image = { url: imagen };
    }
    if (input.discordEventId) {
      simple.url = `https://discord.com/events/${encodeURIComponent(input.guildId)}/${encodeURIComponent(input.discordEventId)}`;
    }
    return [simple];
  }

  // ¿Ya cerró la inscripción? Si hay cierre y ya pasó, el aviso se pinta en
  // rojo, avisa bien visible que no se puede anotar (banner arriba) y los
  // botones del mensaje quedan deshabilitados.
  const signupsClosed =
    input.signupDeadline !== undefined &&
    input.signupDeadline.getTime() <= Date.now();
  // Pausado: frena todo sin cancelar; el aviso se muestra en gris y sin
  // inscripciones hasta reactivarlo.
  const isPaused = input.paused === true;

  // OJO: Discord NO renderiza títulos markdown (`##`) dentro de la descripción
  // de un embed: van como texto plano. Por eso la fecha va en negrita acá y
  // los datos cortos (hora, duración, cierre) en campos en columnas, que es
  // lo que le da el aspecto de "tarjeta".
  const whenLines: string[] = [
    `**🗓️ <t:${timestamp}:F>**`,
    `<t:${timestamp}:R>`,
  ];
  // La recurrencia NO se muestra en el embed (se ve solo en la web): el aviso
  // queda para la fecha concreta del evento.
  const endTimestamp =
    input.durationMinutes && input.durationMinutes > 0
      ? Math.floor(
          (input.startsAt.getTime() + input.durationMinutes * 60_000) / 1000,
        )
      : undefined;
  // Cuánto dura, en horas: va al lado de la hora de fin ("Termina 00:00 (3 hs)").
  const durationHours =
    input.durationMinutes && input.durationMinutes > 0
      ? formatDurationHours(input.durationMinutes)
      : undefined;
  if (input.location) {
    whenLines.push(`📍 ${input.location}`);
  }

  // Conteo por estado: la asistencia muestra el número FIJO de confirmados y,
  // entre paréntesis, los POSIBLES (bench + los que llegan tarde).
  const confirmed = input.signups.filter((signup) => signup.status === "yes");
  const bench = input.signups.filter((signup) => signup.status === "bench");
  const late = input.signups.filter((signup) => signup.status === "late");
  // Igual que en la web: los que marcaron "no asisto" también se listan.
  const absent = input.signups.filter((signup) => signup.status === "no");
  const possibles = bench.length + late.length;
  // Roster esperado del evento (rol mínimo + bench del roster).
  const expected = input.expectedCount ?? 0;

  const fields: Array<{ inline?: boolean; name: string; value: string }> = [];
  // Discord empaqueta los fields inline de a TRES, así que la fila se cierra con
  // un field de ancho cero: sin ese corte, el field siguiente se mete en la fila
  // de arriba (las columnas del roster se corrían una posición según cuántos
  // datos hubiera).
  // Orden: primero **empieza y termina** (lo que se mira para confirmar la hora),
  // después el **cierre** con el **requisito para anotarse**, después el **conteo
  // de gente** en un solo field (roster, asistencia y el detalle por estado) y al
  // final la gente.
  fields.push({ inline: true, name: "🕒 Empieza", value: `<t:${timestamp}:t>` });
  fields.push({
    inline: true,
    name: "🏁 Termina",
    value:
      endTimestamp && durationHours
        ? `<t:${endTimestamp}:t> (${durationHours})`
        : "—",
  });
  pushSpacer(fields);
  const requiredRoleId = input.requiredRoleId?.trim();
  fields.push({
    inline: true,
    name: "⏳ Cierre de inscripciones",
    // Con el día (martes 20:00): el aviso puede ser semanal, así que la hora
    // sola no dice cuándo cierra.
    value: input.signupDeadline
      ? `${weekdayName(input.signupDeadline)} <t:${Math.floor(input.signupDeadline.getTime() / 1000)}:t>`
      : "—",
  });
  if (requiredRoleId) {
    // La mención va en el VALOR: en el nombre de un field Discord no la
    // resuelve y la muestra cruda (`<@&id>`), que es lo que se veía roto.
    fields.push({
      inline: true,
      name: "\u200b",
      value: `Requiere <@&${requiredRoleId}>\n*Sin el rol, la inscripción queda como Bench.*`,
    });
  }
  pushSpacer(fields);
  // Todo el conteo de gente en UN field: el roster esperado (los que
  // RESPONDIERON, cualquier estado, bench incluido, y también "no asisto": haber
  // contestado es lo que saca a alguien de "faltan anotarse"), la asistencia
  // (confirmados y, entre paréntesis, los posibles = bench + tarde) y el detalle
  // por estado, en el mismo orden. Es a lo ancho (no inline): es el encabezado de
  // la lista que viene abajo.
  const rosterCount =
    expected > 0
      ? `**${input.rosterSignedCount ?? 0}/${expected}**`
      : undefined;
  const attendanceLine =
    input.signups.length === 0
      ? "Sin anotados todavía"
      : `${[
          rosterCount,
          `✅ **${confirmed.length}**${possibles > 0 ? ` (+${possibles})` : ""}`,
        ]
          .filter(Boolean)
          .join(" · ")} · 🪑 ${bench.length} - ⏰ ${late.length} - ❌ ${absent.length}`;
  fields.push({ name: "👥 Roster", value: attendanceLine });
  pushSpacer(fields);
  // La repetición NO se muestra en Discord (solo en la web): el aviso queda
  // para la fecha concreta del evento.

  const resolveSpec = (
    signup: AnnouncementSignup,
  ): AnnouncementSpec | undefined => {
    const elegida = input.specs.find(
      (spec) =>
        spec.role === signup.role &&
        spec.className === signup.wowClass &&
        // El segundo eje puede estar desactivado (se guarda vacío).
        spec.specName === (signup.spec ?? ""),
    );
    if (elegida || !signup.rosterClass) {
      return elegida;
    }
    // No eligió clase en el evento: se muestra la del roster (misma clase y
    // spec, sin mirar el rol: el emoji es el mismo).
    return input.specs.find(
      (spec) =>
        spec.className === signup.rosterClass?.className &&
        spec.specName === signup.rosterClass?.specName,
    );
  };

  const memberLabel = (signup: AnnouncementSignup): string => {
    const spec = resolveSpec(signup);
    const mention = specMention(spec);
    // SOLO el alias: en una columna de media pantalla entran ~13 caracteres
    // (fuente del celular), así que "alias (personaje)" no entra nunca y se
    // partía en dos líneas. El personaje se ve en la web (tarjeta y perfil).
    const name = `**${signup.username}**`;
    return mention ? `${mention} ${name}` : `❔ ${name}`;
  };

  // Un renglón por integrante (roster y estados).
  const linesFor = (members: AnnouncementSignup[]): string[] =>
    members.map(memberLabel);

  // Orden y etiquetas de los roles: los configurados por la guild; cualquier
  // rol viejo (p. ej. "dps" legacy o un rol borrado de la config) va al final
  // para no perder a nadie del roster.
  const roles =
    input.roles && input.roles.length > 0 ? input.roles : DEFAULT_ROLE_OPTIONS;
  const knownKeys = new Set(roles.map((role) => role.key));
  const leftoverKeys = [
    ...new Set(
      confirmed
        .map((signup) => signup.role)
        .filter(
          (role): role is string => role !== undefined && !knownKeys.has(role),
        ),
    ),
  ];
  const orderedRoles: EventRoleOption[] = [
    ...roles,
    ...leftoverKeys.map((key) => ({
      animated: false,
      emoji: ROLE_META[key]?.emoji,
      key,
      label: ROLE_META[key]?.label ?? key,
    })),
  ];

  // Columnas del roster: un bloque por rol con gente (incluye los roles que ya
  // no están en la config y los que se anotaron sin elegir rol).
  const columns: Array<{ label: string; members: AnnouncementSignup[] }> = [];
  for (const role of orderedRoles) {
    const members = confirmed.filter((signup) => signup.role === role.key);
    if (members.length === 0) {
      continue;
    }
    columns.push({
      label: `${roleEmoji(role)} ${role.label} (${members.length})`,
      members,
    });
  }
  // Quien se anotó sin elegir rol (p. ej. con los botones rápidos de estado)
  // no puede desaparecer del roster: va en su columna al final, igual que la web.
  const noRole = confirmed.filter((signup) => !signup.role);
  if (noRole.length > 0) {
    columns.push({
      label: `❔ Sin rol (${noRole.length})`,
      members: noRole,
    });
  }

  // Roster: de a DOS columnas por fila (media pantalla cada una), igual que
  // antes: como ahora cada integrante es solo el alias (~6-10 caracteres),
  // entra en una línea en cualquier celular. El salto entre pares se fuerza con
  // un espacio en blanco (Discord empaqueta solo los fields inline de a tres).
  // Con un solo rol con gente, la columna va a lo ancho (no inline).
  // Los nombres van citados (`> `): cada rol queda con su barra, que es lo que
  // evita que se lea como una lista pegada sin divisiones.
  const rosterInline = columns.length > 1;
  columns.forEach((column, index) => {
    // Un renglón de aire antes de cada PAR (el primero ya viene separado por el
    // espacio de los conteos): Discord empaqueta solo los inline de a tres, así
    // que el corte hay que ponerlo a mano.
    if (rosterInline && index > 0 && index % 2 === 0) {
      pushSpacer(fields);
    }
    pushField(
      fields,
      column.label,
      linesFor(column.members),
      rosterInline,
      true,
    );
  });
  // Estados: NO van inline, así cada uno queda en su propia fila (una debajo
  // de la otra) y en este orden: bench → tarde → no asisten. Van separados del
  // roster (y entre ellos) con un poco de aire. Igual que el roster, los
  // nombres van citados (`> `) para que el bloque se lea igual que los roles.
  const statusGroups: Array<[string, AnnouncementSignup[]]> = [
    [`🪑 Bench (${bench.length})`, bench],
    [`⏰ Llegan tarde (${late.length})`, late],
    [`❌ No asisten (${absent.length})`, absent],
  ];
  let firstStatus = true;
  for (const [label, members] of statusGroups) {
    if (members.length === 0) {
      continue;
    }
    // Un renglón de aire antes del primer estado (para despegarlo del roster);
    // entre estados alcanza con la separación propia de Discord.
    if (firstStatus) {
      pushSpacer(fields);
    }
    firstStatus = false;
    pushField(fields, label, linesFor(members), false, true);
  }

  // Descripción: banner de estado + cuándo, link a la web y la descripción
  // que escribió el staff. El resto (duración, cierre, requisito, asistencia
  // y roster) va en fields, que es lo que le da el aspecto ordenado.
  const webBase = env.FRONTEND_APP_URL?.trim().replace(/\/+$/, "");
  const descriptionParts: string[] = [];
  if (isPaused) {
    descriptionParts.push(
      "⏸️ **EVENTO PAUSADO** — momentáneamente sin inscripciones.",
    );
  } else if (signupsClosed && input.signupDeadline) {
    const dl = Math.floor(input.signupDeadline.getTime() / 1000);
    descriptionParts.push(
      `🔒 **INSCRIPCIONES CERRADAS** — ya no se puede anotar (cerró <t:${dl}:R>).`,
    );
  }
  descriptionParts.push(whenLines.join("\n"));
  if (webBase) {
    descriptionParts.push(`[🌐 Ver el evento en la web](${webBase}/#/eventos)`);
  }
  let descriptionText = descriptionParts.join("\n\n");
  if (input.description?.trim()) {
    descriptionText += `\n\n${input.description.trim().slice(0, 1024)}`;
  }

  // Footer: deja claro de qué juego es el aviso (cada evento puede ser de uno
  // distinto) y qué tipo de evento es.
  const gameLabel = input.gameLabel?.trim();
  const footerText = gameLabel
    ? `Bonafide Hub · ${gameLabel} · ${typeLabel}`
    : `Bonafide Hub · ${typeLabel}`;

  const embed: Record<string, unknown> = {
    title: input.title.slice(0, 250),
    color: eventEmbedColor(
      { paused: isPaused, signupsClosed, tags: input.tags },
      EVENT_EMBED_COLOR,
    ),
    description: descriptionText,
    fields,
    footer: { text: footerText },
    // Sello de tiempo abajo a la derecha (se actualiza solo con cada refresh).
    timestamp: new Date().toISOString(),
  };
  // Icono de la guild: thumbnail a la derecha + icono del footer + icono del
  // autor. Le da identidad al aviso (sin pisar la imagen grande del evento).
  if (input.guildIconUrl) {
    embed.thumbnail = { url: input.guildIconUrl };
    embed.footer = {
      icon_url: input.guildIconUrl,
      text: footerText,
    };
  }
  // Tag libre del evento (estilo comunicados): va como "autor" del embed para
  // que se vea arriba del título con su color de acento. Con varias etiquetas
  // se separan por " · " (el nombre del autor tiene tope de 256 caracteres).
  const tagLabels = (input.tags ?? [])
    .map((tag) => tag.label.trim())
    .filter(Boolean);
  if (tagLabels.length > 0) {
    embed.author = {
      ...(input.guildIconUrl ? { icon_url: input.guildIconUrl } : {}),
      name: `🏷️ ${tagLabels.join(" · ").slice(0, 250)}`,
    };
  }
  if (input.discordEventId) {
    embed.url = `https://discord.com/events/${encodeURIComponent(input.guildId)}/${encodeURIComponent(input.discordEventId)}`;
  }
  const image = resolveEmbedImageUrl(
    input.guildId,
    input.eventId,
    input.imageUrl,
  );
  if (image) {
    embed.image = { url: image };
  }
  return [embed];
}

// Edita un mensaje-aviso existente con embeds nuevos (auto-refresh del
// roster cuando cambian las inscripciones). Devuelve la respuesta cruda de
// Discord para que el caller distinga "mensaje borrado" de otros errores.
async function patchAnnouncement(input: {
  channelId: string;
  // Si se pasa, reemplaza los botones del mensaje (p. ej. deshabilitados
  // cuando ya cerró la inscripción). Si se omite, no toca los componentes.
  components?: Array<Record<string, unknown>>;
  // Si se pasa, reemplaza el texto del mensaje (se usa para limpiar una
  // mención de rol vieja; con rol vigente se omite para no re-notificar).
  content?: string;
  embeds: Array<Record<string, unknown>>;
  messageId: string;
}): Promise<Response> {
  const body: Record<string, unknown> = { embeds: input.embeds };
  if (input.components) {
    body.components = input.components;
  }
  if (input.content !== undefined) {
    body.content = input.content;
    body.allowed_mentions = { parse: [] };
  }
  return discordFetch(
    `/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}`,
    { method: "PATCH", body },
  );
}

// Edita un mensaje-aviso existente. Devuelve si Discord lo aceptó.
export async function updateEventAnnouncement(
  input: Parameters<typeof patchAnnouncement>[0],
): Promise<boolean> {
  const response = await patchAnnouncement(input);
  return response.ok;
}

// Botones que van fijos en el mensaje-aviso (los maneja el bot con el
// prefijo `eventsign:` en custom_id) para inscribirse desde Discord.
// `disableSignup` los deja grises cuando ya cerró la inscripción (seguimos
// permitiendo "Quitar inscripción", que sirve hasta para avisar que no va).
type ButtonSpec = {
  customId: string;
  disableWhenClosed: boolean;
  emoji: string;
  label: string;
  style: number;
};

export function buildEventSignupActionRows(
  eventId: string,
  options?: {
    characterEnabled?: boolean;
    classLabel?: string;
    disableSignup?: boolean;
    signupEnabled?: boolean;
    specLabel?: string;
  },
): Array<Record<string, unknown>> {
  // Evento informativo: sin botones. No hay nada que responder.
  if (options?.signupEnabled === false) {
    return [];
  }
  const disableSignup = options?.disableSignup ?? false;
  const classLabel = options?.classLabel ?? "Clase";
  const specLabel = options?.specLabel ?? "spec";
  const characterEnabled = options?.characterEnabled !== false;
  // disableWhenClosed: los botones de inscripción se grisan al cerrar; el de
  // "Quitar inscripción" sigue activo (sirve para avisar que no vas).
  const statusButtons: ButtonSpec[] = [
    {
      customId: "yes",
      disableWhenClosed: true,
      emoji: "✅",
      label: "Asistir",
      style: 3,
    },
    {
      customId: "late",
      disableWhenClosed: true,
      emoji: "⏰",
      label: "Tarde",
      style: 2,
    },
    {
      customId: "bench",
      disableWhenClosed: true,
      emoji: "🪑",
      label: "Bench",
      style: 2,
    },
    {
      customId: "no",
      disableWhenClosed: true,
      emoji: "❌",
      label: "No asisto",
      style: 2,
    },
  ];
  const actionButtons: ButtonSpec[] = [
    {
      customId: "pick",
      disableWhenClosed: true,
      emoji: "⚙️",
      label: `${classLabel} y ${specLabel}`,
      style: 1,
    },
    // Personaje con color (Primary) para que no quede gris entre los demás.
    // Solo en juegos con personaje (se apaga desde la config de roles).
    ...(characterEnabled
      ? [
          {
            customId: "character",
            disableWhenClosed: true,
            emoji: "✏️",
            label: "Personaje",
            style: 1,
          },
        ]
      : []),
    // Resetear: borra la inscripción y el personaje recordado.
    {
      customId: "reset",
      disableWhenClosed: true,
      emoji: "🔄",
      label: "Resetear registro",
      style: 2,
    },
    {
      customId: "remove",
      disableWhenClosed: false,
      emoji: "🗑️",
      label: "Quitar inscripción",
      style: 4,
    },
  ];
  const row = (buttons: ButtonSpec[]) => ({
    components: buttons.map((button) => ({
      custom_id: `eventsign:${eventId}:${button.customId}`,
      ...(disableSignup && button.disableWhenClosed ? { disabled: true } : {}),
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
  // Mención del rol mínimo en el contenido del mensaje: es la única forma de
  // que Discord NOTIFIQUE a todos los que tienen ese rol (las menciones dentro
  // del embed no avisan). Solo al publicar: los refrescos editan solo el
  // embed, así no se vuelve a mencionar (y no spamea).
  const content = announcementContent(input);
  const response = await discordFetch(
    `/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: "POST",
      body: {
        allowed_mentions: { parse: ["users", "roles"] },
        components: buildEventSignupActionRows(input.eventId, {
          characterEnabled: input.characterEnabled,
          classLabel: input.classLabel,
          disableSignup:
            input.paused === true ||
            (input.signupDeadline !== undefined &&
              input.signupDeadline.getTime() <= Date.now()),
          signupEnabled: input.signupEnabled,
          specLabel: input.specLabel,
        }),
        content: content || undefined,
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

// Publica la ENCUESTA nativa de Discord (✅ Sí · ❌ No) como mensaje aparte
// del aviso. Discord no deja editar un poll ya publicado (las respuestas
// quedan fijas), así que se publica una sola vez y solo se borra el mensaje
// cuando el evento se limpia.
// `hours` = duración en horas (Discord acepta 1..768). Sin `hours` Discord usa
// su propio default: 24 h (verificado contra la API real).
export async function postEventPoll(input: {
  channelId: string;
  hours?: number;
  roles?: EventRoleOption[];
  title: string;
}): Promise<{ error?: string; messageId?: string }> {
  const roles = (input.roles ?? []).filter((option) => option.label?.trim());
  if (roles.length < 2) {
    // Discord necesita al menos 2 respuestas para aceptar la encuesta.
    return {
      error:
        "La plantilla de encuesta necesita al menos 2 respuestas configuradas",
    };
  }

  // Emoji de la respuesta: custom (id + nombre) si está configurado, si no el
  // unicode. Discord acepta cualquiera de los dos dentro del poll.
  const emojiFor = (option: EventRoleOption) => {
    if (option.emojiId) {
      return { id: option.emojiId, name: option.emojiName || "emoji" };
    }
    const name = option.emoji?.trim() || option.emojiName?.trim();
    return name ? { name } : undefined;
  };

  const hours = input.hours && input.hours > 0 ? Math.min(input.hours, 768) : 0;
  const response = await discordFetch(
    `/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: "POST",
      body: {
        poll: {
          allow_multiselect: false,
          answers: roles.slice(0, 10).map((option) => ({
            poll_media: {
              emoji: emojiFor(option),
              text: (option.key === "si"
                ? "SI"
                : option.key === "no"
                  ? "NO"
                  : option.label
              )
                .trim()
                .slice(0, 55),
            },
          })),
          duration: hours > 0 ? hours : undefined,
          layout_type: 1,
          question: { text: input.title.slice(0, 300) },
        },
      },
    },
  );
  if (!response.ok) {
    const detail = await errorMessage(response);
    return { error: `No se pudo publicar la encuesta: ${detail}` };
  }
  const data = (await response.json()) as { id?: string };
  return { messageId: data.id };
}

// Sincroniza un evento hacia Discord según las opciones elegidas. No toca
// la DB: devuelve ids + errores para que el caller los persista.
// Con `existing` (evento que ya estaba publicado) se ACTUALIZA en el lugar:
// se parchea el scheduled event y se edita el mensaje-aviso, en vez de borrar
// y publicar de nuevo. Así se reflejan los cambios sin perder el hilo del
// canal ni re-notificar al rol.
export async function syncEventToDiscord(input: {
  // Rol de Bench del roster: el aviso lo menciona junto al rol mínimo.
  benchRoleId?: string;
  // Cumpleaños: la persona etiquetada en el aviso.
  birthdayUserId?: string;
  characterEnabled?: boolean;
  classLabel?: string;
  description?: string;
  discordEventId?: string;
  durationMinutes?: number;
  eventId: string;
  // Roster esperado del evento (rol mínimo + bench del roster): el denominador
  // del "Roster X/Y" del aviso.
  expectedCount?: number;
  // Cuántos del roster ya respondieron (cualquier estado, bench incluido).
  rosterSignedCount?: number;
  existing?: {
    discordEventId?: string;
    messageIds?: string[];
    pollMessageId?: string;
    publishChannelId?: string;
  };
  gameLabel?: string;
  guildIconUrl?: string;
  guildId: string;
  imageUrl?: string;
  options: EventDiscordOptions;
  ownRecurrenceEveryDays?: number;
  paused?: boolean;
  // Evento de la plantilla "encuesta": además del aviso, publica el poll.
  poll?: boolean;
  pollHours?: number;
  requiredRoleId?: string;
  roles?: EventRoleOption[];
  signupDeadline?: Date;
  signupEnabled?: boolean;
  signups?: AnnouncementSignup[];
  // No publicar (ni editar) el aviso: se usa cuando el evento todavía no entró
  // en su ventana. El evento agendado se crea igual.
  skipAnnouncement?: boolean;
  specLabel?: string;
  specs?: AnnouncementSpec[];
  startsAt: Date;
  tags?: EventTag[];
  title: string;
  type?: string;
}): Promise<EventPublishResult> {
  const { options } = input;
  const result: EventPublishResult = { messageIds: [] };

  // 1) Scheduled Event (si se pidió). Si ya existía, lo parcheamos.
  if (options.createScheduledEvent) {
    const now = Date.now();
    const started = input.startsAt.getTime() <= now;
    // Cuándo termina el evento: pasado eso no hay nada que agendar.
    const durationMinutes = input.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES;
    const endsAt = input.startsAt.getTime() + durationMinutes * 60_000;
    const existingId = input.existing?.discordEventId;

    if (existingId && started) {
      // Ya existe y el evento ya arrancó: no se mueve el inicio (eso lo dejaba
      // "por empezar" para siempre), pero sí se arranca: Discord lo deja en
      // "Iniciará pronto" hasta que alguien aprieta "Iniciar".
      result.discordEventId = existingId;
      await startScheduledEvent({
        discordEventId: existingId,
        guildId: input.guildId,
      });
    } else if (!started || endsAt > now) {
      // Si la fecha ya pasó pero el evento sigue vigente (un cumpleaños cargado
      // el mismo día) el evento agendado arranca ahora y termina cuando termina
      // el evento: Discord no acepta un inicio en el pasado.
      const startsAt = started ? nextSchedulableMinute() : input.startsAt;
      const payload = {
        description: input.description,
        durationMinutes: started
          ? Math.max(15, Math.round((endsAt - startsAt.getTime()) / 60_000))
          : input.durationMinutes,
        entityType: options.entityType,
        guildId: input.guildId,
        location: options.location,
        recurrence: options.recurrence,
        startsAt,
        title: input.title,
        voiceChannelId: options.voiceChannelId,
      };
      if (existingId) {
        const updated = await updateScheduledEvent({
          ...payload,
          discordEventId: existingId,
        });
        if (updated.error && updated.error !== "not_found") {
          result.error = updated.error;
          return result;
        }
        // not_found: el evento agendado ya no está en Discord → creamos uno
        // nuevo para que el evento vuelva a aparecer en la guild.
        if (updated.error === "not_found") {
          const recreated = await createScheduledEvent(payload);
          if (recreated.error) {
            result.error = recreated.error;
            return result;
          }
          result.discordEventId = recreated.id;
        } else {
          result.discordEventId = existingId;
        }
      } else {
        const created = await createScheduledEvent(payload);
        if (created.error) {
          result.error = created.error;
          return result;
        }
        result.discordEventId = created.id;
      }
      // Si nació con la fecha ya pasada (evento cargado el mismo día) hay que
      // arrancarlo: si no, queda "Iniciará pronto" hasta que alguien apriete
      // "Iniciar" a mano.
      if (started && result.discordEventId) {
        await startScheduledEvent({
          discordEventId: result.discordEventId,
          guildId: input.guildId,
        });
      }
    } else {
      // El evento ya terminó: no hay nada que agendar.
      result.discordEventId =
        input.existing?.discordEventId ?? input.discordEventId;
      console.warn(
        `[eventos] sin evento agendado para "${input.title}": terminó (${new Date(endsAt).toISOString()})`,
      );
    }
  } else {
    // Ya no se pide scheduled event: conservamos el id previo (si venía) por
    // si el caller decidió limpiarlo antes.
    result.discordEventId = input.discordEventId;
  }

  // 2) Aviso en canal (si se pidió y todavía no toca publicarlo).
  if (
    options.publishMessage &&
    options.publishChannelId &&
    input.skipAnnouncement !== true
  ) {
    const announcementInput = {
      benchRoleId: input.benchRoleId,
      birthdayUserId: input.birthdayUserId,
      channelId: options.publishChannelId,
      characterEnabled: input.characterEnabled,
      classLabel: input.classLabel,
      description: input.description,
      discordEventId: result.discordEventId ?? input.discordEventId,
      durationMinutes: input.durationMinutes,
      eventId: input.eventId,
      expectedCount: input.expectedCount,
      rosterSignedCount: input.rosterSignedCount,
      gameLabel: input.gameLabel,
      guildIconUrl: input.guildIconUrl,
      guildId: input.guildId,
      imageUrl: input.imageUrl,
      location:
        options.entityType === "external" ? options.location : undefined,
      recurrence: options.recurrence,
      ownRecurrenceEveryDays: input.ownRecurrenceEveryDays,
      paused: input.paused,
      requiredRoleId: input.requiredRoleId,
      roles: input.roles,
      signupDeadline: input.signupDeadline,
      signupEnabled: input.signupEnabled,
      signups: input.signups ?? [],
      specLabel: input.specLabel,
      specs: input.specs ?? [],
      startsAt: input.startsAt,
      tags: input.tags,
      title: input.title,
      type: input.type,
    };
    // Aviso ya publicado en el mismo canal → editamos ese mensaje (no se
    // pierde la posición ni se vuelve a mencionar el rol). Si el canal cambió
    // o no hay mensaje previo, se publica uno nuevo.
    const previousMessages =
      input.existing?.publishChannelId === options.publishChannelId
        ? (input.existing?.messageIds ?? [])
        : [];
    if (previousMessages.length > 0) {
      const embeds = buildEventAnnouncementEmbeds(announcementInput);
      // Deja la mención del rol al día: la agrega si falta y la normaliza si
      // quedó con decoración vieja (p. ej. `🛡️ <@&rol>`), sin re-notificar.
      const content = await resolveAnnouncementContent({
        benchRoleId: input.benchRoleId,
        birthdayUserId: input.birthdayUserId,
        channelId: options.publishChannelId,
        messageId: previousMessages[0],
        requiredRoleId: input.requiredRoleId,
      });
      const edited = await patchAnnouncement({
        channelId: options.publishChannelId,
        components: buildEventSignupActionRows(input.eventId, {
          characterEnabled: input.characterEnabled,
          classLabel: input.classLabel,
          disableSignup:
            input.paused === true ||
            (input.signupDeadline !== undefined &&
              input.signupDeadline.getTime() <= Date.now()),
          signupEnabled: input.signupEnabled,
          specLabel: input.specLabel,
        }),
        content,
        embeds,
        messageId: previousMessages[0],
      });
      if (edited.ok) {
        result.messageIds = previousMessages;
      } else if (edited.status === 404) {
        // El mensaje lo borraron a mano en Discord: publicamos uno nuevo.
        const announcement = await postAnnouncement(announcementInput);
        if (announcement.error) {
          result.error = result.error ?? announcement.error;
        } else if (announcement.messageId) {
          result.messageIds = [announcement.messageId];
        }
      } else {
        result.error =
          result.error ??
          `No se pudo actualizar el aviso en Discord: ${await errorMessage(edited)}`;
        result.messageIds = previousMessages;
      }
    } else {
      const announcement = await postAnnouncement(announcementInput);
      if (announcement.error) {
        result.error = result.error ?? announcement.error;
      } else if (announcement.messageId) {
        result.messageIds = [announcement.messageId];
      }
    }
  } else if (input.skipAnnouncement === true) {
    // Todavía no toca publicar el aviso: se conservan los ids que hubiera.
    result.messageIds = input.existing?.messageIds ?? [];
  }

  // 3) Encuesta nativa (plantilla "encuesta"): va como mensaje aparte del
  // aviso. Como un poll publicado no se puede editar, si ya existe en el mismo
  // canal se conserva y solo se publica cuando todavía no hay ninguno.
  if (
    input.poll === true &&
    options.publishMessage &&
    options.publishChannelId
  ) {
    const previousPoll =
      input.existing?.publishChannelId === options.publishChannelId
        ? input.existing?.pollMessageId
        : undefined;
    if (previousPoll) {
      result.pollMessageId = previousPoll;
    } else {
      const poll = await postEventPoll({
        channelId: options.publishChannelId,
        hours: input.pollHours,
        roles: input.roles,
        title: input.title,
      });
      if (poll.error) {
        result.error = result.error ?? poll.error;
      } else if (poll.messageId) {
        result.pollMessageId = poll.messageId;
      }
    }
  }

  return result;
}

// Limpia lo publicado en Discord (scheduled event + mensajes-aviso).
// Es best-effort: un 404 se considera éxito (ya no está), pero cualquier otro
// fallo se junta y se devuelve para poder avisarle al usuario. Antes esto era
// totalmente silencioso: si Discord rechazaba el borrado, quedaban el aviso y
// los recordatorios publicados y no había forma de enterarse.
export async function cleanupEventDiscord(input: {
  discordEventId?: string;
  guildId: string;
  discordMessageIds?: string[];
  pollMessageId?: string;
  publishChannelId?: string;
  reminderMessageIds?: string[];
}): Promise<{ failed: string[] }> {
  const failed: string[] = [];

  const remove = async (path: string, what: string): Promise<void> => {
    const response = await discordFetch(path, { method: "DELETE" }).catch(
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        failed.push(`${what}: ${detail}`);
        console.warn(`[eventos] no se pudo borrar ${what}: ${detail}`);
        return null;
      },
    );

    if (!response || response.ok || response.status === 404) {
      return;
    }

    const detail = await errorMessage(response);
    failed.push(`${what}: ${response.status} ${detail}`);
    console.warn(
      `[eventos] no se pudo borrar ${what} (${response.status}): ${detail}`,
    );
  };

  if (input.discordEventId) {
    await remove(
      `/guilds/${encodeURIComponent(input.guildId)}/scheduled-events/${encodeURIComponent(input.discordEventId)}`,
      "el evento agendado",
    );
  }

  const messageIds = [
    ...(input.discordMessageIds ?? []),
    ...(input.reminderMessageIds ?? []),
    ...(input.pollMessageId ? [input.pollMessageId] : []),
  ];
  if (messageIds.length > 0) {
    if (!input.publishChannelId) {
      failed.push(
        `los mensajes del aviso (${messageIds.length}): falta el canal de publicación`,
      );
      console.warn(
        "[eventos] hay mensajes para borrar pero el evento no tiene canal de publicación",
      );
    } else {
      for (const messageId of messageIds) {
        await remove(
          `/channels/${encodeURIComponent(input.publishChannelId)}/messages/${encodeURIComponent(messageId)}`,
          `un mensaje del evento (${messageId})`,
        );
      }
    }
  }

  return { failed };
}
