import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { env } from "../config/env.js";

// ── Inscripción a eventos desde Discord ─────────────────────────────
// Los botones del embed (`eventsign:{eventId}:{accion}`) los crea el API al
// publicar el aviso. Este módulo maneja los clicks: flujo "estado → rol →
// spec" con mensajes efímeros y registra la inscripción en el API interna
// (que refresca el roster en el embed y en la web).

type EventInteraction = ButtonInteraction | StringSelectMenuInteraction;

const REMOTE_BASE = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const REMOTE_TOKEN = env.BOT_CONFIG_API_TOKEN?.trim();

// Roles por defecto (los clásicos). La guild puede reemplazarlos desde el
// panel Admin (p. ej. Top/Jungle/Mid/ADC/Support para LoL).
const DEFAULT_ROLES: RemoteRole[] = [
  { animated: false, emoji: "🛡️", key: "tank", label: "Tank" },
  { animated: false, emoji: "💚", key: "healer", label: "Healer" },
  { animated: false, emoji: "⚔️", key: "melee", label: "Melee" },
  { animated: false, emoji: "🏹", key: "ranged", label: "Range" },
];

// Textos NEUTROS (sin voseo): se muestran como título de la acción y en la
// confirmación, así sirven en cualquier variante del español.
const STATUS_TITLE: Record<string, string> = {
  bench: "Quedar en bench",
  late: "Llegar tarde",
  no: "No asistir",
  yes: "Asistir",
};

type RemoteRole = {
  animated: boolean;
  emoji?: string;
  emojiId?: string;
  emojiName?: string;
  key: string;
  label: string;
};

type RemoteSpec = {
  animated: boolean;
  className: string;
  emojiId?: string;
  emojiName?: string;
  role: string;
  specName: string;
};

// Config del asistente: roles y etiquetas de los ejes del catálogo. Lo define
// el panel Admin y lo sirve el API.
type SignupContext = {
  classLabel: string;
  roles: RemoteRole[];
  specLabel: string;
  specs: RemoteSpec[];
};

type RemoteSignup = {
  character?: string;
  role?: string;
  spec?: string;
  status: string;
  userId: string;
  username: string;
  wowClass?: string;
};

type RemoteEvent = {
  event?: {
    characterEnabled?: boolean;
    // Juego del evento (wow | lol | ...): define los roles del asistente y el
    // catálogo de clases/specs que se ofrece.
    game?: string;
    // Personaje que el jugador usó la última vez (lo manda el API cuando se
    // pide el evento con ?userId=): así no lo volvemos a pedir en cada evento.
    playerCharacter?: string | null;
    signups?: RemoteSignup[];
    status?: string;
  };
};

async function remoteRequest(
  path: string,
  init?: { body?: unknown; method?: string },
): Promise<{ data: Record<string, unknown>; ok: boolean; status: number }> {
  if (!REMOTE_BASE || !REMOTE_TOKEN) {
    return { data: {}, ok: false, status: 503 };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${REMOTE_BASE}${path}`, {
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        "content-type": "application/json",
        "x-bot-token": REMOTE_TOKEN,
      },
      method: init?.method ?? "GET",
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { data, ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

function getErrorMessage(data: Record<string, unknown>): string {
  return typeof data.error === "string" ? data.error : "No se pudo completar.";
}

function parseCustomId(
  customId: string,
): { action?: string; eventId?: string; rest: string[] } | null {
  if (!customId.startsWith("eventsign:")) {
    return null;
  }
  const parts = customId.split(":");
  if (parts.length < 3) {
    return null;
  }
  return { action: parts[2], eventId: parts[1], rest: parts.slice(3) };
}

async function replyOnce(
  interaction: EventInteraction,
  content: string,
): Promise<void> {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch {
    // Ya respondido (p. ej. botón de un mensaje efímero): se edita.
    try {
      await interaction.update({ content });
    } catch {
      // Nada más que hacer.
    }
  }
}

async function updateWizard(
  interaction: EventInteraction,
  content: string,
  components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>>,
): Promise<void> {
  try {
    await interaction.update({ components, content });
  } catch {
    try {
      await interaction.reply({ components, content, ephemeral: true });
    } catch {
      // Nada más que hacer.
    }
  }
}

function fetchMemberName(interaction: EventInteraction): string {
  const member = interaction.member as { displayName?: string } | null;
  return member?.displayName?.trim() || interaction.user.username;
}

// Trae el evento. Con `userId` el API además devuelve el personaje recordado
// de ese jugador (`event.playerCharacter`), que se usa para no pedirlo de nuevo.
async function fetchEvent(
  guildId: string,
  eventId: string,
  userId?: string,
): Promise<RemoteEvent["event"] | null> {
  const suffix = userId
    ? `?userId=${encodeURIComponent(userId)}`
    : "";
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(guildId)}/events/${encodeURIComponent(eventId)}${suffix}`,
  );
  if (!response.ok) {
    return null;
  }
  const payload = response.data as { event?: RemoteEvent["event"] };
  return payload.event ?? null;
}

