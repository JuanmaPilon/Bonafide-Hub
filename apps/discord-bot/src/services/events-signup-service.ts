import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type {
  ButtonInteraction,
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

const ROLE_META: Record<string, { emoji: string; label: string }> = {
  tank: { emoji: "🛡️", label: "Tank" },
  healer: { emoji: "💚", label: "Healer" },
  melee: { emoji: "⚔️", label: "Melee" },
  ranged: { emoji: "🏹", label: "Ranged" },
};

const STATUS_LABEL: Record<string, string> = {
  bench: "anotarte de bench",
  late: "avisar que llegás tarde",
  no: "marcar que no asistís",
  tentative: "quedar como quizás",
  yes: "anotarte como asistente",
};

type RemoteSpec = {
  animated: boolean;
  className: string;
  emojiId?: string;
  emojiName?: string;
  role: string;
  specName: string;
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

async function fetchEvent(
  guildId: string,
  eventId: string,
): Promise<RemoteEvent["event"] | null> {
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(guildId)}/events/${encodeURIComponent(eventId)}`,
  );
  if (!response.ok) {
    return null;
  }
  const payload = response.data as { event?: RemoteEvent["event"] };
  return payload.event ?? null;
}

async function fetchSpecs(
  guildId: string,
): Promise<RemoteSpec[]> {
  const response = await remoteRequest(
    `/internal/guilds/${encodeURIComponent(guildId)}/events/specs`,
  );
  if (!response.ok) {
    return [];
  }
  const payload = response.data as { specs?: RemoteSpec[] };
  return payload.specs ?? [];
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
}): Promise<{ ok: boolean; error?: string }> {
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
  return { ok: true };
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

function roleSelectRow(
  guildId: string,
  eventId: string,
  role: string,
  status: string,
  specs: RemoteSpec[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const roleSpecs = specs.filter((spec) => spec.role === role).slice(0, 25);
  if (roleSpecs.length === 0) {
    return null;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`eventsign:${eventId}:spec:${role}:${status}`)
    .setPlaceholder(`Elegí tu spec (${ROLE_META[role]?.label ?? role})`);
  for (const spec of roleSpecs) {
    select.addOptions({
      description: spec.className,
      emoji: spec.emojiId
        ? {
            animated: spec.animated,
            id: spec.emojiId,
            name: spec.emojiName ?? "emoji",
          }
        : undefined,
      label: spec.specName.slice(0, 100),
      value: `${spec.className}|${spec.specName}`,
    });
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

// Arranca el asistente efímero: primero rol, después spec.
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

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const [role, meta] of Object.entries(ROLE_META)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`eventsign:${eventId}:pickrole:${role}:${status}`)
        .setEmoji(meta.emoji)
        .setLabel(meta.label)
        .setStyle(ButtonStyle.Secondary),
    );
  }
  const content = `Elegí tu rol para **${STATUS_LABEL[status] ?? "asistir"}**:`;
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
  const event = await fetchEvent(guildId, eventId);
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
      `No se pudo actualizar tu inscripción: ${result.error}`,
    );
    return;
  }
  await replyOnce(interaction, `Listo: te ${STATUS_LABEL[status] ?? "anotaste"}. ✅`);
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
    await replyOnce(interaction, "Este evento solo funciona dentro del servidor.");
    return;
  }
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = fetchMemberName(interaction);

  if (action === "pickrole") {
    const role = rest[0];
    const status = rest[1] ?? "yes";
    if (!role || !ROLE_META[role]) {
      await replyOnce(interaction, "Rol inválido.");
      return;
    }
    const specs = await fetchSpecs(guildId);
    const selectRow = roleSelectRow(guildId, eventId, role, status, specs);
    if (!selectRow) {
      await updateWizard(
        interaction,
        "No hay specs cargadas para ese rol en el catálogo.",
        [],
      );
      return;
    }
    await updateWizard(
      interaction,
      `Elegiste **${ROLE_META[role].emoji} ${ROLE_META[role].label}**. Ahora elegí tu spec:`,
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

    const event = await fetchEvent(guildId, eventId);
    const mine = event?.signups?.find((signup) => signup.userId === userId);
    const result = await putSignup({
      character: mine?.character,
      guildId,
      eventId,
      role,
      spec: specName,
      status,
      userId,
      username,
      wowClass: className,
    });
    if (!result.ok) {
      await updateWizard(
        interaction,
        `No se pudo inscribirte: ${result.error}`,
        [],
      );
      return;
    }
    const meta = ROLE_META[role];
    await updateWizard(
      interaction,
      `Te ${STATUS_LABEL[status] ?? "anotaste"} como **${meta?.emoji ?? ""} ${className} — ${specName}**. ✅`,
      [],
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
    action === "tentative" ||
    action === "no"
  ) {
    await handleQuickStatus(interaction, guildId, eventId, action);
    return;
  }

  await replyOnce(interaction, "Acción desconocida.");
}
