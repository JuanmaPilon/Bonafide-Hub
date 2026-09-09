import {
  AuditLogEvent,
  AttachmentBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { commandHandlers } from "./commands.js";
import { env } from "./config/env.js";
import {
  checkMusicChannelEmpty,
  handleMusicButton,
  handleMusicCommand,
} from "./services/music-service.js";
import {
  handleEventSignupCharacterSubmit,
  handleEventSignupInteraction,
} from "./services/events-signup-service.js";
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
  getGuildConfig,
  isTemporaryVoiceChannel,
  removeTemporaryVoiceChannelId,
  setXpSyncRequested,
} from "./services/guild-config-store.js";
import { startDailyMessagesProcessor } from "./services/daily-messages-service.js";
import { startEventControlScheduler } from "./services/event-control-service.js";
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
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

process.on("unhandledRejection", (reason) => {
  console.error("[discord-bot] Unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[discord-bot] Uncaught exception", error);
});

const xpCooldowns = new Map<string, number>();

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

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] Online as ${readyClient.user.tag}`);
  startReminderScheduler();
  startVoiceXpTracker();
  startXpSyncChecker();
  startDailyMessagesProcessor(readyClient);
  startEventControlScheduler(readyClient);
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

// Fórmula de XP del API: XP total requerida para alcanzar un nivel.
function xpRequiredForLevel(level: number, levelBaseXp: number): number {
  const n = Math.max(1, Math.floor(level));
  return (levelBaseXp * (n * (n + 1))) / 2;
}

// Barra de progreso de XP hacia el siguiente nivel: ▰▰▱▱ 30%
// Devuelve null si no hay datos suficientes. Si está en el nivel máximo,
// la barra queda llena.
function buildXpProgressBar(
  xp: number,
  level: number,
  levelBaseXp: number,
  maxLevel: number,
): string | null {
  if (xp <= 0 || levelBaseXp <= 0) {
    return null;
  }

  const isMax = maxLevel > 0 && level >= maxLevel;
  if (isMax) {
    return "▰▰▰▰▰▰▰▰▰▰ **Nivel máximo**";
  }

  const currentLevelXp = xpRequiredForLevel(level, levelBaseXp);
  const nextLevelXp = xpRequiredForLevel(level + 1, levelBaseXp);
  const span = nextLevelXp - currentLevelXp;
  if (span <= 0) {
    return null;
  }

  const intoLevel = Math.max(0, xp - currentLevelXp);
  const ratio = Math.min(1, intoLevel / span);
  const barTotal = 10;
  const filled = Math.round(ratio * barTotal);
  const bar = "▰".repeat(filled) + "▱".repeat(barTotal - filled);
  const percent = Math.floor(ratio * 100);

  return `${bar} **${percent}%** · ${xp - currentLevelXp} / ${span} XP`;
}

// /profile: muestra el perfil del miembro (el propio por defecto) como
// embed en el canal donde se usa.
async function handleProfileCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo se puede usar dentro de un servidor.",
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario") ?? interaction.user;
  const member = await interaction.guild.members
    .fetch(targetUser.id)
    .catch(() => null);
  if (!member) {
    await interaction.reply({
      content: "No se pudo obtener ese miembro.",
      ephemeral: true,
    });
    return;
  }

  const avatarUrl = member.displayAvatarURL({ size: 256 });

  // El banner a veces no viene en el objeto del miembro que devuelve
  // Discord. Buscamos el user fresco (GET /users/:id) que incluye el
  // banner público si el usuario lo tiene habilitado.
  let bannerUser = member.user;
  try {
    const freshUser = await interaction.client.users.fetch(targetUser.id, {
      force: true,
    });
    if (freshUser.banner) {
      bannerUser = freshUser;
    }
  } catch {
    // Si falla, seguimos con el user que trae el miembro.
  }
  const bannerUrl = bannerUser.bannerURL({ size: 1024 }) ?? null;

  let xpInfo: {
    level: number;
    messageCount: number;
    userId: string;
    voiceMinutes: number;
    xp: number;
  } | null = null;
  let xpConfig: XpConfig | null = null;
  try {
    const profiles = await fetchRemoteXpProfiles(interaction.guildId);
    xpInfo =
      profiles.find((profile) => profile.userId === targetUser.id) ?? null;
  } catch {
    xpInfo = null;
  }
  try {
    xpConfig = await fetchRemoteXpConfig(interaction.guildId);
  } catch {
    xpConfig = null;
  }

  const highestRoleColor = member.roles.highest?.color ?? 0;
  const embedColor =
    highestRoleColor !== 0
      ? highestRoleColor
      : (bannerUser.accentColor ?? 0x6aa8ff);

  const embed = new EmbedBuilder()
    .setAuthor({ name: member.displayName, iconURL: avatarUrl })
    .setColor(embedColor)
    .setThumbnail(avatarUrl);

  if (bannerUrl) {
    embed.setImage(bannerUrl);
  }

  const fields: Array<{ inline: boolean; name: string; value: string }> = [];
  fields.push({
    inline: true,
    name: "Usuario",
    value: `@${member.user.username}`,
  });
  if (member.premiumSince) {
    fields.push({ inline: true, name: "Booster", value: "💎 Sí" });
  }
  if (member.joinedAt) {
    fields.push({
      inline: true,
      name: "Desde",
      value: member.joinedAt.toLocaleDateString("es-AR"),
    });
  }
  if (xpInfo) {
    fields.push({ inline: true, name: "Nivel", value: String(xpInfo.level) });
    fields.push({ inline: true, name: "XP", value: String(xpInfo.xp) });
    fields.push({
      inline: true,
      name: "Mensajes",
      value: String(xpInfo.messageCount),
    });
    const hours = Math.floor(xpInfo.voiceMinutes / 60);
    const minutes = xpInfo.voiceMinutes % 60;
    fields.push({
      inline: true,
      name: "Voz",
      value: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
    });

    const maxLevel = xpConfig?.maxLevel ?? 0;
    const nextLevelTarget =
      maxLevel > 0 ? Math.min(xpInfo.level + 1, maxLevel) : xpInfo.level + 1;
    const progress = buildXpProgressBar(
      xpInfo.xp,
      xpInfo.level,
      xpConfig?.levelBaseXp ?? 100,
      maxLevel,
    );
    if (progress) {
      fields.push({
        inline: false,
        name: `Progreso al nivel ${nextLevelTarget}`,
        value: progress,
      });
    }
  }
  const roles = member.roles.cache
    .filter((role) => role.id !== interaction.guildId)
    .sort((left, right) => right.position - left.position);
  if (roles.size > 0) {
    fields.push({
      inline: false,
      name: "Roles",
      value: roles
        .map((role) => `<@&${role.id}>`)
        .join(" ")
        .slice(0, 1000),
    });
  }
  embed.setFields(fields);

  await interaction.reply({ embeds: [embed] });
}

// Descarga un avatar de Discord y lo devuelve como Buffer (o null si falla).
// Se usa el primer frame del GIF si el avatar es animado (loadImage soporta gif).
async function fetchAvatarBuffer(member: {
  displayAvatarURL: (options: {
    extension: "png" | "gif";
    forceStatic?: boolean;
    size: number;
  }) => string;
}): Promise<Buffer | null> {
  try {
    const hash = (member as { user?: { avatar?: string | null } }).user?.avatar;
    const isAnimated = Boolean(hash?.startsWith("a_"));
    const url = member.displayAvatarURL({
      extension: isAnimated ? "gif" : "png",
      forceStatic: false,
      size: 128,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

// Registra las fuentes (emoji + texto) en el canvas. En el contenedor
// Linux las rutas típicas son /usr/share/fonts/...; si no existen, canvas
// usa el fallback del sistema (funciona en Windows/macOS).
let fontsRegistered = false;
function registerBannerFonts(): void {
  if (fontsRegistered) {
    return;
  }
  fontsRegistered = true;

  const candidates: Array<{ path: string; name: string }> = [
    {
      path: "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
      name: "Noto Color Emoji",
    },
    {
      path: "/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
      name: "Noto Emoji",
    },
    {
      path: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      name: "DejaVu Sans",
    },
  ];

  for (const candidate of candidates) {
    try {
      GlobalFonts.registerFromPath(candidate.path, candidate.name);
    } catch {
      // Ruta no disponible: el fallback del sistema la cubre.
    }
  }
}

// Construye un banner PNG con el podio (top 3): avatares + nombre + nivel + XP.
// Estilo inspirado en la web (barra de progreso, anillos y nombres por posición).
async function buildPodiumBanner(
  podium: Array<{
    entry: { level: number; messageCount: number; xp: number };
    member: { displayName: string } | null;
  }>,
  levelBaseXp: number,
  maxLevel: number,
): Promise<Buffer | null> {
  if (podium.length === 0) {
    return null;
  }

  registerBannerFonts();

  const medals = ["🥇", "🥈", "🥉"];
  // Colores por posición: oro / plata / bronce (anillos y nombre).
  const ringColors = ["#ffd34d", "#c8d6e5", "#e08a5c"];
  const width = 900;
  const cardWidth = width / 3;
  const cardHeight = 330;

  try {
    const canvas = createCanvas(width, cardHeight);
    const ctx = canvas.getContext("2d");

    // Fondo: degradado con toques de neón (azul → violeta, estilo web).
    const bg = ctx.createLinearGradient(0, 0, width, cardHeight);
    bg.addColorStop(0, "#070d1d");
    bg.addColorStop(0.5, "#0f1330");
    bg.addColorStop(1, "#1a1030");
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, width, cardHeight, 20);
    ctx.fill();

    // Glows radiales decorativos en el fondo.
    const glow1 = ctx.createRadialGradient(
      width * 0.2,
      40,
      0,
      width * 0.2,
      40,
      260,
    );
    glow1.addColorStop(0, "rgba(106,168,255,0.18)");
    glow1.addColorStop(1, "rgba(106,168,255,0)");
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, width, cardHeight);
    const glow2 = ctx.createRadialGradient(
      width * 0.85,
      40,
      0,
      width * 0.85,
      40,
      260,
    );
    glow2.addColorStop(0, "rgba(255,138,92,0.16)");
    glow2.addColorStop(1, "rgba(255,138,92,0)");
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, width, cardHeight);

    // Título (con banda propia arriba, fuera del alcance de los anillos).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 26px "DejaVu Sans", "Noto Color Emoji", sans-serif';
    ctx.fillStyle = "#edf2ff";
    ctx.shadowColor = "rgba(106,168,255,0.7)";
    ctx.shadowBlur = 16;
    ctx.fillText("TOP 3 ranks comunidad", width / 2, 26);
    ctx.shadowBlur = 0;

    // Descargamos los avatares en paralelo.
    const avatarBuffers = await Promise.all(
      podium.map((item) =>
        item.member
          ? fetchAvatarBuffer(item.member as never).catch(() => null)
          : Promise.resolve(null),
      ),
    );
    const avatarImages = await Promise.all(
      avatarBuffers.map((buffer) =>
        buffer ? loadImage(buffer).catch(() => null) : Promise.resolve(null),
      ),
    );

    for (let index = 0; index < podium.length; index += 1) {
      const item = podium[index];
      const cx = cardWidth * index + cardWidth / 2;
      const avatarY = 100;
      const avatarRadius = 42;

      // Tarjeta.
      ctx.fillStyle = "rgba(20,26,44,0.85)";
      roundRect(
        ctx,
        cardWidth * index + 12,
        60,
        cardWidth - 24,
        cardHeight - 70,
        18,
      );
      ctx.fill();
      ctx.strokeStyle = "rgba(133,156,212,0.25)";
      ctx.lineWidth = 1;
      roundRect(
        ctx,
        cardWidth * index + 12,
        60,
        cardWidth - 24,
        cardHeight - 70,
        18,
      );
      ctx.stroke();

      // Medalla.
      ctx.font = "28px sans-serif";
      ctx.fillText(medals[index] ?? "", cx, 74);

      // Anillo de posición alrededor del avatar.
      ctx.beginPath();
      ctx.arc(cx, avatarY, avatarRadius + 6, 0, Math.PI * 2);
      ctx.fillStyle = ringColors[index] ?? "#6aa8ff";
      ctx.shadowColor = ringColors[index] ?? "#6aa8ff";
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Avatar (recortado en círculo).
      const avatarImage = avatarImages[index];
      if (avatarImage) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, avatarY, avatarRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(
          avatarImage,
          cx - avatarRadius,
          avatarY - avatarRadius,
          avatarRadius * 2,
          avatarRadius * 2,
        );
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(cx, avatarY, avatarRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#2a2f42";
        ctx.fill();
      }

      // Nombre con el color de la posición (oro / plata / bronce) + glow.
      const name =
        item.member?.displayName || String(item.entry.xp).slice(0, 8);
      const positionColor = ringColors[index] ?? "#edf2ff";
      ctx.font =
        'bold 21px "DejaVu Sans", "Noto Color Emoji", "Noto Emoji", sans-serif';
      ctx.fillStyle = positionColor;
      ctx.shadowColor = positionColor;
      ctx.shadowBlur = 10;
      ctx.fillText(
        truncateText(ctx, name, cardWidth - 36),
        cx,
        avatarY + avatarRadius + 30,
      );
      ctx.shadowBlur = 0;

      // Nivel y XP.
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "#b2bdd8";
      ctx.fillText(
        `Nivel ${item.entry.level}  ·  ${item.entry.xp} XP`,
        cx,
        avatarY + avatarRadius + 56,
      );

      // Barra de progreso hacia el siguiente nivel.
      drawXpBar(
        ctx,
        item.entry.xp,
        item.entry.level,
        levelBaseXp,
        maxLevel,
        cx - 80,
        avatarY + avatarRadius + 78,
        160,
      );
    }

    return canvas.toBuffer("image/png");
  } catch (error) {
    console.error("[discord-bot] Failed to build podium banner", {
      error: getErrorMessage(error),
    });
    return null;
  }
}

// Dibuja una barra de progreso de XP (hacia el siguiente nivel) en el canvas.
function drawXpBar(
  ctx: SKRSContext2D,
  xp: number,
  level: number,
  levelBaseXp: number,
  maxLevel: number,
  x: number,
  y: number,
  width: number,
): void {
  const height = 8;
  const radius = height / 2;

  // Fondo de la barra.
  ctx.fillStyle = "rgba(133,156,212,0.18)";
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();

  if (xp <= 0 || levelBaseXp <= 0) {
    return;
  }

  const isMax = maxLevel > 0 && level >= maxLevel;
  let ratio = 1;
  if (!isMax) {
    const currentLevelXp = xpRequiredForLevel(level, levelBaseXp);
    const nextLevelXp = xpRequiredForLevel(level + 1, levelBaseXp);
    const span = nextLevelXp - currentLevelXp;
    if (span > 0) {
      ratio = Math.min(1, Math.max(0, (xp - currentLevelXp) / span));
    }
  }

  const fillWidth = Math.max(height, Math.round(width * ratio));
  const fillGradient = ctx.createLinearGradient(x, 0, x + width, 0);
  fillGradient.addColorStop(0, "#6aa8ff");
  fillGradient.addColorStop(1, "#ff8a5c");
  ctx.fillStyle = fillGradient;
  ctx.shadowColor = "rgba(106,168,255,0.6)";
  ctx.shadowBlur = 8;
  roundRect(ctx, x, y, fillWidth, height, radius);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// Dibuja un rectángulo redondeado en el canvas (ruta, sin rellenar).
function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Trunca un texto con "…" para que entre en el ancho disponible.
function truncateText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let truncated = text;
  while (
    truncated.length > 1 &&
    ctx.measureText(`${truncated}…`).width > maxWidth
  ) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

// /ranking: muestra el top 20 del ranking de XP en Discord. El podio (top 3)
async function handleRankingCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo se puede usar dentro de un servidor.",
      ephemeral: true,
    });
    return;
  }

  let profiles: Array<{
    level: number;
    messageCount: number;
    userId: string;
    voiceMinutes: number;
    xp: number;
  }> = [];
  try {
    profiles = await fetchRemoteXpProfiles(interaction.guildId);
  } catch (error) {
    await interaction.reply({
      content: `No se pudo obtener el ranking: ${getErrorMessage(error)}`,
      ephemeral: true,
    });
    return;
  }

  if (profiles.length === 0) {
    await interaction.reply({
      content: "Todavía no hay XP registrado en este servidor.",
      ephemeral: true,
    });
    return;
  }

  // Resolvemos los miembros de una vez para tener nick + avatar.
  const members = await interaction.guild.members.fetch().catch(() => null);

  // Config de XP (para la barra de progreso y el color por nivel).
  let xpConfig: XpConfig | null = null;
  try {
    xpConfig = await fetchRemoteXpConfig(interaction.guildId);
  } catch {
    xpConfig = null;
  }

  const sorted = [...profiles].sort((left, right) => right.xp - left.xp);
  const top = sorted.slice(0, 20);

  // Banner del podio (top 3 con avatares) en una sola imagen.
  const podiumPng = await buildPodiumBanner(
    top.slice(0, 3).map((entry) => ({
      entry,
      member: members?.get(entry.userId) ?? null,
    })),
    xpConfig?.levelBaseXp ?? 100,
    xpConfig?.maxLevel ?? 0,
  );

  const embeds: EmbedBuilder[] = [];
  const bannerEmbed = new EmbedBuilder()
    .setColor(0x6aa8ff)
    .setTitle("🏆 Ranking de XP — Top 20");
  if (podiumPng) {
    bannerEmbed.setImage("attachment://podium.png");
    embeds.push(bannerEmbed);
  } else {
    // Fallback: si no se pudo generar el banner, mostramos el podio en texto.
    const medals = ["🥇", "🥈", "🥉"];
    const podiumLines = top.slice(0, 3).map((entry, index) => {
      const member = members?.get(entry.userId);
      const name = member?.displayName || entry.userId;
      return `${medals[index]} **${name}** · Nv ${entry.level} · ${entry.xp} XP`;
    });
    bannerEmbed.setDescription(podiumLines.join("\n"));
    embeds.push(bannerEmbed);
  }

  // Resto (4-20): tabla compacta.
  const restLines = top.slice(3).map((entry, index) => {
    const rank = index + 4;
    const member = members?.get(entry.userId);
    const name = member?.displayName || entry.userId;
    return `${rank}. **${name}** · Nv ${entry.level} · ${entry.xp} XP`;
  });
  if (restLines.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0x6aa8ff)
        .setTitle("Resto del top 20")
        .setDescription(restLines.join("\n")),
    );
  }

  // Footer con la posición del que ejecutó el comando.
  const callerProfile = profiles.find(
    (profile) => profile.userId === interaction.user.id,
  );
  if (callerProfile && embeds.length > 0) {
    const callerRank =
      sorted.findIndex((entry) => entry.userId === interaction.user.id) + 1;
    const callerMember = members?.get(interaction.user.id);
    const callerName = callerMember?.displayName || interaction.user.username;
    embeds[embeds.length - 1].setFooter({
      text: `Tu posición: #${callerRank} · ${callerName} · Nv ${callerProfile.level} · ${callerProfile.xp} XP`,
    });
  }

  const files =
    podiumPng && embeds[0]
      ? [new AttachmentBuilder(podiumPng, { name: "podium.png" })]
      : [];
  await interaction.reply({ embeds, files });
}