// ¿Hay que pedirle el personaje ANTES de guardar la inscripción? Solo si el
// evento lo pide y el jugador no tiene ninguno: ni en este evento ni recordado
// de antes. En ese caso no se guarda nada hasta que lo complete.
function needsCharacter(
  event: RemoteEvent["event"] | null,
  userId: string,
): boolean {
  if (!event || event.characterEnabled === false) {
    return false;
  }
  const mine = event.signups?.find((signup) => signup.userId === userId);
  return !mine?.character && !event.playerCharacter;
}

// Inscripción que quedó esperando el personaje: el modal no puede llevar
// payload, así que guardamos lo que el jugador ya eligió (estado, rol y
// clase/spec) y la completamos cuando envía el nombre.
type PendingSignup = {
  className?: string;
  role?: string;
  specName?: string;
  status: string;
};

const pendingSignups = new Map<string, PendingSignup>();

function pendingKey(userId: string, eventId: string): string {
  return `${userId}:${eventId}`;
}

// Config del asistente del juego del evento: roles y etiquetas de los ejes del
// catálogo. La define el panel Admin (Configuración de eventos) y la sirve el
// API según el juego que tenga el evento.
async function fetchSignupContext(
  guildId: string,
  game?: string,
): Promise<SignupContext> {
  const suffix = game ? `?game=${encodeURIComponent(game)}` : "";
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(guildId)}/events/specs${suffix}`,
  );
  if (!response.ok) {
    return {
      classLabel: "Clase",
      roles: DEFAULT_ROLES,
      specLabel: "Spec",
      specs: [],
    };
  }
  const payload = response.data as Partial<SignupContext>;
  const roles =
    Array.isArray(payload.roles) && payload.roles.length > 0
      ? payload.roles.filter((role) => role?.key && role?.label)
      : DEFAULT_ROLES;

  return {
    classLabel: payload.classLabel ?? "Clase",
    roles: roles.length > 0 ? roles : DEFAULT_ROLES,
    specLabel: payload.specLabel ?? "Spec",
    specs: payload.specs ?? [],
  };
}

// Emoji del rol como componente de Discord (custom con id, o unicode).
function roleEmojiComponent(
  role: RemoteRole,
): string | { animated?: boolean; id: string; name: string } {
  if (role.emojiId && role.emojiName) {
    return { animated: role.animated, id: role.emojiId, name: role.emojiName };
  }
  return role.emoji ?? "❔";
}

async function putSignup(input: {
  character?: string;
  guildId: string;
  eventId: string;
  role?: string;
  spec?: string;
  status: string;
  userId: string;
  username: string;
  wowClass?: string;
}): Promise<{ ok: boolean; character?: string; error?: string }> {
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(input.guildId)}/events/${encodeURIComponent(input.eventId)}/signups`,
    {
      body: {
        character: input.character,
        role: input.role,
        spec: input.spec,
        status: input.status,
        userId: input.userId,
        username: input.username,
        wowClass: input.wowClass,
      },
      method: "PUT",
    },
  );
  if (!response.ok) {
    return { error: getErrorMessage(response.data), ok: false };
  }
  const payload = response.data as {
    signup?: { character?: string | null };
  };
  return { character: payload.signup?.character ?? undefined, ok: true };
}

async function removeSignup(input: {
  guildId: string;
  eventId: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(input.guildId)}/events/${encodeURIComponent(input.eventId)}/signups`,
    {
      body: { userId: input.userId },
      method: "DELETE",
    },
  );
  if (!response.ok) {
    return { error: getErrorMessage(response.data), ok: false };
  }
  return { ok: true };
}

async function resetSignup(input: {
  guildId: string;
  eventId: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(input.guildId)}/events/${encodeURIComponent(input.eventId)}/signups/reset`,
    {
      body: { userId: input.userId },
      method: "DELETE",
    },
  );
  if (!response.ok) {
    return { error: getErrorMessage(response.data), ok: false };
  }
  return { ok: true };
}

