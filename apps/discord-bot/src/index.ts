import {
  AuditLogEvent,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import { commandHandlers } from "./commands.js";
import { env } from "./config/env.js";
import {
  cancelReminder,
  createReminder,
  listDueReminders,
  listGuildReminders,
  markReminderSent,
  type Reminder,
  removeUserReminders,
  rescheduleReminder,
  type ReminderKind,
  resolveReminderKind,
} from "./services/reminders-store.js";
import {
  addTemporaryVoiceChannelId,
  findReactionRoleRule,
  getGuildConfig,
  isTemporaryVoiceChannel,
  listReactionRoleRules,
  type ReactionRoleMode,
  removeReactionRoleRule,
  removeTemporaryVoiceChannelId,
  updateReactionRoleModeForMessage,
  upsertReactionRoleRule,
} from "./services/guild-config-store.js";
import {
  getCommunicationContent,
  listCommunicationFiles,
  splitForDiscord,
} from "./services/communications-store.js";
import {
  addRemoteXp,
  computeXpMultiplier,
  fetchRemoteXpConfig,
  getErrorMessage,
  isRemoteStoreEnabled,
  type XpConfig,
  type XpRoleRule,
} from "./services/xp-service.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const xpCooldowns = new Map<string, number>();

function normalizeEmojiKey(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const customEmojiMatch = trimmed.match(/^<a?:\w+:(\d+)>$/);
  if (customEmojiMatch) {
    return `custom:${customEmojiMatch[1]}`;
  }

  if (/^\d+$/.test(trimmed)) {
    return `custom:${trimmed}`;
  }

  return `unicode:${trimmed}`;
}

function reactionEmojiKey(reaction: {
  emoji: { id: string | null; name: string | null };
}): string | null {
  if (reaction.emoji.id) {
    return `custom:${reaction.emoji.id}`;
  }

  if (reaction.emoji.name) {
    return `unicode:${reaction.emoji.name}`;
  }

  return null;
}

async function sendMemberLog(
  guildId: string,
  fallbackChannelId: string | null,
  message: string,
): Promise<void> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.warn("[discord-bot] Could not fetch guild for member log");
    return;
  }

  const guildConfig = await getGuildConfig(guildId);
  const configuredChannelId = guildConfig.memberLogChannelId;
  const candidateChannelIds = [configuredChannelId, fallbackChannelId].filter(
    (channelId): channelId is string => Boolean(channelId),
  );

  if (candidateChannelIds.length === 0) {
    console.log(`[discord-bot] ${message}`);
    return;
  }

  for (const channelId of candidateChannelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      continue;
    }

    const sent = await channel
      .send(message)
      .then(() => true)
      .catch((error: unknown) => {
        console.error("[discord-bot] Failed to send member log message", {
          guildId,
          channelId,
          error,
        });
        return false;
      });

    if (sent) {
      return;
    }
  }

  console.warn(
    "[discord-bot] No available channel to send member log. Falling back to console.",
  );
  console.log(`[discord-bot] ${message}`);
}

async function sendChunksToTextChannel(
  channel: { send: (content: string) => Promise<unknown>; id: string },
  chunks: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const chunk of chunks) {
    try {
      await channel.send(chunk);
    } catch (error: unknown) {
      const maybeDiscordError = error as {
        code?: number;
        status?: number;
        message?: string;
      };

      if (
        maybeDiscordError.status === 403 ||
        maybeDiscordError.code === 50013 ||
        maybeDiscordError.code === 50001
      ) {
        return {
          ok: false,
          reason:
            "El bot no tiene permisos para publicar en ese canal (View Channel / Send Messages).",
        };
      }

      return {
        ok: false,
        reason: `Error al publicar en canal ${channel.id}: ${maybeDiscordError.message ?? "desconocido"}`,
      };
    }
  }

  return { ok: true };
}

type MemberLeaveDetails = {
  kind: "leave" | "kick" | "ban";
  moderatorId?: string;
  reason?: string;
};

function formatLeaveMessage(
  username: string,
  memberId: string,
  details: MemberLeaveDetails,
): string {
  if (details.kind === "leave") {
    return `🚪 **Salida**\n${username} se retiro del servidor.`;
  }

  const actionText = details.kind === "kick" ? "expulsado" : "baneado";
  const actionTitle = details.kind === "kick" ? "Expulsion" : "Ban";
  const actionEmoji = details.kind === "kick" ? "⛔" : "🔨";
  const moderatorText = details.moderatorId
    ? `<@${details.moderatorId}>`
    : "desconocido";
  const reasonText = details.reason?.trim() || "sin razon informada";

  return `${actionEmoji} **${actionTitle}**\nUsuario: <@${memberId}> (${username})\nEstado: ${actionText}\nModerador: ${moderatorText}\nRazon: ${reasonText}.`;
}

async function resolveMemberLeaveDetails(
  member: unknown,
): Promise<MemberLeaveDetails> {
  const typedMember = member as {
    id: string;
    guild: {
      fetchAuditLogs: (options: unknown) => Promise<{
        entries: {
          find: (
            predicate: (entry: {
              target?: { id?: string } | null;
              createdTimestamp: number;
              executor?: { id: string } | null;
              reason?: string | null;
            }) => boolean,
          ) =>
            | {
                executor?: { id: string } | null;
                reason?: string | null;
              }
            | undefined;
        };
      }>;
    };
  };

  const now = Date.now();
  const maxAgeMs = 15_000;

  const findRelevantEntry = (entries: {
    find: (
      predicate: (entry: {
        target?: { id?: string } | null;
        createdTimestamp: number;
      }) => boolean,
    ) =>
      | { executor?: { id: string } | null; reason?: string | null }
      | undefined;
  }) =>
    entries.find((entry) => {
      const targetId = entry.target?.id;
      if (targetId !== typedMember.id) {
        return false;
      }

      return Math.abs(now - entry.createdTimestamp) <= maxAgeMs;
    });

  const [kickLogs, banLogs] = await Promise.all([
    typedMember.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 })
      .catch(() => null),
    typedMember.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 })
      .catch(() => null),
  ]);

  const kickEntry = kickLogs ? findRelevantEntry(kickLogs.entries) : undefined;
  if (kickEntry) {
    return {
      kind: "kick",
      moderatorId: kickEntry.executor?.id,
      reason: kickEntry.reason ?? undefined,
    };
  }

  const banEntry = banLogs ? findRelevantEntry(banLogs.entries) : undefined;
  if (banEntry) {
    return {
      kind: "ban",
      moderatorId: banEntry.executor?.id,
      reason: banEntry.reason ?? undefined,
    };
  }

  return { kind: "leave" };
}