// Mensajes del mayordomo de Karpindomo al desperuanizar/reperuanizar una
// sala de voz. {user} se reemplaza con la mención de quien ejecutó el comando.
const BAN_CHANNEL_BUTLER_MESSAGES = [
  "🎩 Acabo de desperuanizar la sala, {user}. Es segura, nadie no deseado entrará.",
  "🗝️ {user} desperuanizó la sala. Los roles desperuanizados ya no podrán verla.",
  "🕯️ Puertas cerradas, señor. {user} dejó esta sala reservada.",
  "🪄 Listo: {user} desperuanizó la sala, ya no es visible para los roles desperuanizados.",
  "🚪 Desperuanizada por {user}. Aquí solo entra quien debe entrar.",
];

const UNBAN_CHANNEL_BUTLER_MESSAGES = [
  "🎩 {user} reperuanizó la sala. Todos pueden volver a verla.",
  "🔓 Puertas abiertas de nuevo, señor. {user} la volvió a abrir.",
  "🪄 Reperuanizada por {user}: los roles desperuanizados ya pueden ver esta sala.",
  "🗝️ Listo, {user} reperuanizó la sala, vuelve a estar disponible para todos.",
];

// Sufijo que se agrega/quita al nombre de la sala al desperuanizar.
const PERU_FLAG_SUFFIX = " 🚫🇵🇪";

