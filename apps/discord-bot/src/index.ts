import {
  AuditLogEvent,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import { commandHandlers } from "./commands.js";
import { env } from "./config/env.js";
import {
  checkMusicChannelEmpty,
  handleMusicButton,
  handleMusicCommand,
} from "./services/music-service.js";
import {
  cancelReminder,
  createReminder,
  listDueReminders,
  listGuildReminders,
  markReminderSent,
  type Reminder,
  removeUserReminders,
  rescheduleReminder,
} from "./services/reminders-store.js";
import {
  addTemporaryVoiceChannelId,
  findReactionRoleRule,
  getGuildConfig,
  isTemporaryVoiceChannel,
  listReactionRoleRules,
  type ReactionRoleMode,
  removeReactionRoleRulesForMessage,
  removeTemporaryVoiceChannelId,
  setXpSyncRequested,
  upsertReactionRoleRule,
} from "./services/guild-config-store.js";
import {
  completeReactionRoleJob,
  fetchPendingReactionRoleJobs,
  type PendingReactionRoleJob,
  type ReactionRolePair,
} from "./services/reaction-roles-service.js";
import {
  getCommunicationContent,
  listCommunicationFiles,
  splitForDiscord,
} from "./services/communications-store.js";
import {
  addRemoteXp,
  computeXpMultiplier,
  fetchRemoteXpConfig,
  fetchRemoteXpProfiles,
  getErrorMessage,
  isRemoteStoreEnabled,
  setRemoteXpLevel,
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

process.on("unhandledRejection", (reason) => {
  console.error("[discord-bot] Unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[discord-bot] Uncaught exception", error);
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

function hasEditMethod(
  value: unknown,
): value is { edit: (content: string) => Promise<unknown> } {
  return isObjectRecord(value) && typeof value.edit === "function";
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

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const TIMER_TEMPLATES = [
  "🫖 Senior, su timer de {duration} ha llegado.",
  "🫖 Senior, Karpindomo anuncia que finalizo su timer de {duration}.",
  "🫖 Senior, es momento de atender su timer de {duration}.",
  "🫖 Senior, Karpindomo le avisa que se cumplio el plazo de {duration}.",
  "🫖 Senior, su aviso configurado para {duration} esta listo.",
  "🫖 Senior, Karpindomo notifica que el temporizador de {duration} finalizo.",
  "🫖 Senior, su cita con el timer de {duration} ha llegado.",
] as const;

const WELCOME_TEMPLATES = [
  "🫖 **Karpindomo se presenta, Senior.**\nBienvenido <@{memberId}> a la comunidad.\nLa casa queda a su disposicion.",
  "🎩 **Karpindomo, mayordomo capincho, al servicio.**\nUn placer recibir a <@{memberId}> en el servidor.\nQue tenga una estancia impecable.",
  "🛎️ **Atencion, atencion:** Karpindomo confirma llegada de <@{memberId}>.\nBienvenido a esta distinguida comunidad.",
  "🍵 **Recepcion oficial de Karpindomo.**\n<@{memberId}> ya esta en casa.\nPongase comodo y disfrute la estadia.",
] as const;

function formatTimerDuration(totalMinutes: number): string {
  const totalSeconds = Math.round(totalMinutes * 60);
  if (totalSeconds < 60) {
    return `${totalSeconds} segundo${totalSeconds === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
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
  const durationText = formatTimerDuration(reminder.minutesFromCreation);
  const next = pickRandomTemplateAvoidingLast(
    TIMER_TEMPLATES,
    reminder.rotationIndex,
  );

  return {
    content: next.template.replace("{duration}", durationText),
    rotationIndex: next.index,
  };
}

function buildWelcomeMessage(memberId: string): string {
  return pickRandom(WELCOME_TEMPLATES).replace("{memberId}", memberId);
}

const LEVEL_UP_TEMPLATES = [
  "🫖 **¡Felicitaciones, Senior!**\n<@{memberId}> alcanzó el nivel {level}.\nKarpindomo queda impresionado.",
  "🎩 **Karpindomo saluda el ascenso.**\n<@{memberId}> subió al nivel {level}.\nQue siga creciendo la leyenda.",
  "⭐ **Nivel subido, {level}!**\n<@{memberId}> sigue escalando.\nKarpindomo aprueba semejante dedicación.",
  "🍵 **Brindis de Karpindomo.**\nPor <@{memberId}>, que llega al nivel {level}.\nSalud y más XP.",
  "🛎️ **Atencion:** <@{memberId}> alcanzó el nivel {level}.\nEl mayordomo capincho lo celebra.",
  "📈 **Progreso registrado.**\n<@{memberId}> ahora es nivel {level}.\nSiga así, que el techo es alto.",
  "🪧 **Anuncio de Karpindomo.**\n<@{memberId}> acaba de llegar al nivel {level}.\nEl servidor tiene nuevo talento.",
  "🥂 **Por los logros.**\n<@{memberId}> alcanzó el nivel {level}.\nKarpindomo levanta la copa de te.",
  "🎖️ **Honor a quien honor merece.**\n<@{memberId}> se ganó el nivel {level}.\nEl mayordomo capincho lo aplaude.",
  "✨ **Brillo en el horizonte.**\n<@{memberId}> llega al nivel {level}.\nKarpindomo sonríe con aprobación.",
  "📜 **Acta de Karpindomo.**\nQueda registrado que <@{memberId}> subió al nivel {level}.\nEs un placer servirle.",
  "🫖 **La casa se enorgullece.**\n<@{memberId}> alcanzó el nivel {level}.\nQue siga el camino del carpincho.",
  "🗝️ **Escalando posiciones.**\n<@{memberId}> desbloqueó el nivel {level}.\nKarpindomo custodia sus llaves de la sala VIP.",
  "🌱 **Crecer es el objetivo.**\n<@{memberId}> alcanzó el nivel {level}.\nKarpindomo nota el esfuerzo, Senior.",
  "🎩 **Otra vez impresionante.**\n<@{memberId}> sube al nivel {level}.\nEl mayordomo ajusta su moño de orgullo.",
  "🏆 **Trofeo al progreso.**\n<@{memberId}> ganó el nivel {level}.\nKarpindomo lo coloca en el estante de honor.",
  "☕ **Pausa para celebrar.**\n<@{memberId}> llegó al nivel {level}.\nEl te de Karpindomo espera por el festejo.",
  "🪙 **Moneda de Karpindomo:**\n<@{memberId}> alcanzó el nivel {level}.\nSiga acumulando, Senior.",
  "🛡️ **Guardianes del rango.**\n<@{memberId}> superó el nivel {level}.\nKarpindomo le da la bienvenida al club.",
  "🎖️ **Ascenso de rango.**\n<@{memberId}> llegó al rango {level}.\nKarpindomo lo saluda con honor.",
  "🏅 **Nuevo rango desbloqueado.**\n<@{memberId}> alcanzó el rango {level}.\nEl mayordomo capincho aplaude.",
  "📯 **Toque de corneta.**\n<@{memberId}> asciende al rango {level}.\nKarpindomo rinde tributo.",
  "🦆 **El carpincho aprueba.**\n<@{memberId}> subió de rango: {level}.\nSiga elevando el estándar.",
  "🔔 **Campanadas de Karpindomo.**\n<@{memberId}> alcanzó el rango {level}.\nSe lo festeja como corresponde.",
  "🫖 **Asiento reservado.**\n<@{memberId}> ganó el rango {level}.\nKarpindomo ya le guardó lugar en la mesa.",
] as const;

let lastLevelUpTemplateIndex: number | undefined;

function buildLevelUpMessage(memberId: string, level: number): string {
  const next = pickRandomTemplateAvoidingLast(
    LEVEL_UP_TEMPLATES,
    lastLevelUpTemplateIndex,
  );
  lastLevelUpTemplateIndex = next.index;
  return next.template
    .replace("{memberId}", memberId)
    .replace("{level}", String(level));
}

async function announceLevelUp(input: {
  guildId: string;
  level: number;
  previousLevel: number;
  userId: string;
}): Promise<void> {
  try {
    const xpConfig = await fetchRemoteXpConfig(input.guildId);
    const crossedRank = (xpConfig.levelRoles ?? [])
      .filter(
        (rule) =>
          rule.roleId &&
          rule.level > input.previousLevel &&
          rule.level <= input.level,
      )
      .sort((left, right) => right.level - left.level)[0];

    if (!crossedRank) {
      return;
    }

    const guild = await client.guilds.fetch(input.guildId).catch(() => null);
    if (!guild) {
      return;
    }

    const guildConfig = await getGuildConfig(input.guildId);
    const channelId = guildConfig.memberLogChannelId;
    if (!channelId) {
      console.log(
        `[discord-bot] <@${input.userId}> subió al rango ${crossedRank.level} (sin canal de Karpindomo configurado).`,
      );
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!isSendableTextChannelLike(channel)) {
      return;
    }

    await channel.send(buildLevelUpMessage(input.userId, crossedRank.level));
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Failed to announce level up: ${getErrorMessage(error)}`,
    );
  }
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

const XP_SYNC_POLL_INTERVAL_MS = 30_000;
let xpSyncPollTimer: NodeJS.Timeout | null = null;

async function syncGuildRoles(guildId: string): Promise<void> {
  if (!isRemoteStoreEnabled()) {
    return;
  }

  try {
    const [xpConfig, profiles] = await Promise.all([
      fetchRemoteXpConfig(guildId),
      fetchRemoteXpProfiles(guildId),
    ]);
    const profileByUser = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    );

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return;
    }

    const me = await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn(
        `[discord-bot] Bot lacks ManageRoles permission to sync roles (guild ${guildId}).`,
      );
      return;
    }

    const members = await guild.members.fetch().catch(() => null);
    if (!members) {
      return;
    }

    const botHighestPosition = me.roles.highest.position;
    const allLevelRoleIds = (xpConfig.levelRoles ?? [])
      .map((rule) => rule.roleId)
      .filter(Boolean);

    let synced = 0;
    for (const member of members.values()) {
      if (member.user.bot) {
        continue;
      }

      const level = profileByUser.get(member.id)?.level ?? 0;

      await applyLevelRoles({ guildId, level, userId: member.id }).catch(
        () => undefined,
      );
      await applyNicknameForLevel({ guildId, level, userId: member.id }).catch(
        () => undefined,
      );

      const rolesAboveLevel = allLevelRoleIds.filter((roleId) => {
        const rule = xpConfig.levelRoles?.find(
          (entry) => entry.roleId === roleId,
        );
        if (!rule || rule.level <= level) {
          return false;
        }
        const role = guild.roles.cache.get(roleId);
        if (!role || role.position >= botHighestPosition) {
          return false;
        }
        return member.roles.cache.has(roleId);
      });

      if (rolesAboveLevel.length > 0) {
        await member.roles
          .remove(rolesAboveLevel, "XP sync: nivel actualizado")
          .catch(() => undefined);
      }

      synced += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    console.log(
      `[discord-bot] XP sync completed for guild ${guildId}: ${synced} members.`,
    );
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Failed to sync guild roles: ${getErrorMessage(error)}`,
    );
  }
}

function startXpSyncChecker(): void {
  if (xpSyncPollTimer) {
    return;
  }

  xpSyncPollTimer = setInterval(() => {
    void (async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          const config = await getGuildConfig(guild.id);
          if (!config.xpSyncRequested) {
            continue;
          }

          await setXpSyncRequested(guild.id, false);
          await syncGuildRoles(guild.id);
        } catch (error: unknown) {
          console.warn(
            `[discord-bot] XP sync poll failed for guild ${guild.id}: ${getErrorMessage(error)}`,
          );
        }
      }
    })();
  }, XP_SYNC_POLL_INTERVAL_MS);
}

const REACTION_ROLE_JOB_POLL_INTERVAL_MS = 20_000;
let reactionRoleJobTimer: NodeJS.Timeout | null = null;

function buildReactionPanelText(input: {
  description?: string | null;
  pairs: ReactionRolePair[];
  title?: string | null;
}): string {
  // Las parejas emoji+rol van consecutivas en una sola línea para que el
  // mensaje no quede largo apilando un rol debajo de otro.
  const roleRow = input.pairs
    .map((pair) => `${pair.emoji} <@&${pair.roleId}>`)
    .join("   ");
  return [
    input.title ? `## ${input.title}` : "",
    input.description ?? "",
    roleRow,
  ]
    .filter((line) => Boolean(line))
    .join("\n");
}

function resolveReactionEmoji(
  guild: {
    emojis?: {
      cache?: {
        find: (
          predicate: (emoji: {
            animated: boolean;
            id: string;
            name: string;
          }) => boolean,
        ) => { animated: boolean; id: string; name: string } | undefined;
      };
    };
  },
  raw: string,
): string {
  const trimmed = raw.trim();
  if (
    /^<a?:\w+:\d+>$/.test(trimmed) ||
    /^\d+$/.test(trimmed) ||
    /[^\x00-\x7F]/.test(trimmed)
  ) {
    return trimmed;
  }
  const bare = trimmed.replace(/^:+/u, "").replace(/:+$/u, "");
  const found = guild.emojis?.cache?.find((emoji) => emoji.name === bare);
  return found
    ? found.animated
      ? `<a:${found.name}:${found.id}>`
      : `<:${found.name}:${found.id}>`
    : bare;
}

async function processReactionRoleJob(
  job: PendingReactionRoleJob,
): Promise<void> {
  const guild = await client.guilds.fetch(job.guildId).catch(() => null);
  if (!guild) {
    await completeReactionRoleJob(job.guildId, job.id, {
      error: "No se pudo obtener la guild",
    });
    return;
  }

  try {
    if (job.action === "create") {
      if (!job.channelId) {
        await completeReactionRoleJob(job.guildId, job.id, {
          error: "Falta canal",
        });
        return;
      }

      const channel = await guild.channels
        .fetch(job.channelId)
        .catch(() => null);
      if (!isSendableTextChannelLike(channel)) {
        await completeReactionRoleJob(job.guildId, job.id, {
          error: "Canal invalido",
        });
        return;
      }

      const resolvedRules = job.rules.map((pair) => ({
        emoji: resolveReactionEmoji(guild, pair.emoji),
        roleId: pair.roleId,
      }));

      const panelText = buildReactionPanelText({
        description: job.description,
        pairs: resolvedRules,
        title: job.title,
      });
      const sentMessage = await channel.send(panelText).catch(() => null);
      if (!isReactableMessageLike(sentMessage)) {
        await completeReactionRoleJob(job.guildId, job.id, {
          error: "No se pudo publicar el panel",
        });
        return;
      }

      for (const pair of resolvedRules) {
        const emojiKey = normalizeEmojiKey(pair.emoji);
        if (!emojiKey) {
          continue;
        }

        await sentMessage
          .react(parseEmojiForReaction(pair.emoji))
          .catch(() => undefined);
        await upsertReactionRoleRule(job.guildId, {
          channelId: job.channelId ?? undefined,
          emojiKey,
          messageId: sentMessage.id,
          mode: (job.mode as ReactionRoleMode) || "multiple",
          roleId: pair.roleId,
        });
      }

      await completeReactionRoleJob(job.guildId, job.id, {
        messageId: sentMessage.id,
        panel: {
          channelId: job.channelId ?? undefined,
          description: job.description ?? undefined,
          mode: job.mode,
          title: job.title ?? undefined,
        },
      });
      return;
    }

    if (job.action === "update") {
      const existingRules = await listReactionRoleRules(job.guildId);
      const oldChannelId =
        existingRules.find((rule) => rule.messageId === job.messageId)
          ?.channelId ?? null;
      const channelId = job.channelId ?? oldChannelId;

      if (!job.messageId || !channelId) {
        await completeReactionRoleJob(job.guildId, job.id, {
          error: "No se pudo resolver el mensaje del panel",
        });
        return;
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!isReactionRoleTextChannelLike(channel)) {
        await completeReactionRoleJob(job.guildId, job.id, {
          error: "Canal invalido",
        });
        return;
      }

      const resolvedRules = job.rules.map((pair) => ({
        emoji: resolveReactionEmoji(guild, pair.emoji),
        roleId: pair.roleId,
      }));
      const panelText = buildReactionPanelText({
        description: job.description,
        pairs: resolvedRules,
        title: job.title,
      });

      // Buscamos el mensaje primero en el canal objetivo y, si el canal
      // cambió, también en el canal donde vivía antes.
      let message = await channel.messages
        .fetch(job.messageId)
        .catch(() => null);
      if (!message && oldChannelId && oldChannelId !== channelId) {
        const oldChannel = await guild.channels
          .fetch(oldChannelId)
          .catch(() => null);
        if (isReactionRoleTextChannelLike(oldChannel)) {
          message = await oldChannel.messages
            .fetch(job.messageId)
            .catch(() => null);
        }
      }

      let targetMessageId = job.messageId;

      if (!message) {
        // El mensaje original ya no existe (fue borrado o el canal
        // cambió): lo volvemos a publicar para no dejar el panel huérfano.
        const republished = await channel.send(panelText).catch(() => null);
        if (!isReactableMessageLike(republished)) {
          await completeReactionRoleJob(job.guildId, job.id, {
            error: "No se pudo republicar el panel",
          });
          return;
        }
        message = republished;
        targetMessageId = republished.id;
      } else if (hasEditMethod(message)) {
        await message.edit(panelText).catch(() => undefined);
      }

      if (isReactableMessageLike(message)) {
        const reactions = (
          message as {
            reactions?: {
              cache?: Map<unknown, { remove: () => Promise<unknown> }>;
            };
          }
        ).reactions?.cache;

        if (reactions) {
          for (const reaction of Array.from(reactions.values())) {
            await reaction.remove().catch(() => undefined);
          }
        }

        for (const pair of resolvedRules) {
          const emojiKey = normalizeEmojiKey(pair.emoji);
          if (!emojiKey) {
            continue;
          }
          await message
            .react(parseEmojiForReaction(pair.emoji))
            .catch(() => undefined);
        }
      }

      await removeReactionRoleRulesForMessage(job.guildId, job.messageId);
      for (const pair of resolvedRules) {
        const emojiKey = normalizeEmojiKey(pair.emoji);
        if (!emojiKey) {
          continue;
        }
        await upsertReactionRoleRule(job.guildId, {
          channelId: channelId,
          emojiKey,
          messageId: targetMessageId,
          mode: (job.mode as ReactionRoleMode) || "multiple",
          roleId: pair.roleId,
        });
      }

      await completeReactionRoleJob(job.guildId, job.id, {
        deletePanelMessageId:
          targetMessageId !== job.messageId ? job.messageId : undefined,
        messageId: targetMessageId,
        panel: {
          channelId,
          description: job.description ?? undefined,
          mode: job.mode,
          title: job.title ?? undefined,
        },
      });
      return;
    }

    if (job.action === "delete") {
      const rules = await listReactionRoleRules(job.guildId);
      const messageRules = rules.filter(
        (rule) => rule.messageId === job.messageId,
      );
      const channelId = messageRules[0]?.channelId;

      if (channelId && job.messageId) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (isReactionRoleTextChannelLike(channel)) {
          const message = await channel.messages
            .fetch(job.messageId)
            .catch(() => null);
          if (hasDeleteMethod(message)) {
            await message.delete().catch(() => undefined);
          }
        }
      }

      await removeReactionRoleRulesForMessage(job.guildId, job.messageId ?? "");
      await completeReactionRoleJob(job.guildId, job.id, {});
      return;
    }

    await completeReactionRoleJob(job.guildId, job.id, {
      error: `Accion desconocida: ${job.action}`,
    });
  } catch (error: unknown) {
    await completeReactionRoleJob(job.guildId, job.id, {
      error: getErrorMessage(error),
    });
  }
}

async function processPendingReactionRoleJobs(): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const jobs = await fetchPendingReactionRoleJobs(guild.id);
      for (const job of jobs) {
        await processReactionRoleJob(job);
      }
    } catch (error: unknown) {
      console.warn(
        `[discord-bot] Failed to process reaction role jobs for guild ${guild.id}: ${getErrorMessage(error)}`,
      );
    }
  }
}