function buildTemporaryVoiceChannelName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "Sala temporal";
  }

  return `Sala de ${trimmed.slice(0, 80)}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasDeleteMethod(
  value: unknown,
): value is { delete: (reason?: string) => Promise<unknown> } {
  return isObjectRecord(value) && typeof value.delete === "function";
}

function hasRawPosition(value: unknown): value is { rawPosition: number } {
  return isObjectRecord(value) && typeof value.rawPosition === "number";
}

function hasSetPosition(value: unknown): value is {
  setPosition: (position: number) => Promise<unknown>;
} {
  return isObjectRecord(value) && typeof value.setPosition === "function";
}

function isVoiceBasedChannelLike(
  value: unknown,
): value is { isVoiceBased: () => boolean; members: { size: number } } {
  return (
    isObjectRecord(value) &&
    typeof value.isVoiceBased === "function" &&
    isObjectRecord(value.members) &&
    typeof value.members.size === "number"
  );
}

function countConnectedMembersInChannel(
  voiceStates: {
    cache?: {
      filter: (
        predicate: (state: { channelId?: string | null }) => boolean,
      ) => { size: number };
    };
  } | null,
  channelId: string,
): number | null {
  if (!voiceStates?.cache) {
    return null;
  }

  return voiceStates.cache.filter((state) => state.channelId === channelId)
    .size;
}

function isReactionRoleTextChannelLike(value: unknown): value is {
  id: string;
  messages: { fetch: (messageId: string) => Promise<unknown> };
} {
  return (
    isObjectRecord(value) &&
    typeof value.id === "string" &&
    isObjectRecord(value.messages) &&
    typeof value.messages.fetch === "function"
  );
}

function isSendableTextChannelLike(value: unknown): value is {
  id: string;
  send: (content: string) => Promise<unknown>;
} {
  return (
    isObjectRecord(value) &&
    typeof value.id === "string" &&
    typeof value.send === "function"
  );
}

function isReactableMessageLike(value: unknown): value is {
  id: string;
  react: (emoji: string) => Promise<unknown>;
} {
  return (
    isObjectRecord(value) &&
    typeof value.id === "string" &&
    typeof value.react === "function"
  );
}

function parseEmojiForReaction(input: string): string {
  const trimmed = input.trim();
  const customEmojiMatch = trimmed.match(/^<a?:\w+:(\d+)>$/);

  if (customEmojiMatch) {
    return customEmojiMatch[1];
  }

  return trimmed;
}

function parseReactionRoleMode(input: string | null): ReactionRoleMode {
  if (input === "unique" || input === "additive") {
    return input;
  }

  return "multiple";
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const KD_REMINDER_TEMPLATES = [
  "🫖 Senior, puede tirar KD cuando guste.",
  "🫖 Senior, su KD ya esta servido.",
  "🫖 Senior, Karpindomo le recuerda que KD esta listo.",
  "🫖 Senior, Karpindomo confirma que su KD ya esta disponible.",
  "🫖 Senior, momento ideal para tirar KD.",
  "🫖 Senior, Karpindomo sugiere activar KD en este preciso instante.",
  "🫖 Senior, su ventana de KD esta abierta.",
] as const;

const KDAILY_REMINDER_TEMPLATES = [
  "🫖 Senior, su KDaily ya esta listo.",
  "🫖 Senior, Karpindomo le recuerda que puede hacer KDaily.",
  "🫖 Senior, llego la hora de su KDaily.",
  "🫖 Senior, Karpindomo anuncia que su KDaily quedo habilitado.",
  "🫖 Senior, su KDaily aguarda por usted.",
  "🫖 Senior, Karpindomo confirma que ya puede cobrar su KDaily.",
  "🫖 Senior, su KDaily quedo en punto para ejecutarse.",
] as const;

const CUSTOM_REMINDER_TEMPLATES = [
  "🫖 Senior, su recordatorio de {duration} ha llegado.",
  "🫖 Senior, Karpindomo anuncia que vencio su recordatorio de {duration}.",
  "🫖 Senior, es momento de atender su recordatorio de {duration}.",
  "🫖 Senior, Karpindomo le avisa que se cumplio el plazo de {duration}.",
  "🫖 Senior, su aviso configurado para {duration} esta listo.",
  "🫖 Senior, Karpindomo notifica que el temporizador de {duration} finalizo.",
  "🫖 Senior, su cita con el recordatorio de {duration} ha llegado.",
] as const;

const WELCOME_TEMPLATES = [
  "🫖 **Karpindomo se presenta, Senior.**\nBienvenido <@{memberId}> a la comunidad.\nLa casa queda a su disposicion.",
  "🎩 **Karpindomo, mayordomo capincho, al servicio.**\nUn placer recibir a <@{memberId}> en el servidor.\nQue tenga una estancia impecable.",
  "🛎️ **Atencion, atencion:** Karpindomo confirma llegada de <@{memberId}>.\nBienvenido a esta distinguida comunidad.",
  "🍵 **Recepcion oficial de Karpindomo.**\n<@{memberId}> ya esta en casa.\nPongase comodo y disfrute la estadia.",
] as const;

function formatReminderDuration(minutesFromCreation: number): string {
  if (minutesFromCreation % 60 === 0) {
    const hours = minutesFromCreation / 60;
    return `${hours} hora${hours === 1 ? "" : "s"}`;
  }

  return `${minutesFromCreation} minuto${minutesFromCreation === 1 ? "" : "s"}`;
}

function pickRandomTemplateAvoidingLast<T extends string>(
  templates: readonly T[],
  lastIndex?: number,
): { template: T; index: number } {
  if (templates.length === 1) {
    return { template: templates[0], index: 0 };
  }

  const normalizedLastIndex =
    typeof lastIndex === "number" && lastIndex >= 0
      ? lastIndex % templates.length
      : undefined;

  let nextIndex = Math.floor(Math.random() * templates.length);
  if (normalizedLastIndex !== undefined && nextIndex === normalizedLastIndex) {
    nextIndex =
      (nextIndex + 1 + Math.floor(Math.random() * (templates.length - 1))) %
      templates.length;
  }

  return {
    template: templates[nextIndex],
    index: nextIndex,
  };
}

function buildDmReminderMessage(reminder: Reminder): {
  content: string;
  rotationIndex: number;
} {
  const kind = resolveReminderKind(reminder);
  const lastIndex = reminder.rotationIndex;

  if (kind === "kd") {
    const next = pickRandomTemplateAvoidingLast(
      KD_REMINDER_TEMPLATES,
      lastIndex,
    );
    return { content: next.template, rotationIndex: next.index };
  }

  if (kind === "kdaily") {
    const next = pickRandomTemplateAvoidingLast(
      KDAILY_REMINDER_TEMPLATES,
      lastIndex,
    );
    return {
      content: `${next.template}\nhttps://karuta.com/vote`,
      rotationIndex: next.index,
    };
  }

  const durationText = formatReminderDuration(reminder.minutesFromCreation);
  const next = pickRandomTemplateAvoidingLast(
    CUSTOM_REMINDER_TEMPLATES,
    lastIndex,
  );
  return {
    content: next.template.replace("{duration}", durationText),
    rotationIndex: next.index,
  };
}