// /desperuanizar y /reperuanizar: ocultan o revelan una sala de voz
// dinámica a los roles vetados configurados en el panel de admin.
async function handleVoiceBanCommand(
  interaction: ChatInputCommandInteraction,
  ban: boolean,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo se puede usar dentro de un servidor.",
      ephemeral: true,
    });
    return;
  }

  // Diferimos la respuesta para evitar el timeout de 3s de Discord: la
  // actualización de permisos + rename puede tardar (rate limits del canal)
  // y sin defer la interacción expira con "La aplicación no respondió".
  // Importante: TODO el cuerpo va dentro de try/catch para que SIEMPRE
  // terminemos respondiendo (editReply). Si algo lanza un error sin capturar,
  // la interacción quedaría "pensando…" para siempre.
  await interaction.deferReply();

  try {
    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (!member) {
      await interaction.editReply({
        content: "No pude obtener tu perfil de miembro.",
      });
      return;
    }

    const voiceChannelId = member.voice.channelId ?? null;
    if (!voiceChannelId) {
      await interaction.editReply({
        content: "Tenés que estar en una sala de voz para usar este comando.",
      });
      return;
    }

    const isTemporary = await isTemporaryVoiceChannel(
      interaction.guildId,
      voiceChannelId,
    );
    if (!isTemporary) {
      await interaction.editReply({
        content:
          "Este comando solo funciona en salas de voz dinámicas creadas por Karpindomo.",
      });
      return;
    }

    const config = await getGuildConfig(interaction.guildId);
    const bannedRoleIds = config.bannedVoiceRoleIds ?? [];
    if (bannedRoleIds.length === 0) {
      await interaction.editReply({
        content:
          "No hay roles vetados configurados. Agregalos en el panel de Admin → Configuración.",
      });
      return;
    }

    const channel = await interaction.guild.channels
      .fetch(voiceChannelId)
      .catch(() => null);
    if (!channel?.isVoiceBased()) {
      await interaction.editReply({
        content: "No pude acceder al canal de voz.",
      });
      return;
    }

    if (ban) {
      // Desperuanizar: ocultar el canal a los roles vetados. Serializamos y
      // esperamos entre edits para no disparar rate limits de Discord por
      // canal (limite de overwrites por segundo).
      for (const roleId of bannedRoleIds) {
        await channel.permissionOverwrites.edit(roleId, {
          ViewChannel: false,
        });
        await sleep(350);
      }
    } else {
      // Reperuanizar: ELIMINAR el overwrite restrictivo para que el canal
      // vuelva a heredar los permisos del padre (estado original). Editar
      // con ViewChannel:null no siempre revierte bien y dejaba el canal
      // inconsistente.
      for (const roleId of bannedRoleIds) {
        const overwrite = channel.permissionOverwrites.cache.get(roleId);
        if (overwrite) {
          await channel.permissionOverwrites.delete(roleId);
          await sleep(350);
        }
      }
    }

    // Marca la sala en el nombre: agregamos/quítamos el sufijo de la bandera.
    try {
      const currentName = channel.name;
      if (ban) {
        if (!currentName.endsWith(PERU_FLAG_SUFFIX)) {
          await channel.setName(`${currentName}${PERU_FLAG_SUFFIX}`);
        }
      } else if (currentName.endsWith(PERU_FLAG_SUFFIX)) {
        await channel.setName(currentName.slice(0, -PERU_FLAG_SUFFIX.length));
      }
    } catch (error) {
      console.error("[discord-bot] Failed to rename channel", {
        guildId: interaction.guildId,
        channelId: voiceChannelId,
        error,
      });
    }

    const messages = ban
      ? BAN_CHANNEL_BUTLER_MESSAGES
      : UNBAN_CHANNEL_BUTLER_MESSAGES;
    const template = pickRandom(messages);
    await interaction.editReply({
      content: template.replace("{user}", interaction.user.toString()),
    });
  } catch (error) {
    console.error(
      "[discord-bot] handleVoiceBanCommand failed (respondiendo de todos modos)",
      {
        guildId: interaction.guildId,
        error,
      },
    );
    await interaction
      .editReply({
        content:
          "Ocurrió un error al actualizar la sala. Revisá que el bot tenga permiso de Gestionar Canales y volvé a intentar.",
      })
      .catch(() => {
        // Si ni siquiera podemos editar la respuesta, no queda nada por hacer.
      });
  }
}