function startReactionRoleJobProcessor(): void {
  if (reactionRoleJobTimer) {
    return;
  }

  reactionRoleJobTimer = setInterval(() => {
    void processPendingReactionRoleJobs();
  }, REACTION_ROLE_JOB_POLL_INTERVAL_MS);

  void processPendingReactionRoleJobs();
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] Online as ${readyClient.user.tag}`);
  startReminderScheduler();
  startVoiceXpTracker();
  startXpSyncChecker();
  startReactionRoleJobProcessor();
});

async function handleXpLevelCommand(
  interaction: ChatInputCommandInteraction,
  action: "add" | "remove" | "set" | "reset",
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "Este comando solo se puede usar dentro de un servidor.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Necesitas el permiso Manage Server para usar este comando.",
      ephemeral: true,
    });
    return;
  }

  if (!isRemoteStoreEnabled()) {
    await interaction.reply({
      content: "El store remoto de XP no está configurado.",
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);
  const level =
    action === "reset"
      ? undefined
      : (interaction.options.getInteger(
          action === "set" ? "nivel" : "niveles",
          true,
        ) ?? 0);

  try {
    const result = await setRemoteXpLevel({
      action,
      guildId: interaction.guildId,
      level,
      userId: targetUser.id,
    });

    const actionText: Record<"add" | "remove" | "set" | "reset", string> = {
      add: `Se agregaron ${level} nivel/es a <@${targetUser.id}>. Ahora es nivel ${result.level}.`,
      remove: `Se quitaron ${level} nivel/es a <@${targetUser.id}>. Ahora es nivel ${result.level}.`,
      set: `<@${targetUser.id}> ahora es nivel ${result.level}.`,
      reset: `Se reinició el XP de <@${targetUser.id}>. Quedó en nivel 0.`,
    };

    await interaction.reply({
      content: actionText[action],
      ephemeral: true,
    });
  } catch (error: unknown) {
    await interaction.reply({
      content: `No se pudo actualizar el nivel: ${getErrorMessage(error)}`,
      ephemeral: true,
    });
  }
}

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

  if (interaction.isButton()) {
    // Botones del player de música (estilo Rythm).
    if (interaction.customId.startsWith("music:")) {
      await handleMusicButton(interaction);
    }
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

  if (interaction.commandName === "listtimers") {
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
        content: "No hay timers pendientes.",
        ephemeral: true,
      });
      return;
    }

    const lines = pending.slice(0, 20).map((entry) => {
      const durationText = formatTimerDuration(entry.minutesFromCreation);
      const dueUnix = Math.floor(new Date(entry.dueAt).getTime() / 1000);
      const repeatText = entry.repeat ? " (repite)" : "";
      return `\`${entry.id}\` | ${durationText}${repeatText} | <@${entry.createdByUserId}> | falta <t:${dueUnix}:R>`;
    });

    await interaction.reply({
      content: ["Timers pendientes:", ...lines].join("\n"),
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "canceltimer") {
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

    const timerId = interaction.options.getString("id", true).trim();
    const removed = await cancelReminder(interaction.guildId, timerId);

    await interaction.reply({
      content: removed
        ? `Timer ${timerId} cancelado.`
        : "No existe un timer con ese ID.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "removetimer") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const removedCount = await removeUserReminders({
      guildId: interaction.guildId,
      userId: interaction.user.id,
    });

    await interaction.reply({
      content:
        removedCount === 0
          ? "No tienes timers pendientes para eliminar."
          : removedCount === 1
            ? "Se elimino 1 timer tuyo."
            : `Se eliminaron ${removedCount} timers tuyos.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "settimer") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const seconds = interaction.options.getInteger("segundos") ?? 0;
    const minutes = interaction.options.getInteger("minutos") ?? 0;
    const hours = interaction.options.getInteger("horas") ?? 0;
    const repeat = interaction.options.getBoolean("repetir") ?? false;

    const totalSeconds = seconds + minutes * 60 + hours * 3600;
    if (totalSeconds < 1 || totalSeconds > 604_800) {
      await interaction.reply({
        content:
          "Indicá un tiempo entre 1 segundo y 7 días (podés combinar segundos, minutos y horas).",
        ephemeral: true,
      });
      return;
    }

    const durationText = formatTimerDuration(totalSeconds / 60);
    const template = pickRandom(TIMER_TEMPLATES);
    const reminderMessage = template.replace("{duration}", durationText);

    await createReminder({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      createdByUserId: interaction.user.id,
      deliveryType: "dm",
      reminderKind: "custom",
      repeat,
      message: reminderMessage,
      minutesFromCreation: totalSeconds / 60,
    });

    const dueUnix = Math.floor((Date.now() + totalSeconds * 1000) / 1000);
    const repeatText = repeat ? " Este timer se repetira automaticamente." : "";
    await interaction.reply({
      content: `Timer creado. Karpindomo te avisara por DM <t:${dueUnix}:R>.${repeatText}`,
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.commandName === "addlvl" ||
    interaction.commandName === "removelvl" ||
    interaction.commandName === "setlvl" ||
    interaction.commandName === "resetlvl"
  ) {
    const action: "add" | "remove" | "set" | "reset" =
      interaction.commandName === "addlvl"
        ? "add"
        : interaction.commandName === "removelvl"
          ? "remove"
          : interaction.commandName === "setlvl"
            ? "set"
            : "reset";
    await handleXpLevelCommand(interaction, action);
    return;
  }

  if (
    interaction.commandName === "play" ||
    interaction.commandName === "pause" ||
    interaction.commandName === "resume" ||
    interaction.commandName === "skip" ||
    interaction.commandName === "queue" ||
    interaction.commandName === "nowplaying" ||
    interaction.commandName === "volume" ||
    interaction.commandName === "stop" ||
    interaction.commandName === "leave"
  ) {
    await handleMusicCommand(interaction);
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
      void announceLevelUp({
        guildId: input.guildId,
        level: result.level,
        previousLevel: result.previousLevel,
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
      void announceLevelUp({
        guildId: message.guildId,
        level: result.level,
        previousLevel: result.previousLevel,
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

  const guildConfig = await getGuildConfig(member.guild.id).catch(() => null);
  const defaultRoleId = guildConfig?.defaultRoleId;
  if (!defaultRoleId) {
    return;
  }

  await member.roles
    .add(defaultRoleId, "Rol de entrada del servidor")
    .catch((error: unknown) => {
      console.error("[discord-bot] Failed to assign entry role", {
        error,
        guildId: member.guild.id,
        memberId: member.id,
        roleId: defaultRoleId,
      });
    });
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

  // Auto-leave del bot de música si el canal queda sin oyentes.
  const botId = client.user?.id;
  const involvedChannel = newState.channel ?? oldState.channel;
  if (involvedChannel && newState.id !== botId && oldState.id !== botId) {
    checkMusicChannelEmpty(involvedChannel);
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