function buildWelcomeMessage(memberId: string): string {
  return pickRandom(WELCOME_TEMPLATES).replace("{memberId}", memberId);
}

const REMINDER_POLL_INTERVAL_MS = 30_000;
let reminderPollTimer: NodeJS.Timeout | null = null;
let isProcessingReminderQueue = false;

async function processDueReminders(): Promise<void> {
  if (isProcessingReminderQueue) {
    return;
  }

  isProcessingReminderQueue = true;
  try {
    const dueReminders = await listDueReminders(new Date().toISOString());

    for (const reminder of dueReminders) {
      if (reminder.deliveryType === "dm") {
        const user = await client.users
          .fetch(reminder.createdByUserId)
          .catch(() => null);
        if (!user) {
          continue;
        }

        const reminderMessage = buildDmReminderMessage(reminder);
        const delivered = await user
          .send(reminderMessage.content)
          .then(() => true)
          .catch((error: unknown) => {
            console.error("[discord-bot] Failed to deliver inbox reminder", {
              guildId: reminder.guildId,
              userId: reminder.createdByUserId,
              reminderId: reminder.id,
              error,
            });
            return false;
          });

        if (!delivered) {
          continue;
        }

        if (reminder.repeat) {
          await rescheduleReminder({
            guildId: reminder.guildId,
            reminderId: reminder.id,
            rotationIndex: reminderMessage.rotationIndex,
          });
        } else {
          await markReminderSent(reminder.guildId, reminder.id);
        }
        continue;
      }

      const guild = await client.guilds
        .fetch(reminder.guildId)
        .catch(() => null);
      if (!guild) {
        continue;
      }

      const channel = await guild.channels
        .fetch(reminder.channelId)
        .catch(() => null);
      if (!isSendableTextChannelLike(channel)) {
        continue;
      }

      const roleMention = reminder.roleId ? `<@&${reminder.roleId}> ` : "";
      const content = `${roleMention}⏰ Recordatorio: ${reminder.message}`;

      const delivered = await channel
        .send(content)
        .then(() => true)
        .catch((error: unknown) => {
          console.error("[discord-bot] Failed to deliver reminder", {
            guildId: reminder.guildId,
            channelId: reminder.channelId,
            reminderId: reminder.id,
            error,
          });
          return false;
        });

      if (!delivered) {
        continue;
      }

      if (reminder.repeat) {
        await rescheduleReminder({
          guildId: reminder.guildId,
          reminderId: reminder.id,
        });
      } else {
        await markReminderSent(reminder.guildId, reminder.id);
      }
    }
  } finally {
    isProcessingReminderQueue = false;
  }
}

function startReminderScheduler(): void {
  if (reminderPollTimer) {
    return;
  }

  reminderPollTimer = setInterval(() => {
    void processDueReminders();
  }, REMINDER_POLL_INTERVAL_MS);

  void processDueReminders();
}

async function createDynamicVoiceChannelForMember(newState: {
  guild: {
    id: string;
    afkChannelId?: string | null;
    channels: {
      create: (options: {
        name: string;
        type: ChannelType.GuildVoice;
        parent?: string | null;
        position?: number;
        reason: string;
      }) => Promise<{
        id: string;
        setPosition?: (position: number) => Promise<unknown>;
      }>;
      fetch: (channelId: string) => Promise<unknown>;
    };
  };
  channelId: string | null;
  channel: { parentId?: string | null; isVoiceBased: () => boolean } | null;
  member?: { displayName: string; id: string } | null;
  setChannel: (channelId: string) => Promise<unknown>;
}): Promise<void> {
  if (!newState.channelId || !newState.member) {
    return;
  }

  const guildConfig = await getGuildConfig(newState.guild.id);
  const creatorChannelId = guildConfig.dynamicVoiceCreateChannelId;
  if (!creatorChannelId || newState.channelId !== creatorChannelId) {
    return;
  }

  const creatorChannel = newState.channel;
  if (!creatorChannel || !creatorChannel.isVoiceBased()) {
    return;
  }

  let targetPosition = 0;
  if (newState.guild.afkChannelId) {
    const afkChannel = await newState.guild.channels
      .fetch(newState.guild.afkChannelId)
      .catch(() => null);
    if (hasRawPosition(afkChannel)) {
      targetPosition = Math.max(afkChannel.rawPosition - 1, 0);
    }
  }

  const createdChannel = await newState.guild.channels.create({
    name: buildTemporaryVoiceChannelName(newState.member.displayName),
    type: ChannelType.GuildVoice,
    parent: creatorChannel.parentId ?? null,
    position: targetPosition,
    reason: `Dynamic voice room for ${newState.member.id}`,
  });

  if (hasSetPosition(createdChannel)) {
    await createdChannel.setPosition(targetPosition).catch(() => undefined);
  }

  await addTemporaryVoiceChannelId(newState.guild.id, createdChannel.id);

  const moved = await newState
    .setChannel(createdChannel.id)
    .then(() => true)
    .catch(() => false);

  if (moved) {
    return;
  }

  const channelToDelete = await newState.guild.channels
    .fetch(createdChannel.id)
    .catch(() => null);

  if (hasDeleteMethod(channelToDelete)) {
    await channelToDelete.delete();
  }

  await removeTemporaryVoiceChannelId(newState.guild.id, createdChannel.id);
}