// Mensajes del mayordomo de Karpindomo al trancar/destrancar una sala.
const LOCK_CHANNEL_BUTLER_MESSAGES = [
  "🔒 Sala trancada, {user}. Nadie más va a poder entrar.",
  "🗝️ {user} trancó la sala. Los que ya están adentro se quedan, nadie más entra.",
  "🚪 Puerta con llave, señor. {user} dejó esta sala trancada.",
];

const UNLOCK_CHANNEL_BUTLER_MESSAGES = [
  "🔓 Sala destrancada, {user}. Ya puede entrar cualquiera.",
  "🗝️ {user} destrancó la sala. Vuelve a estar abierta para todos.",
  "🚪 Puerta abierta de nuevo, señor. {user} la destrancó.",
];

// Sufijo que se agrega/quita al nombre de la sala al trancar.
const LOCK_SUFFIX = " 🔒";

// /lock y /unlock: trancan o destrancan una sala de voz dinámica para
// @everyone (a diferencia de /desperuanizar, que solo oculta a roles
// vetados). Quienes ya están adentro se quedan; nadie nuevo puede entrar.
async function handleVoiceLockCommand(
  interaction: ChatInputCommandInteraction,
  lock: boolean,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo se puede usar dentro de un servidor.",
      ephemeral: true,
    });
    return;
  }

  // Ver el comentario equivalente en handleVoiceBanCommand: deferimos para
  // evitar el timeout de 3s y todo el cuerpo va en try/catch para siempre
  // terminar respondiendo.
  await interaction.deferReply();

  try {
    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (!member) {
      await interaction.editReply({
        content: "No pude obtener tu perfil de miembro.",
      });
      return;
    }

    const voiceChannelId = member.voice.channelId ?? null;
    if (!voiceChannelId) {
      await interaction.editReply({
        content: "Tenés que estar en una sala de voz para usar este comando.",
      });
      return;
    }

    const isTemporary = await isTemporaryVoiceChannel(
      interaction.guildId,
      voiceChannelId,
    );
    if (!isTemporary) {
      await interaction.editReply({
        content:
          "Este comando solo funciona en salas de voz dinámicas creadas por Karpindomo.",
      });
      return;
    }

    const channel = await interaction.guild.channels
      .fetch(voiceChannelId)
      .catch(() => null);
    if (!channel?.isVoiceBased()) {
      await interaction.editReply({
        content: "No pude acceder al canal de voz.",
      });
      return;
    }

    const everyoneRoleId = interaction.guild.roles.everyone.id;
    if (lock) {
      await channel.permissionOverwrites.edit(everyoneRoleId, {
        Connect: false,
      });
    } else {
      const overwrite = channel.permissionOverwrites.cache.get(everyoneRoleId);
      if (overwrite) {
        await channel.permissionOverwrites.delete(everyoneRoleId);
      }
    }

    // Marca la sala en el nombre: agregamos/quitamos el candado.
    try {
      const currentName = channel.name;
      if (lock) {
        if (!currentName.endsWith(LOCK_SUFFIX)) {
          await channel.setName(`${currentName}${LOCK_SUFFIX}`);
        }
      } else if (currentName.endsWith(LOCK_SUFFIX)) {
        await channel.setName(currentName.slice(0, -LOCK_SUFFIX.length));
      }
    } catch (error) {
      console.error("[discord-bot] Failed to rename channel", {
        guildId: interaction.guildId,
        channelId: voiceChannelId,
        error,
      });
    }

    const messages = lock
      ? LOCK_CHANNEL_BUTLER_MESSAGES
      : UNLOCK_CHANNEL_BUTLER_MESSAGES;
    const template = pickRandom(messages);
    await interaction.editReply({
      content: template.replace("{user}", interaction.user.toString()),
    });
  } catch (error) {
    console.error(
      "[discord-bot] handleVoiceLockCommand failed (respondiendo de todos modos)",
      {
        guildId: interaction.guildId,
        error,
      },
    );
    await interaction
      .editReply({
        content:
          "Ocurrió un error al actualizar la sala. Revisá que el bot tenga permiso de Gestionar Canales y volvé a intentar.",
      })
      .catch(() => {
        // Si ni siquiera podemos editar la respuesta, no queda nada por hacer.
      });
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  // Botones/selects de inscripción a eventos (embed del Módulo X).
  if (
    (interaction.isButton() || interaction.isStringSelectMenu()) &&
    interaction.customId.startsWith("eventsign:")
  ) {
    await handleEventSignupInteraction(interaction).catch((error) => {
      console.error("[event-signup] error al procesar interacción", error);
    });
    return;
  }

  // Modal para poner/editar el personaje de una inscripción (Módulo X).
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("eventsign:")
  ) {
    await handleEventSignupCharacterSubmit(interaction).catch((error) => {
      console.error("[event-signup] error al procesar modal", error);
    });
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

  if (interaction.commandName === "profile") {
    await handleProfileCommand(interaction);
    return;
  }

  if (interaction.commandName === "ranking") {
    await handleRankingCommand(interaction);
    return;
  }

  if (interaction.commandName === "desperuanizar") {
    await handleVoiceBanCommand(interaction, true);
    return;
  }

  if (interaction.commandName === "reperuanizar") {
    await handleVoiceBanCommand(interaction, false);
    return;
  }

  if (interaction.commandName === "lock") {
    await handleVoiceLockCommand(interaction, true);
    return;
  }

  if (interaction.commandName === "unlock") {
    await handleVoiceLockCommand(interaction, false);
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

// ── Karuta: detector de drops raros ────────────────────────────────
// Karuta es un bot para coleccionar cartas de anime. Usamos el prefijo
// "k" (kdrop, kd, etc.). Cuando un drop saca una carta rara, Karuta
// responde con un embed. Lo detectamos, evaluamos si es "rara" según los
// umbrales configurables y lo guardamos en la API + anunciamos en el canal
// vigilado. No requiere subir nada manualmente: es seamless.
const DEFAULT_KARUTA_BOT_USER_ID = "646937666251915264";

type KarutaEmbed = {
  author?: { name?: string } | null;
  description?: string | null;
  fields?: Array<{ name: string; value: string }>;
  footer?: { text?: string } | null;
  image?: { url?: string } | null;
  thumbnail?: { url?: string } | null;
  title?: string | null;
};

type ParsedKarutaGrab = {
  cardName: string;
  code: string;
  mentionedUserId?: string;
};

// Grab confirmado: "@X took the <name> card `<code>`! It's in good condition."
// Es texto plano (sin embed). En message.content la mención viene como <@ID>.
function parseKarutaGrab(content: string): ParsedKarutaGrab | null {
  const match = content.match(
    /<@!?(\d+)>\s+took the\s+(.+?)\s+card\s+`([A-Za-z0-9]+)`/i,
  );
  if (!match) {
    return null;
  }
  const cardName = match[2].trim();
  const code = match[3];
  if (!cardName || !code) {
    return null;
  }
  return { cardName, code, mentionedUserId: match[1] };
}

// Cache de wishlists que Card Companion anuncia al droppear. Karuta no
// muestra la wishlist en kv, así que la tomamos de acá cuando alguien agarra
// la carta. Clave: guildId:channelId:nombre (lowercase).
const pendingCardCompanionWishlists = new Map<
  string,
  { wishlist: number; at: number }
>();

type ParsedCardCompanionLine = {
  cardName: string;
  series?: string;
  wishlistCount?: number;
};

// Card Companion, al droppear, postea una lista con la wishlist de cada
// carta. El formato fue cambiando con el tiempo; soportamos los que se han
// visto en producción:
//   - Markdown viejo: ![🃏](icono) ![:no_N:](emoji) `♡` `N` · **Nombre** · Serie
//   - Plano (2025):   1 ⭐ 1 🃏 124 - Caesar King - Zenless Zone Zero
//   - Con ♡ (2026):   🃏 :no_1: ♡ 0 · Nabuo Tanaka · Memories
//                     ⭐ :no_3: ♡ 191 · Kuromi · Onegai My Melody Sukkiri
//                     [icono] 3 ♡ 17 : Aria Kisaki - 2.5 Dimensional Seduction
// En todos, la wishlist es el número tras `♡` (o antes de " - ") y el
// nombre va antes de la serie (separador ·, : o " - " según el formato).
function parseCardCompanionDrop(content: string): ParsedCardCompanionLine[] {
  const lines: ParsedCardCompanionLine[] = [];

  // ── Formato con backticks (el actual y el histórico) ──
  //   `♡` `N` · **Nombre** · Serie
  // Card Companion cambió el layout varias veces: a veces cada carta va en su
  // propia línea y a veces TODAS van en una sola línea (separadas por un
  // espacio, que Discord muestra envueltas visualmente). Antes iterábamos por
  // líneas y, si todo venía en una sola línea, solo se parseaba la primera
  // carta y el resto quedaba pegado como "serie" (con lo que se perdían las
  // cartas raras de posiciones posteriores). Por eso ahora buscamos TODOS los
  // segmentos con un regex global sobre el contenido completo (unimos líneas
  // en un espacio, así da igual si vienen separadas o juntas). La serie de una
  // carta termina donde empieza la siguiente: su marcador de posición
  // `:no_N:` / `<:no_N:id>` (precedido del icono de rareza) o el trailer
  // "Drop expires".
  const flatContent = content.replace(/\r?\n/g, " ");
  const backtickSegmentRe =
    /`♡`\s*`(\d+)`\s*·\s*\*\*(.+?)\*\*\s*·\s*(.*?)(?=\s*(?:\p{Extended_Pictographic}\s*)?(?:<a?:no_\d+:\d+>|:no_\d+:)\s*`♡`|\s*Drop expires|$)/gu;

  for (const match of flatContent.matchAll(backtickSegmentRe)) {
    const cardName = match[2].trim();
    if (!cardName) {
      continue;
    }
    lines.push({
      cardName,
      series: match[3].trim() || undefined,
      wishlistCount: Number(match[1]),
    });
  }

  if (lines.length > 0) {
    return lines;
  }

  // Fallback: formatos legacy SIN backticks, procesados por línea.
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    // Línea con wishlist (♡). Card Companion cambió el layout varias veces:
    //   "🃏 :no_1: ♡ 0 · Nabuo Tanaka · Memories"
    //   "⭐ :no_3: ♡ 191 · Kuromi · Onegai My Melody Sukkiri"
    //   "3 ♡ 17 : Aria Kisaki - 2.5 Dimensional Seduction"
    // En todas la wishlist es el número tras ♡ y el nombre va antes de la
    // serie (separada por ·, : o " - " según el formato de turno).
    const heartMatch = line.match(/♡\s*(\d+)/);
    if (heartMatch) {
      const wishlistCount = Number(heartMatch[1]);
      const tail = line.slice((heartMatch.index ?? 0) + heartMatch[0].length);
      const text = tail.replace(/^[\s:·|>]+/, "").trim();
      if (text) {
        const sepMatch =
          text.match(/^(.*?)\s+(?:·|:)\s+(.*)$/) ??
          text.match(/^(.*?)\s+[-–—]\s+(.*)$/);
        lines.push({
          cardName: (sepMatch?.[1] ?? text).trim(),
          series: sepMatch?.[2]?.trim() || undefined,
          wishlistCount,
        });
        continue;
      }
    }

    // Formato plano (2025): "N [estrellas] 🃏 <wishlist> - <nombre> - <serie>".
    // La wishlist es el último número antes del primer " - ".
    const plainMatch = line.match(
      /^\d+\s+.*\s(\d+)\s*-\s*([^-]+?)\s*-\s*(.+)$/,
    );
    if (plainMatch) {
      lines.push({
        wishlistCount: Number(plainMatch[1]),
        cardName: plainMatch[2].trim(),
        series: plainMatch[3].trim() || undefined,
      });
    }
  }

  // Diagnóstico: un mensaje de bot con indicios de wishlist ("♡", con o sin
  // backticks) que no matchea NINGÚN formato probablemente significa que
  // Card Companion cambió el suyo otra vez. Lo volcamos (recortado) para
  // poder adaptar el parser sin adivinar.
  if (lines.length === 0 && content.includes("♡")) {
    console.warn(
      `[discord-bot] Card Companion sin parsear (formato nuevo?): ${content.slice(0, 500).replace(/\n/g, " ⏎ ")}`,
    );
  }

  return lines;
}

function rememberCardCompanionWishlists(
  guildId: string,
  channelId: string,
  lines: ParsedCardCompanionLine[],
): void {
  const now = Date.now();
  for (const line of lines) {
    if (line.wishlistCount === undefined || !line.cardName) {
      continue;
    }
    const key = `${guildId}:${channelId}:${line.cardName.toLowerCase()}`;
    pendingCardCompanionWishlists.set(key, {
      wishlist: line.wishlistCount,
      at: now,
    });
  }

  // Limpieza: sacamos entradas con más de 15 minutos.
  for (const [key, entry] of pendingCardCompanionWishlists) {
    if (now - entry.at > 15 * 60 * 1000) {
      pendingCardCompanionWishlists.delete(key);
    }
  }
}

// Anuncio de drops raros detectados desde Card Companion. No requiere que
// nadie agarre la carta: se dispara apenas Card Companion lista el drop.
function buildKarutaRareDropAnnouncement(
  lines: ParsedCardCompanionLine[],
): string {
  const items = lines.map(
    (line) =>
      `🎴 **${line.cardName}**${line.series ? ` · ${line.series}` : ""} — 🔥 ${line.wishlistCount} en wishlist`,
  );
  return `✨ ¡Drop raro detectado!\n${items.join("\n")}`;
}

async function announceKarutaRareDrops(
  message: Message,
  lines: ParsedCardCompanionLine[],
): Promise<void> {
  const channel = message.channel;
  if (!isSendableTextChannelLike(channel)) {
    return;
  }
  try {
    await channel.send(buildKarutaRareDropAnnouncement(lines));
  } catch (error) {
    console.warn(
      `[discord-bot] No se pudo anunciar drop raro: ${getErrorMessage(error)}`,
    );
  }
}

// Registra un drop en el feed de la web (sin code: viene de Card Companion).
async function postKarutaDrop(
  guildId: string,
  drop: {
    cardName?: string;
    series?: string;
    sourceMessageId: string;
    wishlistCount?: number;
  },
): Promise<boolean> {
  const baseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
  const token = env.BOT_CONFIG_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return false;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl}/internal/guilds/${encodeURIComponent(guildId)}/karuta/drops`,
      {
        body: JSON.stringify({
          cardName: drop.cardName,
          reasons: [`${drop.wishlistCount ?? "?"} wishlists`],
          series: drop.series,
          sourceMessageId: drop.sourceMessageId,
          wishlistCount: drop.wishlistCount,
        }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": token,
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[discord-bot] Karuta drop POST falló (${response.status}) para guild ${guildId}.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Karuta drop POST error: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

type ParsedKarutaKv = {
  cardName?: string;
  code: string;
  edition?: number;
  imageUrl?: string;
  ownerUserId?: string;
  ownerUsername?: string;
  printNumber?: number;
  series?: string;
  wishlistCount?: number;
};

// Limpia el "owned by" para quedarnos solo con el username (saca emojis
// decorativos tipo 👑, ⭐, etc. y el "@" inicial).
function normalizeKarutaUsername(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw
    .replace(/^@+/, "")
    .replace(/[^\w\s.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

// Limpia markdown residual de nombres/series de Karuta (backticks, negrita,
// cursiva, tachado).
function stripKarutaMarkdown(text: string): string {
  return text
    .replace(/[`*~_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// kv → ver una carta. Formato REAL (visto en el embed crudo):
//   Card Details
//   description: "Owned by <@ID>\n\n**`code`** · `★★★★` · `#print` · `◈wish` · serie · **nombre**"
// O sea: el dueño es una MENCIÓN (<@ID>) y la línea resumen usa markdown
// (backticks y negrita). El símbolo de wishlist varía por carta.
function parseKarutaKv(
  embed: KarutaEmbed,
  content: string,
): ParsedKarutaKv | null {
  const allText = [
    content,
    embed.title,
    embed.description,
    embed.author?.name,
    embed.footer?.text,
    ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
  ]
    .filter(Boolean)
    .join("\n");

  const ownedMatch = allText.match(/owned by\s+(.+)/i);
  if (!ownedMatch) {
    return null;
  }

  const ownerRaw = ownedMatch[1].trim();
  let ownerUserId: string | undefined;
  let ownerUsername: string | undefined;
  const mentionMatch = ownerRaw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    ownerUserId = mentionMatch[1];
  } else {
    ownerUsername = normalizeKarutaUsername(ownerRaw);
    if (!ownerUsername) {
      return null;
    }
  }

  // Línea resumen CON markdown:
  //   **`code`** · `★★★☆` · `#print` · `◈edición` · <serie> · **<nombre>**
  // Las estrellas pueden ser llenas (★) o huecas (☆).
  const summaryMatch = allText.match(
    /\*\*`([A-Za-z0-9]{5,32})`\*\*\s*·\s*`([★☆]+)`\s*·\s*`#(\d+)`\s*·\s*`([^`]+)`\s*·\s*(.+)$/m,
  );
  if (!summaryMatch) {
    return null;
  }

  // El NOMBRE va en negrita (**...**); la SERIE es texto plano. El orden
  // entre ambos puede variar. En algunas cartas Karuta repite el code en
  // negrita al final del resumen; si tomáramos el último bold sin filtrar,
  // guardaríamos el code como nombre y la serie quedaría con el nombre real.
  const code = summaryMatch[1];
  const rest = summaryMatch[5].trim();
  const boldTexts = [...rest.matchAll(/\*\*(.+?)\*\*/g)].map((match) =>
    stripKarutaMarkdown(match[1]),
  );

  // Texto plano del resumen: sin segmentos en negrita ni el code repetido.
  const plainText = stripKarutaMarkdown(rest.replace(/\*\*.+?\*\*/g, ""))
    .replace(new RegExp(`\\b${code}\\b`, "gi"), "")
    .replace(/^[·\s—–-]+|[·\s—–-]+$/g, "")
    .trim();

  // Nombre = segmento en negrita que NO es el code. Si no hay ninguno
  // (o solo está el code en negrita), el nombre es el texto plano.
  const nameBold = boldTexts.find(
    (text) => text && text.toLowerCase() !== code.toLowerCase(),
  );
  const cardName = nameBold || plainText || undefined;

  // Serie = texto plano del resumen; si coincide con el nombre, no hay.
  const series =
    plainText && cardName && plainText.toLowerCase() !== cardName.toLowerCase()
      ? plainText
      : undefined;

  return {
    cardName,
    code: summaryMatch[1],
    // El número tras el print (◈5, ♦4, #7, ✦2…) es la EDICIÓN.
    edition: Number(summaryMatch[4].replace(/\D/g, "")),
    imageUrl: embed.image?.url || embed.thumbnail?.url || undefined,
    ownerUserId,
    ownerUsername,
    printNumber: Number(summaryMatch[3]),
    series,
  };
}

type ParsedKarutaBurn = {
  cardName?: string;
  ownerUsername?: string;
};

// kb → quemar una carta. Formato confirmado:
//   Burn Card
//   @ <user>, you will receive:  ...  "The card has been burned."
function parseKarutaBurn(
  embed: KarutaEmbed,
  content: string,
): ParsedKarutaBurn | null {
  const allText = [
    content,
    embed.title,
    embed.description,
    embed.author?.name,
    embed.footer?.text,
    ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
  ]
    .filter(Boolean)
    .join("\n");

  if (!/has been burned/i.test(allText)) {
    return null;
  }

  const ownerMatch =
    allText.match(/@\s*([^\s,]+)\s*,\s*you will receive/i) ??
    allText.match(/([^\s,]+)\s*,\s*you will receive/i);
  const owner = normalizeKarutaUsername(ownerMatch?.[1]);

  // El nombre de la carta no está garantizado en el texto del burn; si
  // aparece en la descripción y no es la línea del owner, lo tomamos.
  const description = embed.description?.trim();
  const cardName =
    description && !/you will receive/i.test(description)
      ? description
      : undefined;

  return { cardName, ownerUsername: owner };
}

type ParsedKarutaTransfer = {
  cardName?: string;
  code: string;
  edition?: number;
  fromUserId?: string;
  printNumber?: number;
  series?: string;
  toUserId?: string;
};

// kg → transferir una carta. Formato (embed, aceptado):
//   Card Transfer
//   <@from> → <@to>
//   code - ★★★★ - #print - ♦edición - serie - nombre
//   "Card transfer has been accepted."
function parseKarutaTransfer(
  embed: KarutaEmbed,
  content: string,
): ParsedKarutaTransfer | null {
  if (embed.title !== "Card Transfer") {
    return null;
  }

  const allText = [
    content,
    embed.title,
    embed.description,
    embed.author?.name,
    embed.footer?.text,
    ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
  ]
    .filter(Boolean)
    .join("\n");

  // Solo nos interesa cuando la transferencia fue ACEPTADA.
  if (!/transfer has been accepted/i.test(allText)) {
    return null;
  }

  const plainText = allText.replace(/[`*~_]/g, "");

  const transferMatch = plainText.match(/<@!?(\d+)>\s*→\s*<@!?(\d+)>/);
  if (!transferMatch) {
    return null;
  }

  // Resumen: code - ★★★★ - #print - ♦edición - serie - nombre
  const summaryMatch = plainText.match(
    /([A-Za-z0-9]{5,32})\s*-\s*([★☆]+)\s*-\s*#(\d+)\s*-\s*(\D*\d+)\s*-\s*(.+?)\s*-\s*(.+)$/m,
  );
  if (!summaryMatch) {
    return null;
  }

  return {
    cardName: summaryMatch[6].trim() || undefined,
    code: summaryMatch[1],
    edition: Number(summaryMatch[4].replace(/\D/g, "")),
    fromUserId: transferMatch[1],
    printNumber: Number(summaryMatch[3]),
    series: summaryMatch[5].trim() || undefined,
    toUserId: transferMatch[2],
  };
}

