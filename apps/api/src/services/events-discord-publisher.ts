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

// Contenido del mensaje-aviso según el rol requerido del evento:
//   - con rol  → la mención pelada `<@&rol>`;
//   - sin rol  → "" (limpia una mención vieja que haya quedado).
//
// Devuelve `undefined` (no tocar) cuando el mensaje YA dice exactamente eso:
// así los refrescos no reescriben el contenido. Si el mensaje tiene la mención
// con decoración vieja (p. ej. `🛡️ <@&rol>`), se normaliza al refrescar sin
// notificar (el PATCH va con `allowed_mentions: { parse: [] }`).
export async function resolveAnnouncementContent(input: {
  channelId: string;
  messageId: string;
  requiredRoleId?: string;
}): Promise<string | undefined> {
  const desired = input.requiredRoleId?.trim()
    ? `<@&${input.requiredRoleId.trim()}>`
    : "";
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

function signupDisplay(signup: AnnouncementSignup): string {
  // El nombre de Discord es el principal; el personaje (opcional) va entre
  // paréntesis, en la MISMA línea. No se omite cuando coincide con el nick: el
  // jugador quiere ver los dos datos.
  const character = signup.character?.trim();
  return character ? `${signup.username} (${character})` : signup.username;
}

// Empuja líneas a un field, partiendo en varios si supera 1024 chars
// (límite de Discord para el value de un field). `inline` los pone en
// columnas (3 por fila), que es lo que mantiene el embed "horizontal".
function pushField(
  fields: Array<{ inline?: boolean; name: string; value: string }>,
  name: string,
  lines: string[],
  inline = false,
): void {
  if (lines.length === 0) {
    return;
  }
  let value = "";
  for (const line of lines) {
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
    return `${base}/public/guilds/${encodeURIComponent(guildId)}/events/${encodeURIComponent(eventId)}/image`;
  }
  return undefined;
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
  tagLabel?: string;
  title: string;
  type?: string;
  // Si el juego no usa personaje, el aviso no muestra el botón "Personaje".
  characterEnabled?: boolean;
}): Array<Record<string, unknown>> {
  const typeLabel = input.type ?? "evento";
  const timestamp = Math.floor(input.startsAt.getTime() / 1000);

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
  const assistanceValue =
    input.signups.length === 0
      ? "Sin anotados todavía"
      : [
          `**${confirmed.length}** confirmados${
            possibles > 0 ? ` (+${possibles})` : ""
          }`,
          [
            `✅ ${confirmed.length}`,
            `🪑 ${bench.length}`,
            `⏰ ${late.length}`,
            `❌ ${absent.length}`,
          ].join(" · "),
        ].join("\n");

  const fields: Array<{ inline?: boolean; name: string; value: string }> = [];
  // Datos del evento: uno por línea (vertical), así se leen cómodos.
  fields.push({ name: "🕒 Empieza", value: `<t:${timestamp}:t>` });
  fields.push({
    name: "⏱️ Duración",
    value: endTimestamp
      ? `${input.durationMinutes} min\n(termina <t:${endTimestamp}:t>)`
      : "—",
  });
  fields.push({
    name: "⏳ Cierre de inscripciones",
    value: input.signupDeadline
      ? `<t:${Math.floor(input.signupDeadline.getTime() / 1000)}:t>`
      : "—",
  });
  // La repetición NO se muestra en Discord (solo en la web): el aviso queda
  // para la fecha concreta del evento.
  // Requisito de rol: caja aparte (bien visible) + el mensaje menciona al rol
  // para que notifique a todos los que lo tienen.
  const requiredRoleId = input.requiredRoleId?.trim();
  if (requiredRoleId) {
    fields.push({
      name: "👥 Roster principal",
      value: `Requiere <@&${requiredRoleId}>\n*Sin el rol, la inscripción queda como Bench.*`,
    });
  }
  fields.push({ name: "📊 Asistencia", value: assistanceValue });

  const resolveSpec = (
    signup: AnnouncementSignup,
  ): AnnouncementSpec | undefined =>
    input.specs.find(
      (spec) =>
        spec.role === signup.role &&
        spec.className === signup.wowClass &&
        // El segundo eje puede estar desactivado (se guarda vacío).
        spec.specName === (signup.spec ?? ""),
    );

  const linesFor = (members: AnnouncementSignup[]): string[] =>
    members.map((signup) => {
      const spec = resolveSpec(signup);
      const mention = specMention(spec);
      const name = `**${signupDisplay(signup)}**`;
      return mention ? `${mention} ${name}` : `❔ ${name}`;
    });

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

  for (const role of orderedRoles) {
    const members = confirmed.filter((signup) => signup.role === role.key);
    if (members.length === 0) {
      continue;
    }
    // Horizontal: cada rol es una COLUMNA (hasta 3 por fila), así el roster no
    // empuja el embed hacia abajo. El nick va sin repetir el personaje cuando
    // es el mismo, que es lo que hacía que el texto se partiera en dos líneas.
    pushField(
      fields,
      `${roleEmoji(role)} ${role.label} (${members.length})`,
      linesFor(members),
      true,
    );
  }
  // Quien se anotó sin elegir rol (p. ej. con los botones rápidos de estado)
  // no puede desaparecer del roster: va en su columna al final, igual que la web.
  const noRole = confirmed.filter((signup) => !signup.role);
  if (noRole.length > 0) {
    pushField(fields, `❔ Sin rol (${noRole.length})`, linesFor(noRole), true);
  }
  // Estados: NO van inline, así cada uno queda en su propia fila (una debajo
  // de la otra) y en este orden: tarde → bench → no asisten.
  if (late.length > 0) {
    pushField(fields, `⏰ Llegan tarde (${late.length})`, linesFor(late));
  }
  if (bench.length > 0) {
    pushField(fields, `🪑 Bench (${bench.length})`, linesFor(bench));
  }
  if (absent.length > 0) {
    pushField(fields, `❌ No asisten (${absent.length})`, linesFor(absent));
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
    // Gris si está pausado, rojo si ya no se puede anotar; azul el resto.
    color: isPaused ? 0x8b93a7 : signupsClosed ? 0xe5484d : 0x6aa8ff,
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
  // que se vea arriba del título con su color de acento.
  const tagLabel = input.tagLabel?.trim();
  if (tagLabel) {
    embed.author = {
      ...(input.guildIconUrl ? { icon_url: input.guildIconUrl } : {}),
      name: `🏷️ ${tagLabel.slice(0, 250)}`,
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
    specLabel?: string;
  },
): Array<Record<string, unknown>> {
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
  const requiredRoleId = input.requiredRoleId?.trim();
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
          specLabel: input.specLabel,
        }),
        content: requiredRoleId ? `<@&${requiredRoleId}>` : undefined,
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
// Con `existing` (evento que ya estaba publicado) se ACTUALIZA en el lugar:
// se parchea el scheduled event y se edita el mensaje-aviso, en vez de borrar
// y publicar de nuevo. Así se reflejan los cambios sin perder el hilo del
// canal ni re-notificar al rol.
export async function syncEventToDiscord(input: {
  characterEnabled?: boolean;
  classLabel?: string;
  description?: string;
  discordEventId?: string;
  durationMinutes?: number;
  eventId: string;
  existing?: {
    discordEventId?: string;
    messageIds?: string[];
    publishChannelId?: string;
  };
  gameLabel?: string;
  guildIconUrl?: string;
  guildId: string;
  imageUrl?: string;
  options: EventDiscordOptions;
  ownRecurrenceEveryDays?: number;
  paused?: boolean;
  requiredRoleId?: string;
  roles?: EventRoleOption[];
  signupDeadline?: Date;
  signups?: AnnouncementSignup[];
  specLabel?: string;
  specs?: AnnouncementSpec[];
  startsAt: Date;
  tagLabel?: string;
  title: string;
  type?: string;
}): Promise<EventPublishResult> {
  const { options } = input;
  const result: EventPublishResult = { messageIds: [] };

  // 1) Scheduled Event (si se pidió). Si ya existía, lo parcheamos.
  if (options.createScheduledEvent) {
    const payload = {
      description: input.description,
      durationMinutes: input.durationMinutes,
      entityType: options.entityType,
      guildId: input.guildId,
      location: options.location,
      recurrence: options.recurrence,
      startsAt: input.startsAt,
      title: input.title,
      voiceChannelId: options.voiceChannelId,
    };
    if (input.existing?.discordEventId) {
      const updated = await updateScheduledEvent({
        ...payload,
        discordEventId: input.existing.discordEventId,
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
        result.discordEventId = input.existing.discordEventId;
      }
    } else {
      const created = await createScheduledEvent(payload);
      if (created.error) {
        result.error = created.error;
        return result;
      }
      result.discordEventId = created.id;
    }
  } else {
    // Ya no se pide scheduled event: conservamos el id previo (si venía) por
    // si el caller decidió limpiarlo antes.
    result.discordEventId = input.discordEventId;
  }

  // 2) Aviso en canal (si se pidió).
  if (options.publishMessage && options.publishChannelId) {
    const announcementInput = {
      channelId: options.publishChannelId,
      characterEnabled: input.characterEnabled,
      classLabel: input.classLabel,
      description: input.description,
      discordEventId: result.discordEventId ?? input.discordEventId,
      durationMinutes: input.durationMinutes,
      eventId: input.eventId,
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
      signups: input.signups ?? [],
      specLabel: input.specLabel,
      specs: input.specs ?? [],
      startsAt: input.startsAt,
      tagLabel: input.tagLabel,
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
  reminderMessageIds?: string[];
}): Promise<void> {
  if (input.discordEventId) {
    await discordFetch(
      `/guilds/${encodeURIComponent(input.guildId)}/scheduled-events/${encodeURIComponent(input.discordEventId)}`,
      { method: "DELETE" },
    );
  }
  if (input.publishChannelId) {
    // Aviso(s) del evento + mensajes de recordatorio publicado(s).
    const messageIds = [
      ...(input.discordMessageIds ?? []),
      ...(input.reminderMessageIds ?? []),
    ];
    for (const messageId of messageIds) {
      await discordFetch(
        `/channels/${encodeURIComponent(input.publishChannelId)}/messages/${encodeURIComponent(messageId)}`,
        { method: "DELETE" },
      );
    }
  }
}