// ── Personaje del jugador (modal) ───────────────────────────────────
// Botón "Personaje" del embed: abre un modal para poner/editar el nombre
// del personaje con el que el usuario está anotado (igual que en la web).

// Modal del personaje. `required` lo hace obligatorio: se usa cuando la
// inscripción está esperando el nombre para poder guardarse.
async function openCharacterModal(
  interaction: EventInteraction,
  eventId: string,
  options: { required?: boolean; value?: string } = {},
): Promise<void> {
  const input = new TextInputBuilder()
    .setCustomId("character")
    .setLabel("Nombre de personaje")
    .setStyle(TextInputStyle.Short)
    // Obligatorio cuando la inscripción lo está esperando (o cuando el jugador
    // todavía no tiene ninguno y el evento pide personaje); si ya tiene uno,
    // puede editarlo o vaciarlo para olvidarlo.
    .setRequired(options.required === true)
    .setMaxLength(40)
    .setPlaceholder("Ej: Ruidia");
  if (options.value) {
    input.setValue(options.value);
  }
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  const modal = new ModalBuilder()
    .setCustomId(`eventsign:${eventId}:characterset`)
    .setTitle("Tu personaje en este evento")
    .addComponents(row);
  try {
    await interaction.showModal(modal);
  } catch {
    // Sin respuesta posible.
  }
}