type ParsedKarutaAlbum = {
  albumName?: string;
  background?: string;
  imageUrl?: string;
  ownerUserId?: string;
  page?: number;
  totalPages?: number;
};

// ka → ver un álbum. Formato (embed):
//   Card Album
//   Album: <nombre>
//   Background: <fondo>
//   Owned by <@ID>
//   (imagen con las cartas)
//   Showing page N of M
function parseKarutaAlbum(
  embed: KarutaEmbed,
  content: string,
): ParsedKarutaAlbum | null {
  if (embed.title !== "Card Album") {
    return null;
  }

  const allText = [
    content,
    embed.title,
    embed.description,
    embed.author?.name,
    embed.footer?.text,
    ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
  ]
    .filter(Boolean)
    .join("\n");

  const albumMatch = allText.match(/album:\s*([^\n]+)/i);
  if (!albumMatch) {
    return null;
  }

  const backgroundMatch = allText.match(/background:\s*([^\n]+)/i);
  const ownerMatch = allText.match(/owned by\s+<@!?(\d+)>/i);
  const pageMatch = allText.match(/showing page\s+(\d+)\s+of\s+(\d+)/i);

  return {
    albumName: albumMatch[1].trim() || undefined,
    background: backgroundMatch?.[1]?.trim() || undefined,
    imageUrl: embed.image?.url || undefined,
    ownerUserId: ownerMatch?.[1],
    page: pageMatch ? Number(pageMatch[1]) : undefined,
    totalPages: pageMatch ? Number(pageMatch[2]) : undefined,
  };
}