async function maybeDeleteTemporaryVoiceChannel(channelState: {
  guild: {
    id: string;
    channels: { fetch: (channelId: string) => Promise<unknown> };
    voiceStates?: {
      cache: {
        filter: (
          predicate: (state: { channelId?: string | null }) => boolean,
        ) => { size: number };
      };
    };
  };
  channelId: string | null;
}): Promise<void> {
  const channelId = channelState.channelId;
  if (!channelId) {
    return;
  }

  const isTemporary = await isTemporaryVoiceChannel(
    channelState.guild.id,
    channelId,
  );
  if (!isTemporary) {
    return;
  }

  const channel = await channelState.guild.channels
    .fetch(channelId)
    .catch(() => null);
  if (!channel) {
    await removeTemporaryVoiceChannelId(channelState.guild.id, channelId);
    return;
  }

  if (!isVoiceBasedChannelLike(channel) || !channel.isVoiceBased()) {
    await removeTemporaryVoiceChannelId(channelState.guild.id, channelId);
    return;
  }

  const connectedMemberCount = countConnectedMembersInChannel(
    channelState.guild.voiceStates ?? null,
    channelId,
  );
  const memberCount = connectedMemberCount ?? channel.members.size;

  if (memberCount > 0) {
    return;
  }

  if (hasDeleteMethod(channel)) {
    await channel.delete("Dynamic voice channel empty");
  }

  await removeTemporaryVoiceChannelId(channelState.guild.id, channelId);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] Online as ${readyClient.user.tag}`);
  startReminderScheduler();
  startVoiceXpTracker();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== "publicarcomunicado") {
      return;
    }

    const focusedValue = interaction.options.getFocused(true);
    if (focusedValue.name !== "archivo") {
      await interaction.respond([]);
      return;
    }

    const files = await listCommunicationFiles(
      String(focusedValue.value),
    ).catch(() => []);

    await interaction.respond(
      files.map((file) => ({
        name: file.length > 100 ? `${file.slice(0, 97)}...` : file,
        value: file,
      })),
    );
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "memberstats") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const members = await interaction.guild.members.fetch().catch(() => null);
    if (!members) {
      await interaction.reply({
        content: "No pude obtener los miembros del servidor.",
        ephemeral: true,
      });
      return;
    }

    const total = members.size;
    const isPublic = interaction.options.getBoolean("publico") ?? false;
    let connected = 0;
    let offline = 0;

    for (const member of members.values()) {
      const status = member.presence?.status ?? "offline";
      if (status === "offline" || status === "invisible") {
        offline += 1;
      } else {
        connected += 1;
      }
    }

    await interaction.reply({
      content: [
        "Estadisticas de miembros:",
        `Total: ${total}`,
        `Conectados (online/idle/dnd): ${connected}`,
        `Offline/invisible: ${offline}`,
      ].join("\n"),
      ephemeral: !isPublic,
    });
    return;
  }

  if (interaction.commandName === "rolstats") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const role = interaction.options.getRole("rol", true);
    const shouldListMembers = interaction.options.getBoolean("listar") ?? false;
    const isPublic = interaction.options.getBoolean("publico") ?? false;

    await interaction.guild.members.fetch().catch(() => null);

    const guildRole = interaction.guild.roles.cache.get(role.id);
    if (!guildRole) {
      await interaction.reply({
        content: "No pude resolver ese rol en este servidor.",
        ephemeral: true,
      });
      return;
    }

    const roleMembers = guildRole.members.map((member) => ({
      displayName: member.displayName,
      id: member.id,
    }));
    const count = roleMembers.length;

    if (!shouldListMembers) {
      await interaction.reply({
        content: `El rol <@&${guildRole.id}> tiene ${count} miembro/s.`,
        ephemeral: !isPublic,
      });
      return;
    }

    const limitedMembers = roleMembers.slice(0, 40);
    const header = `El rol <@&${guildRole.id}> tiene ${count} miembro/s.`;
    const memberLines = limitedMembers.map(
      (memberInfo, index) =>
        `${index + 1}. ${memberInfo.displayName} (<@${memberInfo.id}>)`,
    );
    const truncatedText =
      count > limitedMembers.length
        ? `\n... y ${count - limitedMembers.length} mas.`
        : "";

    await interaction.reply({
      content: `${header}\n${memberLines.join("\n")}${truncatedText}`,
      ephemeral: !isPublic,
    });
    return;
  }

  if (interaction.commandName === "publicarcomunicado") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({
        content:
          "Necesitas el permiso Manage Server para publicar comunicados.",
        ephemeral: true,
      });
      return;
    }

    const relativePath = interaction.options.getString("archivo", true);
    const selectedChannel = interaction.options.getChannel("canal");
    const targetChannelId = selectedChannel?.id ?? interaction.channelId;
    const targetChannel = await interaction.guild.channels
      .fetch(targetChannelId)
      .catch(() => null);

    if (!targetChannel || !targetChannel.isTextBased()) {
      await interaction.reply({
        content: "No se pudo resolver un canal de texto valido para publicar.",
        ephemeral: true,
      });
      return;
    }

    const content = await getCommunicationContent(relativePath).catch(
      (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Error desconocido";
        return `__ERROR__${message}`;
      },
    );

    if (content.startsWith("__ERROR__")) {
      await interaction.reply({
        content: `No se pudo leer el comunicado: ${content.replace("__ERROR__", "")}`,
        ephemeral: true,
      });
      return;
    }

    const chunks = splitForDiscord(content);

    const publishResult = await sendChunksToTextChannel(targetChannel, chunks);
    if (!publishResult.ok) {
      await interaction.reply({
        content: `No se pudo publicar el comunicado: ${publishResult.reason}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Comunicado publicado en <#${targetChannel.id}> (${chunks.length} mensaje/s).`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "setreactionrole") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageRoles")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Roles para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const targetChannel = interaction.options.getChannel("canal", true);
    const messageId = interaction.options.getString("mensaje_id", true).trim();
    const emojiRaw = interaction.options.getString("emoji", true);
    const role = interaction.options.getRole("rol", true);
    const mode = parseReactionRoleMode(interaction.options.getString("modo"));
    const emojiKey = normalizeEmojiKey(emojiRaw);

    if (!isReactionRoleTextChannelLike(targetChannel)) {
      await interaction.reply({
        content: "El canal seleccionado no es un canal de texto valido.",
        ephemeral: true,
      });
      return;
    }

    const targetMessage = await targetChannel.messages
      .fetch(messageId)
      .catch(() => null);

    if (!targetMessage) {
      await interaction.reply({
        content:
          "No pude encontrar ese mensaje en el canal indicado. Revisa canal e ID.",
        ephemeral: true,
      });
      return;
    }

    if (!emojiKey) {
      await interaction.reply({
        content: "Emoji invalido. Usa un emoji unicode o custom (<:name:id>).",
        ephemeral: true,
      });
      return;
    }

    const me = await interaction.guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has("ManageRoles")) {
      await interaction.reply({
        content: "El bot necesita permiso Manage Roles para asignar roles.",
        ephemeral: true,
      });
      return;
    }

    if (role.position >= me.roles.highest.position) {
      await interaction.reply({
        content:
          "No puedo asignar ese rol porque esta por encima (o al mismo nivel) de mi rol mas alto.",
        ephemeral: true,
      });
      return;
    }

    await upsertReactionRoleRule(interaction.guildId, {
      channelId: targetChannel.id,
      emojiKey,
      messageId,
      mode,
      roleId: role.id,
    });

    if (isReactableMessageLike(targetMessage)) {
      await targetMessage
        .react(parseEmojiForReaction(emojiRaw))
        .catch(() => null);
    }

    await interaction.reply({
      content: `Reaction role guardado en <#${targetChannel.id}>. Mensaje: ${messageId}, emoji: ${emojiRaw}, rol: <@&${role.id}>, modo: ${mode}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "createreactionpanel") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageRoles")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Roles para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const selectedChannel = interaction.options.getChannel("canal");
    const targetChannel = selectedChannel ?? interaction.channel;

    if (!isSendableTextChannelLike(targetChannel)) {
      await interaction.reply({
        content: "No se pudo resolver un canal de texto valido para publicar.",
        ephemeral: true,
      });
      return;
    }

    const title = interaction.options.getString("titulo", true).trim();
    const description = interaction.options.getString("descripcion")?.trim();
    const mode = parseReactionRoleMode(interaction.options.getString("modo"));

    const entries = [1, 2, 3]
      .map((index) => {
        const emojiRaw = interaction.options.getString(`emoji_${index}`);
        const role = interaction.options.getRole(`rol_${index}`);

        return {
          emojiRaw: emojiRaw?.trim() ?? null,
          role,
        };
      })
      .filter((entry) => Boolean(entry.emojiRaw) || Boolean(entry.role));

    if (entries.length === 0) {
      await interaction.reply({
        content: "Debes configurar al menos un par emoji + rol.",
        ephemeral: true,
      });
      return;
    }

    const invalidPair = entries.find((entry) => !entry.emojiRaw || !entry.role);
    if (invalidPair) {
      await interaction.reply({
        content:
          "Cada entrada debe tener ambos valores: emoji y rol (sin pares incompletos).",
        ephemeral: true,
      });
      return;
    }

    const normalizedEntries = entries.map((entry) => ({
      emojiRaw: entry.emojiRaw as string,
      role: entry.role as { id: string; position: number },
      emojiKey: normalizeEmojiKey(entry.emojiRaw as string),
      reactionValue: parseEmojiForReaction(entry.emojiRaw as string),
    }));

    if (normalizedEntries.some((entry) => !entry.emojiKey)) {
      await interaction.reply({
        content: "Uno o mas emojis son invalidos.",
        ephemeral: true,
      });
      return;
    }

    const me = await interaction.guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has("ManageRoles")) {
      await interaction.reply({
        content: "El bot necesita permiso Manage Roles para asignar roles.",
        ephemeral: true,
      });
      return;
    }

    const roleAboveMe = normalizedEntries.find(
      (entry) => entry.role.position >= me.roles.highest.position,
    );
    if (roleAboveMe) {
      await interaction.reply({
        content:
          "Hay un rol configurado por encima (o al mismo nivel) de mi rol mas alto.",
        ephemeral: true,
      });
      return;
    }

    const panelLines = normalizedEntries.map(
      (entry) => `${entry.emojiRaw} <@&${entry.role.id}>`,
    );
    const panelMessageText = [
      `## ${title}`,
      description ?? "",
      "Reacciona para recibir o quitar tu rol:",
      ...panelLines,
    ]
      .filter((line) => Boolean(line))
      .join("\n");

    const sentMessage = await targetChannel
      .send(panelMessageText)
      .catch(() => null);
    if (!isReactableMessageLike(sentMessage)) {
      await interaction.reply({
        content: "No pude publicar el panel en el canal seleccionado.",
        ephemeral: true,
      });
      return;
    }

    for (const entry of normalizedEntries) {
      await sentMessage.react(entry.reactionValue).catch(() => null);

      await upsertReactionRoleRule(interaction.guildId, {
        channelId: targetChannel.id,
        emojiKey: entry.emojiKey as string,
        messageId: sentMessage.id,
        mode,
        roleId: entry.role.id,
      });
    }

    await interaction.reply({
      content: `Panel creado en <#${targetChannel.id}>. Mensaje: ${sentMessage.id}. Modo: ${mode}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "removereactionrole") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageRoles")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Roles para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const targetChannel = interaction.options.getChannel("canal", true);
    const messageId = interaction.options.getString("mensaje_id", true).trim();
    const emojiRaw = interaction.options.getString("emoji", true);
    const emojiKey = normalizeEmojiKey(emojiRaw);

    if (!isReactionRoleTextChannelLike(targetChannel)) {
      await interaction.reply({
        content: "El canal seleccionado no es un canal de texto valido.",
        ephemeral: true,
      });
      return;
    }

    if (!emojiKey) {
      await interaction.reply({
        content: "Emoji invalido. Usa un emoji unicode o custom (<:name:id>).",
        ephemeral: true,
      });
      return;
    }

    const removed = await removeReactionRoleRule(
      interaction.guildId,
      messageId,
      emojiKey,
    );

    await interaction.reply({
      content: removed
        ? "Regla reaction role eliminada."
        : "No existia una regla para ese mensaje + emoji.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "listreactionroles") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const rules = await listReactionRoleRules(interaction.guildId);
    if (rules.length === 0) {
      await interaction.reply({
        content: "No hay reaction roles configurados.",
        ephemeral: true,
      });
      return;
    }

    const lines = rules.slice(0, 20).map((rule, index) => {
      const emojiLabel = rule.emojiKey
        .replace(/^custom:/, "custom:")
        .replace(/^unicode:/, "unicode:");
      const modeLabel = rule.mode ?? "multiple";
      const channelLabel = rule.channelId
        ? `<#${rule.channelId}>`
        : "(canal desconocido)";
      return `${index + 1}. ${channelLabel} msg:${rule.messageId} | ${emojiLabel} => <@&${rule.roleId}> [${modeLabel}]`;
    });

    await interaction.reply({
      content: ["Reaction roles:", ...lines].join("\n"),
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "setreactionpanelmode") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageRoles")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Roles para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const targetChannel = interaction.options.getChannel("canal", true);
    const messageId = interaction.options.getString("mensaje_id", true).trim();
    const mode = parseReactionRoleMode(interaction.options.getString("modo"));

    if (!isReactionRoleTextChannelLike(targetChannel)) {
      await interaction.reply({
        content: "El canal seleccionado no es un canal de texto valido.",
        ephemeral: true,
      });
      return;
    }

    const messageExists = await targetChannel.messages
      .fetch(messageId)
      .then(() => true)
      .catch(() => false);
    if (!messageExists) {
      await interaction.reply({
        content:
          "No pude encontrar ese mensaje en el canal indicado. Revisa canal e ID.",
        ephemeral: true,
      });
      return;
    }

    const updated = await updateReactionRoleModeForMessage(
      interaction.guildId,
      messageId,
      mode,
    );

    if (updated === 0) {
      await interaction.reply({
        content:
          "No hay reglas reaction role para ese mensaje. Crea primero las reglas del panel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Panel actualizado: ${updated} regla/s cambiadas a modo ${mode}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "listreminder") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const reminders = await listGuildReminders(interaction.guildId);
    const pending = reminders.filter((entry) => !entry.sentAt);

    if (pending.length === 0) {
      await interaction.reply({
        content: "No hay recordatorios pendientes.",
        ephemeral: true,
      });
      return;
    }

    const lines = pending.slice(0, 20).map((entry) => {
      const kind = resolveReminderKind(entry);
      const typeLabel =
        kind === "kd" ? "kd" : kind === "kdaily" ? "kdaily" : "custom";
      const intervalText = formatReminderDuration(entry.minutesFromCreation);
      const dueUnix = Math.floor(new Date(entry.dueAt).getTime() / 1000);
      return `${typeLabel} | tiempo: ${intervalText} | falta: <t:${dueUnix}:R>`;
    });

    await interaction.reply({
      content: ["Recordatorios pendientes:", ...lines].join("\n"),
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "cancelreminder") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Server para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const reminderId = interaction.options.getString("id", true).trim();
    const removed = await cancelReminder(interaction.guildId, reminderId);

    await interaction.reply({
      content: removed
        ? `Recordatorio ${reminderId} cancelado.`
        : "No existe un recordatorio con ese ID.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "removereminder") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const reminderKindInput = interaction.options.getString("tipo");
    const removeAll = interaction.options.getBoolean("all") ?? false;
    const reminderKind =
      reminderKindInput === "kd" ||
      reminderKindInput === "kdaily" ||
      reminderKindInput === "custom"
        ? reminderKindInput
        : undefined;

    if (!removeAll && !reminderKind) {
      await interaction.reply({
        content:
          "Debes indicar tipo (kd, kdaily o custom), o usar all:true para eliminar todos tus recordatorios.",
        ephemeral: true,
      });
      return;
    }

    const removedCount = await removeUserReminders({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      reminderKind: removeAll
        ? undefined
        : (reminderKind as ReminderKind | undefined),
    });

    if (removedCount === 0) {
      await interaction.reply({
        content: removeAll
          ? "No tienes recordatorios para eliminar."
          : reminderKind
            ? `No tienes recordatorios de tipo ${reminderKind} para eliminar.`
            : "No tienes recordatorios para eliminar.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: removeAll
        ? `Se eliminaron ${removedCount} recordatorio/s tuyos.`
        : reminderKind
          ? `Se eliminaron ${removedCount} recordatorio/s de tipo ${reminderKind}.`
          : `Se eliminaron ${removedCount} recordatorio/s tuyos.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "setreminder") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const reminderType = interaction.options.getSubcommand(true);
    const customMinutes = interaction.options.getInteger("minutos");
    const customHours = interaction.options.getInteger("horas");
    const repeat = interaction.options.getBoolean("repetir") ?? false;

    let minutesFromCreation: number;
    let reminderMessage: string;

    if (reminderType === "kd") {
      minutesFromCreation = 30;
      reminderMessage = pickRandom(KD_REMINDER_TEMPLATES);
    } else if (reminderType === "kdaily") {
      minutesFromCreation = 12 * 60;
      reminderMessage = pickRandom(KDAILY_REMINDER_TEMPLATES);
    } else if (reminderType === "custom") {
      if (customMinutes && customHours) {
        await interaction.reply({
          content: "Para custom indica solo uno: minutos o horas (no ambos).",
          ephemeral: true,
        });
        return;
      }

      if (!customMinutes && !customHours) {
        await interaction.reply({
          content: "Para custom debes indicar minutos o horas.",
          ephemeral: true,
        });
        return;
      }

      const durationText = customHours
        ? `${customHours} hora${customHours === 1 ? "" : "s"}`
        : `${customMinutes} minuto${customMinutes === 1 ? "" : "s"}`;

      minutesFromCreation = customHours
        ? customHours * 60
        : (customMinutes as number);
      const customBaseTemplate = pickRandom(CUSTOM_REMINDER_TEMPLATES);
      reminderMessage = customBaseTemplate.replace("{duration}", durationText);
    } else {
      await interaction.reply({
        content: "Tipo de reminder no soportado.",
        ephemeral: true,
      });
      return;
    }

    await createReminder({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      createdByUserId: interaction.user.id,
      deliveryType: "dm",
      reminderKind: reminderType as ReminderKind,
      repeat,
      message: reminderMessage,
      minutesFromCreation,
    });

    const dueUnix = Math.floor(
      (Date.now() + minutesFromCreation * 60_000) / 1000,
    );
    const repeatText = repeat
      ? " Este recordatorio se repetira automaticamente."
      : "";
    await interaction.reply({
      content: `Recordatorio privado creado. Karpindomo te escribira por DM <t:${dueUnix}:R>.${repeatText}`,
      ephemeral: true,
    });
    return;
  }

  const handler = commandHandlers[interaction.commandName];
  if (!handler) {
    await interaction.reply({
      content: "Comando no soportado.",
      ephemeral: true,
    });
    return;
  }

  await handler(interaction);
});

const VOICE_XP_TICK_INTERVAL_MS = 60_000;
const MAX_VOICE_MINUTES_PER_TICK = 10;
let voiceXpTickTimer: NodeJS.Timeout | null = null;

type VoiceSession = {
  channelId: string;
  guildId: string;
  lastEarnedAt: number;
  userId: string;
};

const voiceSessions = new Map<string, VoiceSession>();

function voiceSessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function awardXpForVoiceMinutes(input: {
  guildId: string;
  minutes: number;
  userId: string;
}): Promise<void> {
  const minutes = Math.max(1, Math.floor(input.minutes));
  if (!isRemoteStoreEnabled()) {
    return;
  }

  try {
    const xpConfig = await fetchRemoteXpConfig(input.guildId);
    const guild = await client.guilds.fetch(input.guildId).catch(() => null);
    const member = guild
      ? await guild.members.fetch(input.userId).catch(() => null)
      : null;
    const multiplier = computeXpMultiplier(
      xpConfig,
      member ? Array.from(member.roles.cache.keys()) : [],
    );
    const amount = Math.max(
      1,
      Math.round(
        Math.max(0, Math.floor(xpConfig.voiceXpPerMinute)) *
          minutes *
          multiplier,
      ),
    );

    const result = await addRemoteXp({
      amount,
      guildId: input.guildId,
      source: "voice",
      userId: input.userId,
    });

    if (result.leveledUp) {
      console.log(
        `[discord-bot] User ${input.userId} leveled up to level ${result.level} via voice (guild ${input.guildId}).`,
      );
      void applyNicknameForLevel({
        guildId: input.guildId,
        level: result.level,
        userId: input.userId,
      });
      void applyLevelRoles({
        guildId: input.guildId,
        level: result.level,
        userId: input.userId,
      });
    }
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Failed to award xp for voice: ${getErrorMessage(error)}`,
    );
  }
}

function openVoiceSession(
  guildId: string,
  userId: string,
  channelId: string,
): void {
  voiceSessions.set(voiceSessionKey(guildId, userId), {
    channelId,
    guildId,
    lastEarnedAt: Date.now(),
    userId,
  });
}

function closeVoiceSession(
  guildId: string,
  userId: string,
  channelId: string,
): void {
  const key = voiceSessionKey(guildId, userId);
  const session = voiceSessions.get(key);
  if (!session) {
    return;
  }

  voiceSessions.delete(key);

  const minutes = Math.floor((Date.now() - session.lastEarnedAt) / 60_000);
  const cappedMinutes = Math.min(minutes, MAX_VOICE_MINUTES_PER_TICK);
  for (let index = 0; index < cappedMinutes; index += 1) {
    void awardXpForVoiceMinutes({
      guildId,
      minutes: 1,
      userId,
    });
  }
}

function startVoiceXpTracker(): void {
  if (voiceXpTickTimer) {
    return;
  }

  voiceXpTickTimer = setInterval(() => {
    const now = Date.now();

    for (const session of voiceSessions.values()) {
      const minutes = Math.floor((now - session.lastEarnedAt) / 60_000);
      if (minutes <= 0) {
        continue;
      }

      const cappedMinutes = Math.min(minutes, MAX_VOICE_MINUTES_PER_TICK);
      session.lastEarnedAt += cappedMinutes * 60_000;

      for (let index = 0; index < cappedMinutes; index += 1) {
        void awardXpForVoiceMinutes({
          guildId: session.guildId,
          minutes: 1,
          userId: session.userId,
        });
      }
    }
  }, VOICE_XP_TICK_INTERVAL_MS);
}

function findNicknameRuleForLevel(
  xpConfig: XpConfig,
  level: number,
): XpRoleRule | null {
  const candidates = (xpConfig.levelRoles ?? [])
    .filter(
      (rule) => rule.level <= level && Boolean(rule.nicknamePrefix?.trim()),
    )
    .sort((left, right) => right.level - left.level);

  return candidates[0] ?? null;
}

function stripKnownNicknamePrefixes(
  currentName: string,
  prefixes: string[],
): string {
  let name = currentName.trim();
  let changed = true;

  while (changed && prefixes.length > 0) {
    changed = false;
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  return name;
}

async function applyNicknameForLevel(input: {
  guildId: string;
  level: number;
  userId: string;
}): Promise<void> {
  if (!isRemoteStoreEnabled()) {
    return;
  }

  try {
    const xpConfig = await fetchRemoteXpConfig(input.guildId);
    const rule = findNicknameRuleForLevel(xpConfig, input.level);
    const prefix = rule?.nicknamePrefix?.trim();
    if (!rule || !prefix) {
      return;
    }

    const guild = await client.guilds.fetch(input.guildId).catch(() => null);
    if (!guild) {
      return;
    }

    const member = await guild.members.fetch(input.userId).catch(() => null);
    if (!member) {
      return;
    }

    const prefixes = (xpConfig.levelRoles ?? [])
      .map((entry) => entry.nicknamePrefix?.trim() ?? "")
      .filter(Boolean);

    const baseName = member.nickname?.trim()
      ? stripKnownNicknamePrefixes(member.nickname, prefixes)
      : member.user.globalName?.trim() || member.user.username.trim();

    if (!baseName) {
      return;
    }

    const nextNickname = `${prefix}${baseName}`.slice(0, 32);
    if (member.nickname === nextNickname) {
      return;
    }

    await member.setNickname(nextNickname, `Level up to ${input.level}`);
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Failed to apply nickname prefix: ${getErrorMessage(error)}`,
    );
  }
}

async function applyLevelRoles(input: {
  guildId: string;
  level: number;
  userId: string;
}): Promise<void> {
  if (!isRemoteStoreEnabled()) {
    return;
  }

  try {
    const xpConfig = await fetchRemoteXpConfig(input.guildId);
    const candidateRules = (xpConfig.levelRoles ?? []).filter(
      (rule) => rule.level <= input.level && rule.roleId,
    );
    if (candidateRules.length === 0) {
      return;
    }

    const currentRule = candidateRules.sort(
      (left, right) => right.level - left.level,
    )[0];
    if (!currentRule?.roleId) {
      return;
    }

    const guild = await client.guilds.fetch(input.guildId).catch(() => null);
    if (!guild) {
      return;
    }

    const member = await guild.members.fetch(input.userId).catch(() => null);
    if (!member) {
      return;
    }

    const me = await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn(
        `[discord-bot] Bot lacks ManageRoles permission to apply level roles (guild ${input.guildId}).`,
      );
      return;
    }

    const botHighestPosition = me.roles.highest.position;
    const memberRoleIds = new Set(member.roles.cache.keys());
    const roleIdsToAdd = new Set<string>();
    const roleIdsToRemove = new Set<string>();

    roleIdsToAdd.add(currentRule.roleId);

    for (const extraRoleId of currentRule.addRoleIds ?? []) {
      if (extraRoleId) {
        roleIdsToAdd.add(extraRoleId);
      }
    }

    if (currentRule.stacking === "replace") {
      for (const rule of xpConfig.levelRoles ?? []) {
        if (rule.roleId && rule.roleId !== currentRule.roleId) {
          roleIdsToRemove.add(rule.roleId);
        }
      }
    }

    for (const extraRoleId of currentRule.removeRoleIds ?? []) {
      if (extraRoleId) {
        roleIdsToRemove.add(extraRoleId);
      }
    }

    for (const roleId of roleIdsToAdd) {
      roleIdsToRemove.delete(roleId);
    }

    const roleIdsToActuallyAdd = [...roleIdsToAdd].filter((roleId) => {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.position >= botHighestPosition) {
        return false;
      }
      return !memberRoleIds.has(roleId);
    });

    const roleIdsToActuallyRemove = [...roleIdsToRemove].filter((roleId) => {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.position >= botHighestPosition) {
        return false;
      }
      return memberRoleIds.has(roleId);
    });

    if (roleIdsToActuallyAdd.length > 0) {
      await member.roles.add(
        roleIdsToActuallyAdd,
        `Level up to ${input.level}`,
      );
    }

    if (roleIdsToActuallyRemove.length > 0) {
      await member.roles.remove(
        roleIdsToActuallyRemove,
        `Level up to ${input.level}`,
      );
    }
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Failed to apply level roles: ${getErrorMessage(error)}`,
    );
  }
}

async function awardXpForMessage(
  message: {
    author: { bot: boolean; id: string };
    channelId: string;
    guildId: string | null;
  },
  memberRoles?: ReadonlySet<string> | string[],
): Promise<void> {
  if (message.author.bot || !message.guildId) {
    return;
  }

  if (!isRemoteStoreEnabled()) {
    return;
  }

  const cooldownKey = `${message.guildId}:${message.author.id}`;
  const now = Date.now();

  let cooldownSeconds = 60;
  try {
    const xpConfig = await fetchRemoteXpConfig(message.guildId);
    cooldownSeconds = xpConfig.cooldownSeconds;

    const lastAward = xpCooldowns.get(cooldownKey);
    if (lastAward && now - lastAward < cooldownSeconds * 1000) {
      return;
    }

    const multiplier = computeXpMultiplier(xpConfig, memberRoles ?? []);
    const amount = Math.max(1, Math.round(xpConfig.messageXp * multiplier));

    const result = await addRemoteXp({
      amount,
      guildId: message.guildId,
      source: "message",
      userId: message.author.id,
    });

    xpCooldowns.set(cooldownKey, now);

    if (result.leveledUp) {
      console.log(
        `[discord-bot] User ${message.author.id} leveled up to level ${result.level} (guild ${message.guildId}).`,
      );
      void applyNicknameForLevel({
        guildId: message.guildId,
        level: result.level,
        userId: message.author.id,
      });
      void applyLevelRoles({
        guildId: message.guildId,
        level: result.level,
        userId: message.author.id,
      });
    }
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Failed to award xp for message: ${getErrorMessage(error)}`,
    );
  }
}

client.on(Events.MessageCreate, (message) => {
  const memberRoles = message.member
    ? Array.from(message.member.roles.cache.keys())
    : undefined;
  void awardXpForMessage(message, memberRoles);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const message = buildWelcomeMessage(member.id);

  await sendMemberLog(member.guild.id, member.guild.systemChannelId, message);
});

client.on(Events.GuildMemberRemove, async (member) => {
  const username = member.user?.tag ?? member.id;
  const leaveDetails = await resolveMemberLeaveDetails(member).catch(
    () => ({ kind: "leave" }) as MemberLeaveDetails,
  );
  const message = formatLeaveMessage(username, member.id, leaveDetails);

  await sendMemberLog(member.guild.id, member.guild.systemChannelId, message);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = oldState.id ?? newState.member?.id;
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  if (userId) {
    if (oldChannelId && oldChannelId !== newChannelId) {
      closeVoiceSession(guildId, userId, oldChannelId);
    }

    if (newChannelId && newChannelId !== oldChannelId) {
      const isBot = Boolean(newState.member?.user.bot);
      const isAfkChannel = newChannelId === newState.guild.afkChannelId;
      if (!isBot && !isAfkChannel) {
        openVoiceSession(guildId, userId, newChannelId);
      }
    }
  }

  if (newChannelId && newChannelId !== oldChannelId) {
    await createDynamicVoiceChannelForMember(newState).catch(
      (error: unknown) => {
        console.error("[discord-bot] Failed to create dynamic voice channel", {
          guildId: newState.guild.id,
          memberId: newState.member?.id,
          error,
        });
      },
    );
  }

  if (oldChannelId && oldChannelId !== newChannelId) {
    await maybeDeleteTemporaryVoiceChannel(oldState).catch((error: unknown) => {
      console.error("[discord-bot] Failed to delete dynamic voice channel", {
        guildId: oldState.guild.id,
        channelId: oldState.channelId,
        error,
      });
    });
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) {
    return;
  }

  const guildId = reaction.message.guildId;
  if (!guildId) {
    return;
  }

  const emojiKey = reactionEmojiKey(reaction);
  if (!emojiKey) {
    return;
  }

  const rule = await findReactionRoleRule(
    guildId,
    reaction.message.id,
    emojiKey,
  );
  if (!rule) {
    return;
  }

  const guild = reaction.message.guild;
  if (!guild) {
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return;
  }

  const mode = rule.mode ?? "multiple";

  if (mode === "unique") {
    const panelRules = await listReactionRoleRules(guildId);
    const siblingRoleIds = Array.from(
      new Set(
        panelRules
          .filter((entry) => entry.messageId === reaction.message.id)
          .map((entry) => entry.roleId)
          .filter((roleId) => roleId !== rule.roleId),
      ),
    );

    if (siblingRoleIds.length > 0) {
      await member.roles.remove(siblingRoleIds).catch((error: unknown) => {
        console.error("[discord-bot] Failed to enforce unique reaction role", {
          guildId,
          userId: user.id,
          roleIds: siblingRoleIds,
          error,
        });
      });
    }
  }

  await member.roles.add(rule.roleId).catch((error: unknown) => {
    console.error("[discord-bot] Failed to add reaction role", {
      guildId,
      userId: user.id,
      roleId: rule.roleId,
      error,
    });
  });
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) {
    return;
  }

  const guildId = reaction.message.guildId;
  if (!guildId) {
    return;
  }

  const emojiKey = reactionEmojiKey(reaction);
  if (!emojiKey) {
    return;
  }

  const rule = await findReactionRoleRule(
    guildId,
    reaction.message.id,
    emojiKey,
  );
  if (!rule) {
    return;
  }

  const guild = reaction.message.guild;
  if (!guild) {
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return;
  }

  const mode = rule.mode ?? "multiple";
  if (mode === "additive") {
    return;
  }

  await member.roles.remove(rule.roleId).catch((error: unknown) => {
    console.error("[discord-bot] Failed to remove reaction role", {
      guildId,
      userId: user.id,
      roleId: rule.roleId,
      error,
    });
  });
});

if (env.BOT_DISABLED) {
  console.log("[discord-bot] BOT_DISABLED is enabled. Skipping Discord login.");
} else {
  client.login(env.DISCORD_BOT_TOKEN!).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("Used disallowed intents")) {
      console.error(
        "[discord-bot] Enable required intents. For member logs, enable Server Members Intent in Discord Developer Portal > Bot.",
      );
    }

    console.error("[discord-bot] Failed to login", error);
    process.exit(1);
  });
}