// Recibe el envío del modal y guarda/limpia el personaje del usuario.
export async function handleEventSignupCharacterSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed?.eventId || parsed.action !== "characterset") {
    return;
  }
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "Este evento solo funciona dentro del servidor.",
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const member = interaction.member as { displayName?: string } | null;
  const username = member?.displayName?.trim() || interaction.user.username;
  const character = interaction.fields.getTextInputValue("character").trim();

  const event = await fetchEvent(guildId, parsed.eventId);
  if (!event) {
    await interaction.reply({
      content: "No encontré ese evento.",
      ephemeral: true,
    });
    return;
  }

  // Si la inscripción estaba esperando el personaje, la completamos ahora: es
  // el paso obligatorio del flujo (nada se guardó hasta acá).
  const pending = pendingSignups.get(pendingKey(userId, parsed.eventId));
  if (pending) {
    pendingSignups.delete(pendingKey(userId, parsed.eventId));
    const saved = await putSignup({
      character,
      eventId: parsed.eventId,
      guildId,
      role: pending.role,
      spec: pending.specName,
      status: pending.status,
      userId,
      username,
      wowClass: pending.className,
    });
    if (!saved.ok) {
      await interaction.reply({
        content: `No se pudo guardar la inscripción: ${saved.error}`,
        ephemeral: true,
      });
      return;
    }
    const detail = [pending.className, pending.specName]
      .filter(Boolean)
      .join(" — ");
    await interaction.reply({
      content: [
        `Registrado: **${STATUS_TITLE[pending.status] ?? "Asistir"}**${detail ? ` · **${detail}**` : ""} · **${character}**. ✅`,
      ].join("\n"),
      ephemeral: true,
    });
    return;
  }

  const mine = event.signups?.find((signup) => signup.userId === userId);
  if (!mine) {
    await interaction.reply({
      content:
        "Primero hay que anotarse con los botones del evento (✅ / 🪑 / ⏰ / ❌).",
      ephemeral: true,
    });
    return;
  }

  const result = await putSignup({
    // Se manda el valor tal cual (aunque sea vacío): el API lo interpreta como
    // "olvidar el personaje recordado" y si no se mandara, lo heredaría.
    character,
    guildId,
    eventId: parsed.eventId,
    role: mine.role,
    spec: mine.spec,
    status: mine.status,
    userId,
    username,
    wowClass: mine.wowClass,
  });
  if (!result.ok) {
    await interaction.reply({
      content: `No se pudo actualizar el personaje: ${result.error}`,
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({
    content: character
      ? `Personaje guardado: **${character}**. ✅`
      : "Personaje quitado. ✅",
    ephemeral: true,
  });
}

// Emoji de una fila del catálogo (custom con id, o nada).
function specEmoji(
  spec: RemoteSpec,
): { animated: boolean; id: string; name: string } | undefined {
  if (!spec.emojiId) {
    return undefined;
  }
  return {
    animated: spec.animated,
    id: spec.emojiId,
    name: spec.emojiName ?? "emoji",
  };
}

// Select del segundo paso. Con el segundo eje desactivado (p. ej. LoL con
// solo "Rango"), listamos directamente las clases.
function specSelectRow(
  context: SignupContext,
  eventId: string,
  role: string,
  status: string,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const roleSpecs = context.specs
    .filter((spec) => spec.role === role)
    .slice(0, 25);
  if (roleSpecs.length === 0) {
    return null;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`eventsign:${eventId}:spec:${role}:${status}`)
    .setPlaceholder(`Elegir una ${context.specLabel.toLowerCase()}`);

  for (const spec of roleSpecs) {
    select.addOptions({
      description: spec.className,
      emoji: specEmoji(spec),
      label: spec.specName.slice(0, 100),
      value: `${spec.className}|${spec.specName}`,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

// Arranca el asistente efímero: primero rol, después (si corresponde) el
// segundo eje.
async function startRoleWizard(
  interaction: EventInteraction,
  guildId: string,
  eventId: string,
  status: string,
): Promise<void> {
  const event = await fetchEvent(guildId, eventId);
  if (!event) {
    await replyOnce(interaction, "No encontré ese evento.");
    return;
  }
  if (event.status !== "scheduled") {
    await replyOnce(interaction, "Este evento ya no acepta inscripciones.");
    return;
  }
  const context = await fetchSignupContext(guildId, event.game);

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const role of context.roles) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`eventsign:${eventId}:pickrole:${role.key}:${status}`)
        .setEmoji(roleEmojiComponent(role))
        .setLabel(role.label.slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  const content = `Rol para **${STATUS_TITLE[status] ?? "Asistir"}**:`;
  try {
    await interaction.reply({ components: [row], content, ephemeral: true });
  } catch {
    try {
      await interaction.update({ components: [row], content });
    } catch {
      // Nada más que hacer.
    }
  }
}

// Aplica una acción directa de estado (quick) o dispara el asistente si el
// usuario todavía no tiene clase/spec elegida.
async function handleQuickStatus(
  interaction: EventInteraction,
  guildId: string,
  eventId: string,
  status: string,
): Promise<void> {
  const userId = interaction.user.id;
  const username = fetchMemberName(interaction);
  const event = await fetchEvent(guildId, eventId, userId);
  if (!event) {
    await replyOnce(interaction, "No encontré ese evento.");
    return;
  }
  if (event.status !== "scheduled") {
    await replyOnce(interaction, "Este evento ya no acepta inscripciones.");
    return;
  }

  const mine = event.signups?.find((signup) => signup.userId === userId);
  const needsWizard =
    status === "yes" || status === "bench" || status === "late";

  if (needsWizard && !mine?.wowClass) {
    await startRoleWizard(interaction, guildId, eventId, status);
    return;
  }

  // El evento pide personaje y el jugador no tiene ninguno: no guardamos nada
  // todavía; se lo pedimos con el modal (obligatorio) y la inscripción se
  // completa cuando lo envía. Solo para los estados que van al roster: quien
  // marca "no asisto" no necesita personaje.
  if (needsWizard && needsCharacter(event, userId)) {
    pendingSignups.set(pendingKey(userId, eventId), {
      className: mine?.wowClass,
      role: mine?.role,
      specName: mine?.spec,
      status,
    });
    await openCharacterModal(interaction, eventId, { required: true });
    return;
  }

  const result = await putSignup({
    character: mine?.character,
    guildId,
    eventId,
    role: mine?.role,
    spec: mine?.spec,
    status,
    userId,
    username,
    wowClass: mine?.wowClass,
  });
  if (!result.ok) {
    await replyOnce(
      interaction,
      `No se pudo actualizar la inscripción: ${result.error}`,
    );
    return;
  }
  await replyOnce(
    interaction,
    `Registrado: **${STATUS_TITLE[status] ?? "Asistir"}**. ✅`,
  );
}

export async function handleEventSignupInteraction(
  interaction: EventInteraction,
): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed?.eventId) {
    return;
  }
  const { action, eventId, rest } = parsed;
  if (!interaction.inGuild() || !interaction.guildId) {
    await replyOnce(
      interaction,
      "Este evento solo funciona dentro del servidor.",
    );
    return;
  }
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = fetchMemberName(interaction);

  if (action === "pickrole") {
    const roleKey = rest[0];
    const status = rest[1] ?? "yes";
    const event = await fetchEvent(guildId, eventId);
    const context = await fetchSignupContext(guildId, event?.game);
    const role =
      context.roles.find((entry) => entry.key === roleKey) ??
      DEFAULT_ROLES.find((entry) => entry.key === roleKey);
    if (!roleKey || !role) {
      await replyOnce(interaction, "Rol inválido.");
      return;
    }
    const selectRow = specSelectRow(context, eventId, roleKey, status);
    if (!selectRow) {
      await updateWizard(
        interaction,
        "No hay clases cargadas para ese rol en el catálogo.",
        [],
      );
      return;
    }
    await updateWizard(
      interaction,
      `Rol elegido: **${role.label}**. Ahora elegir ${context.specLabel.toLowerCase()}:`,
      [selectRow],
    );
    return;
  }

  if (action === "spec") {
    if (!interaction.isStringSelectMenu()) {
      return;
    }
    const role = rest[0];
    const status = rest[1] ?? "yes";
    const value = interaction.values[0] ?? "";
    const separator = value.indexOf("|");
    if (!role || separator === -1) {
      await updateWizard(interaction, "Opción inválida.", []);
      return;
    }
    const className = value.slice(0, separator);
    const specName = value.slice(separator + 1);
    const event = await fetchEvent(guildId, eventId, userId);
    // El catálogo del juego del evento es el que valida la spec que eligió.
    const context = await fetchSignupContext(guildId, event?.game);

    const mine = event?.signups?.find((signup) => signup.userId === userId);

    // El evento pide personaje y el jugador no tiene ninguno (ni recordado):
    // NO guardamos todavía. Se lo pedimos con el modal (obligatorio) y la
    // inscripción se completa cuando lo envía.
    if (needsCharacter(event, userId)) {
      pendingSignups.set(pendingKey(userId, eventId), {
        className,
        role,
        specName: specName || undefined,
        status,
      });
      await openCharacterModal(interaction, eventId, { required: true });
      return;
    }

    const result = await putSignup({
      character: mine?.character,
      guildId,
      eventId,
      role,
      spec: specName || undefined,
      status,
      userId,
      username,
      wowClass: className,
    });
    if (!result.ok) {
      await updateWizard(
        interaction,
        `No se pudo guardar la inscripción: ${result.error}`,
        [],
      );
      return;
    }
    const detail = specName ? `${className} — ${specName}` : className;
    await updateWizard(
      interaction,
      `Registrado: **${STATUS_TITLE[status] ?? "Asistir"}** · **${detail}**. ✅`,
      [],
    );
    return;
  }

  if (action === "character") {
    if (!interaction.isButton()) {
      return;
    }
    const event = await fetchEvent(guildId, eventId, userId);
    const mine = event?.signups?.find((signup) => signup.userId === userId);
    await openCharacterModal(interaction, eventId, {
      // Si el evento pide personaje, el campo es obligatorio (para olvidarlo
      // está el botón "Resetear registro").
      required: event?.characterEnabled !== false,
      value: mine?.character ?? event?.playerCharacter ?? undefined,
    });
    return;
  }

  if (action === "reset") {
    const result = await resetSignup({ guildId, eventId, userId });
    if (!result.ok) {
      await replyOnce(
        interaction,
        `No se pudo resetear el registro: ${result.error}`,
      );
      return;
    }
    await replyOnce(
      interaction,
      "Registro reseteado: se borró tu inscripción y el personaje. ✅",
    );
    return;
  }

  if (action === "remove") {
    const result = await removeSignup({ guildId, eventId, userId });
    if (!result.ok) {
      await replyOnce(
        interaction,
        `No se pudo quitar tu inscripción: ${result.error}`,
      );
      return;
    }
    await replyOnce(interaction, "Quité tu inscripción. ✅");
    return;
  }

  // "pick" (elegir/cambiar clase y spec) o un estado directo.
  if (action === "pick") {
    await startRoleWizard(interaction, guildId, eventId, "yes");
    return;
  }

  if (
    action === "yes" ||
    action === "bench" ||
    action === "late" ||
    action === "no"
  ) {
    await handleQuickStatus(interaction, guildId, eventId, action);
    return;
  }

  await replyOnce(interaction, "Acción desconocida.");
}