// Criterio de rareza (OR): print ≤ máx O wishlist ≥ mín. Se usa para decidir
// qué cartas se registran en la colección (kv) y para el feed de drops.
function karutaRareReasons(
  printNumber: number | undefined,
  wishlistCount: number | undefined,
  config: {
    karutaRarePrintMax?: number;
    karutaRareWishlistMin?: number;
  },
): string[] {
  const printMax = config.karutaRarePrintMax ?? 10;
  const wishlistMin = config.karutaRareWishlistMin ?? 3;
  const reasons: string[] = [];

  if (printNumber !== undefined && printNumber <= printMax) {
    reasons.push(`Print #${printNumber}`);
  }
  if (wishlistCount !== undefined && wishlistCount >= wishlistMin) {
    reasons.push(`${wishlistCount} wishlists`);
  }

  return reasons;
}

async function postKarutaGrab(
  guildId: string,
  sourceMessageId: string,
  grab: {
    cardName: string;
    code: string;
    grabberUsername?: string;
    wishlistCount?: number;
  },
): Promise<boolean> {
  const baseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
  const token = env.BOT_CONFIG_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return false;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl}/internal/guilds/${encodeURIComponent(guildId)}/karuta/grabs`,
      {
        body: JSON.stringify({
          cardName: grab.cardName,
          code: grab.code,
          grabberUsername: grab.grabberUsername,
          sourceMessageId,
          wishlistCount: grab.wishlistCount,
        }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": token,
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[discord-bot] Karuta grab POST falló (${response.status}) para guild ${guildId}.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Karuta grab POST error: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

async function postKarutaCard(
  guildId: string,
  card: ParsedKarutaKv,
): Promise<boolean> {
  const baseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
  const token = env.BOT_CONFIG_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return false;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl}/internal/guilds/${encodeURIComponent(guildId)}/karuta/cards`,
      {
        body: JSON.stringify({
          cardName: card.cardName,
          code: card.code,
          edition: card.edition,
          imageUrl: card.imageUrl,
          ownerUserId: card.ownerUserId,
          ownerUsername: card.ownerUsername,
          printNumber: card.printNumber,
          series: card.series,
          wishlistCount: card.wishlistCount,
        }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": token,
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[discord-bot] Karuta card upsert falló (${response.status}) para guild ${guildId}.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Karuta card upsert error: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

async function postKarutaBurn(
  guildId: string,
  burn: ParsedKarutaBurn,
): Promise<boolean> {
  const baseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
  const token = env.BOT_CONFIG_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return false;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl}/internal/guilds/${encodeURIComponent(guildId)}/karuta/cards/burn`,
      {
        body: JSON.stringify({
          cardName: burn.cardName,
          ownerUsername: burn.ownerUsername,
        }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": token,
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[discord-bot] Karuta card burn falló (${response.status}) para guild ${guildId}.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Karuta card burn error: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

async function postKarutaTransfer(
  guildId: string,
  transfer: { code: string; toUsername?: string },
): Promise<boolean> {
  const baseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
  const token = env.BOT_CONFIG_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return false;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl}/internal/guilds/${encodeURIComponent(guildId)}/karuta/transfers`,
      {
        body: JSON.stringify({
          code: transfer.code,
          toUsername: transfer.toUsername,
        }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": token,
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[discord-bot] Karuta transfer POST falló (${response.status}) para guild ${guildId}.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Karuta transfer POST error: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

async function postKarutaAlbum(
  guildId: string,
  album: ParsedKarutaAlbum & { ownerUsername?: string },
): Promise<boolean> {
  const baseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
  const token = env.BOT_CONFIG_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return false;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl}/internal/guilds/${encodeURIComponent(guildId)}/karuta/albums`,
      {
        body: JSON.stringify({
          albumName: album.albumName,
          background: album.background,
          imageUrl: album.imageUrl,
          ownerUserId: album.ownerUserId,
          ownerUsername: album.ownerUsername,
          page: album.page,
          totalPages: album.totalPages,
        }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": token,
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[discord-bot] Karuta album POST falló (${response.status}) para guild ${guildId}.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    console.warn(
      `[discord-bot] Karuta album POST error: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

// Procesa un embed tipo kv (ver carta). Devuelve true si el embed era kv
// (registrada, ignorada o no rara); false si no matcheaba kv. Se usa en
// MessageCreate y MessageUpdate porque Karuta a veces edita el mensaje para
// agregar la imagen final de la carta (igual que con los álbumes).
async function processKarutaKv(
  message: Message,
  rawEmbed: KarutaEmbed,
  guildConfig: Awaited<ReturnType<typeof getGuildConfig>>,
): Promise<boolean> {
  if (!message.guildId) {
    return false;
  }

  const kv = parseKarutaKv(rawEmbed, message.content);
  if (!kv) {
    return false;
  }

  const rawDesc = rawEmbed.description
    ? rawEmbed.description.replace(/\n/g, " ").slice(0, 220)
    : "";
  console.log(
    `[discord-bot] Karuta kv parseada: ${kv.code} print=${kv.printNumber ?? "?"} edición=${kv.edition ?? "?"} serie=${kv.series ?? "?"} nombre=${kv.cardName ?? "?"} image=${kv.imageUrl ? "sí" : "no"} | ${rawDesc}`,
  );

  const reasons = karutaRareReasons(
    kv.printNumber,
    kv.wishlistCount,
    guildConfig,
  );
  if (reasons.length === 0) {
    console.log(
      `[discord-bot] Karuta kv ignorada (no rara): ${kv.code} print=${kv.printNumber ?? "?"} wishlist=${kv.wishlistCount ?? "?"}`,
    );
    return true;
  }

  // El dueño viene como mención (<@ID>) en el embed. Solo registramos
  // cartas de miembros del server: si no podemos resolverlo, saltamos.
  if (kv.ownerUserId && !kv.ownerUsername) {
    const member = await message.guild?.members
      .fetch(kv.ownerUserId)
      .catch(() => null);
    if (!member) {
      console.log(
        `[discord-bot] Karuta kv ignorada: dueño <@${kv.ownerUserId}> no está en el server (${kv.code})`,
      );
      return true;
    }
    kv.ownerUsername = member.displayName;
  }

  // Karuta a veces postea primero el embed SIN la imagen y la agrega al
  // EDITAR el mensaje (que procesamos en MessageUpdate). Si esta vista no
  // trae imagen todavía, no registramos/actualizamos la carta: así no se
  // crean tarjetas "sin imagen" ni se pisa una imagen buena con nada.
  if (!kv.imageUrl) {
    console.log(
      `[discord-bot] Karuta kv sin imagen, se espera el edit: ${kv.code}`,
    );
    return true;
  }

  const saved = await postKarutaCard(message.guildId, kv);
  if (saved) {
    console.log(
      `[discord-bot] Karuta kv registrada: ${kv.code} (${kv.ownerUsername ?? "?"})`,
    );
  }
  return true;
}

async function handleKarutaDropMessage(message: Message): Promise<void> {
  if (!message.inGuild() || !message.author.bot) {
    return;
  }

  if (!isRemoteStoreEnabled()) {
    return;
  }

  const guildConfig = await getGuildConfig(message.guildId).catch(() => null);
  if (!guildConfig?.karutaWatchEnabled) {
    return;
  }

  const karutaBotUserId =
    guildConfig.karutaBotUserId?.trim() || DEFAULT_KARUTA_BOT_USER_ID;

  if (
    guildConfig.karutaChannelId &&
    message.channelId !== guildConfig.karutaChannelId
  ) {
    return;
  }

  // Card Companion (u otro bot) anuncia la wishlist de un drop. No es el bot
  // de Karuta, así que lo procesamos aparte y salimos.
  if (message.author.id !== karutaBotUserId) {
    const lines = parseCardCompanionDrop(message.content);
    if (lines.length > 0) {
      rememberCardCompanionWishlists(message.guildId, message.channelId, lines);
      console.log(
        `[discord-bot] Card Companion wishlists recordadas: ${lines.length} cartas`,
      );

      // Drops raros por wishlist: se registran y anuncian de inmediato, sin
      // esperar a que alguien agarre la carta.
      const wishlistMin = guildConfig.karutaRareWishlistMin ?? 3;
      const rareLines = lines.filter(
        (line) =>
          line.wishlistCount !== undefined && line.wishlistCount >= wishlistMin,
      );
      if (rareLines.length > 0) {
        for (const [index, line] of rareLines.entries()) {
          const saved = await postKarutaDrop(message.guildId, {
            cardName: line.cardName,
            series: line.series,
            sourceMessageId: `${message.id}:${index}`,
            wishlistCount: line.wishlistCount,
          });
          if (saved) {
            console.log(
              `[discord-bot] Karuta drop raro (Card Companion): ${line.cardName} wishlist=${line.wishlistCount}`,
            );
          }
        }
        await announceKarutaRareDrops(message, rareLines);
      }
    }
    return;
  }

  // 1) Grab: texto plano, sin embed ("@X took the <name> card `<code>`!").
  //    Si el code ya está en la colección, se registra el drop y se
  //    transfiere la posesión al grabber (el dropper es el dueño anterior).
  const grab = parseKarutaGrab(message.content);
  if (grab) {
    const grabberUsername = grab.mentionedUserId
      ? (message.mentions.members?.get(grab.mentionedUserId)?.displayName ??
        message.mentions.users.get(grab.mentionedUserId)?.username)
      : undefined;
    const wishlistEntry = pendingCardCompanionWishlists.get(
      `${message.guildId}:${message.channelId}:${grab.cardName.toLowerCase()}`,
    );
    const saved = await postKarutaGrab(message.guildId, message.id, {
      cardName: grab.cardName,
      code: grab.code,
      grabberUsername,
      wishlistCount: wishlistEntry?.wishlist,
    });
    if (saved) {
      console.log(
        `[discord-bot] Karuta grab detectado: ${grab.code} por ${grabberUsername ?? "?"} wishlist=${wishlistEntry?.wishlist ?? "?"}`,
      );
    }
    return;
  }

  const embeds = message.embeds.map((embed) => embed.toJSON());
  if (embeds.length === 0) {
    return;
  }

  for (const rawEmbed of embeds) {
    // Transferencia (kg) aceptada: cambia el dueño de la carta.
    const transfer = parseKarutaTransfer(rawEmbed, message.content);
    if (transfer) {
      const toUsername = transfer.toUserId
        ? (
            await message.guild?.members
              .fetch(transfer.toUserId)
              .catch(() => null)
          )?.displayName
        : undefined;
      const saved = await postKarutaTransfer(message.guildId, {
        code: transfer.code,
        toUsername,
      });
      if (saved) {
        console.log(
          `[discord-bot] Karuta transfer aceptado: ${transfer.code} → ${toUsername ?? "?"}`,
        );
      }
      continue;
    }

    // Burn (kb): da de baja la carta quemada.
    const burn = parseKarutaBurn(rawEmbed, message.content);
    if (burn) {
      await postKarutaBurn(message.guildId, burn);
      continue;
    }

    // kv (ver carta): registra en la colección SOLO si es rara (OR).
    if (await processKarutaKv(message, rawEmbed, guildConfig)) {
      continue;
    }

    // Álbum (ka): registra la colección del usuario (solo miembros).
    const album = parseKarutaAlbum(rawEmbed, message.content);
    if (album) {
      if (!album.ownerUserId) {
        continue;
      }
      const member = await message.guild?.members
        .fetch(album.ownerUserId)
        .catch(() => null);
      if (!member) {
        console.log(
          `[discord-bot] Karuta album ignorado: dueño <@${album.ownerUserId}> no está en el server (${album.albumName ?? "?"})`,
        );
        continue;
      }
      const ownerUsername = member.displayName;
      const saved = await postKarutaAlbum(message.guildId, {
        ...album,
        ownerUsername,
      });
      if (saved) {
        console.log(
          `[discord-bot] Karuta album registrado: ${album.albumName ?? "?"} de ${ownerUsername}`,
        );
      }
      continue;
    }

    // Diagnóstico: no matcheó nada conocido. Solo volcamos embeds que
    // parezcan cartas para no llenar el log con Reminders.
    if (
      (rawEmbed.image || rawEmbed.title === "Card Details") &&
      rawEmbed.title !== "Card Transfer" &&
      rawEmbed.title !== "Card Album"
    ) {
      console.log(
        `[discord-bot] Karuta embed sin matchear: ${JSON.stringify(rawEmbed)}`,
      );
    }
  }
}

client.on(Events.MessageCreate, (message) => {
  const memberRoles = message.member
    ? Array.from(message.member.roles.cache.keys())
    : undefined;
  void awardXpForMessage(message, memberRoles);
  void handleKarutaDropMessage(message);
});

// Los mensajes de Karuta se EDITA en varios casos:
//   - kg: la transferencia pasa de "pendiente" a "Card transfer has been
//     accepted.".
//   - ka: la imagen del álbum se reemplaza por la real (o cambia de página).
// Por eso procesamos ambos en MessageUpdate.
async function handleKarutaMessageUpdate(message: Message): Promise<void> {
  if (!message.inGuild() || !message.author.bot) {
    return;
  }
  if (!isRemoteStoreEnabled()) {
    return;
  }

  const guildConfig = await getGuildConfig(message.guildId).catch(() => null);
  if (!guildConfig?.karutaWatchEnabled) {
    return;
  }

  const karutaBotUserId =
    guildConfig.karutaBotUserId?.trim() || DEFAULT_KARUTA_BOT_USER_ID;
  if (message.author.id !== karutaBotUserId) {
    return;
  }
  if (
    guildConfig.karutaChannelId &&
    message.channelId !== guildConfig.karutaChannelId
  ) {
    return;
  }

  for (const rawEmbed of message.embeds.map((embed) => embed.toJSON())) {
    // Transferencia aceptada.
    const transfer = parseKarutaTransfer(rawEmbed, message.content);
    if (transfer) {
      const toUsername = transfer.toUserId
        ? (
            await message.guild?.members
              .fetch(transfer.toUserId)
              .catch(() => null)
          )?.displayName
        : undefined;
      const saved = await postKarutaTransfer(message.guildId, {
        code: transfer.code,
        toUsername,
      });
      if (saved) {
        console.log(
          `[discord-bot] Karuta transfer aceptado (edit): ${transfer.code} → ${toUsername ?? "?"}`,
        );
      }
      continue;
    }

    // kv editado: Karuta a veces agrega la imagen final de la carta
    // editando el mensaje (igual que con los álbumes).
    if (await processKarutaKv(message, rawEmbed, guildConfig)) {
      continue;
    }

    // Álbum editado: imagen final (reemplaza el placeholder "Loading...") o
    // cambio de página.
    const album = parseKarutaAlbum(rawEmbed, message.content);
    if (album) {
      if (!album.ownerUserId) {
        continue;
      }
      const member = await message.guild?.members
        .fetch(album.ownerUserId)
        .catch(() => null);
      if (!member) {
        console.log(
          `[discord-bot] Karuta album ignorado (edit): dueño <@${album.ownerUserId}> no está en el server`,
        );
        continue;
      }
      const saved = await postKarutaAlbum(message.guildId, {
        ...album,
        ownerUsername: member.displayName,
      });
      if (saved) {
        console.log(
          `[discord-bot] Karuta album actualizado (edit): ${album.albumName ?? "?"} pág ${album.page ?? 1}`,
        );
      }
      continue;
    }
  }
}

client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
  if (newMessage.partial) {
    try {
      await newMessage.fetch();
    } catch {
      return;
    }
  }
  await handleKarutaMessageUpdate(newMessage as Message);
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
