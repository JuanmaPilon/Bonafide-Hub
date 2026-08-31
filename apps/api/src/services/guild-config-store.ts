import { prisma } from "../db/prisma.js";

export type ReactionRoleMode = "multiple" | "unique" | "additive";

export type ReactionRoleRule = {
  channelId?: string;
  emojiKey: string;
  messageId: string;
  mode?: ReactionRoleMode;
  roleId: string;
};

export type GuildConfig = {
  bannedVoiceRoleIds?: string[];
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  logsChannelId?: string;
  logsWatchEnabled?: boolean;
  logsWatchGuild?: string;
  logsWatchRegion?: string;
  logsWatchServer?: string;
  memberLogChannelId?: string;
  musicEnabled?: boolean;
  musicRoleIds?: string[];
  reactionRoles?: ReactionRoleRule[];
  reactionRolesChannelId?: string;
  suggestionsDmUserId?: string;
  temporaryVoiceChannelIds?: string[];
  xpSyncRequested?: boolean;
};

function toGuildConfig(
  record: {
    bannedVoiceRoleIds: string[];
    dailyMessagesChannelId: string | null;
    dailyMessagesEnabled: boolean;
    dailyMessagesMaxMinutes: number;
    dailyMessagesMinMinutes: number;
    defaultRoleId: string | null;
    dynamicVoiceCreateChannelId: string | null;
    enabledModules: string[];
    logsChannelId: string | null;
    logsWatchEnabled: boolean;
    logsWatchGuild: string | null;
    logsWatchRegion: string | null;
    logsWatchServer: string | null;
    memberLogChannelId: string | null;
    musicEnabled: boolean;
    musicRoleIds: string[];
    reactionRolesChannelId: string | null;
    suggestionsDmUserId: string | null;
    temporaryVoiceChannelIds: string[];
    xpSyncRequested: boolean;
  } | null,
  reactionRoles: ReactionRoleRule[],
): GuildConfig {
  if (!record) {
    return {
      reactionRoles,
      temporaryVoiceChannelIds: [],
    };
  }

  return {
    bannedVoiceRoleIds: record.bannedVoiceRoleIds,
    dailyMessagesChannelId: record.dailyMessagesChannelId ?? undefined,
    dailyMessagesEnabled: record.dailyMessagesEnabled,
    dailyMessagesMaxMinutes: record.dailyMessagesMaxMinutes,
    dailyMessagesMinMinutes: record.dailyMessagesMinMinutes,
    defaultRoleId: record.defaultRoleId ?? undefined,
    dynamicVoiceCreateChannelId:
      record.dynamicVoiceCreateChannelId ?? undefined,
    enabledModules: record.enabledModules,
    logsChannelId: record.logsChannelId ?? undefined,
    logsWatchEnabled: record.logsWatchEnabled,
    logsWatchGuild: record.logsWatchGuild ?? undefined,
    logsWatchRegion: record.logsWatchRegion ?? undefined,
    logsWatchServer: record.logsWatchServer ?? undefined,
    memberLogChannelId: record.memberLogChannelId ?? undefined,
    musicEnabled: record.musicEnabled,
    musicRoleIds: record.musicRoleIds,
    reactionRoles,
    reactionRolesChannelId: record.reactionRolesChannelId ?? undefined,
    suggestionsDmUserId: record.suggestionsDmUserId ?? undefined,
    temporaryVoiceChannelIds: record.temporaryVoiceChannelIds,
    xpSyncRequested: record.xpSyncRequested,
  };
}

function normalizeReactionRoleRule(
  rule: ReactionRoleRule,
): ReactionRoleRule | null {
  const messageId = rule.messageId.trim();
  const emojiKey = rule.emojiKey.trim();
  const roleId = rule.roleId.trim();

  if (!messageId || !emojiKey || !roleId) {
    return null;
  }

  const channelId = rule.channelId?.trim();
  const mode = rule.mode?.trim();

  return {
    channelId: channelId || undefined,
    emojiKey,
    messageId,
    mode: mode ? (mode as ReactionRoleMode) : undefined,
    roleId,
  };
}

type NormalizedGuildConfig = {
  bannedVoiceRoleIds: string[];
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled: boolean;
  dailyMessagesMaxMinutes: number;
  dailyMessagesMinMinutes: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  enabledModules: string[];
  logsChannelId?: string;
  logsWatchEnabled: boolean;
  logsWatchGuild?: string;
  logsWatchRegion?: string;
  logsWatchServer?: string;
  memberLogChannelId?: string;
  musicEnabled: boolean;
  musicRoleIds: string[];
  reactionRoles: ReactionRoleRule[];
  reactionRolesChannelId?: string;
  suggestionsDmUserId?: string;
  temporaryVoiceChannelIds: string[];
  xpSyncRequested: boolean;
};

function normalizeGuildConfig(config: GuildConfig): NormalizedGuildConfig {
  const normalizedRules = (config.reactionRoles ?? [])
    .map((rule) => normalizeReactionRoleRule(rule))
    .filter((rule): rule is ReactionRoleRule => Boolean(rule));

  const minMinutes = Math.max(
    1,
    Math.floor(config.dailyMessagesMinMinutes ?? 15),
  );
  const maxMinutes = Math.max(
    minMinutes,
    Math.floor(config.dailyMessagesMaxMinutes ?? 90),
  );

  return {
    bannedVoiceRoleIds: config.bannedVoiceRoleIds ?? [],
    dailyMessagesChannelId: config.dailyMessagesChannelId,
    dailyMessagesEnabled: config.dailyMessagesEnabled ?? false,
    dailyMessagesMaxMinutes: maxMinutes,
    dailyMessagesMinMinutes: minMinutes,
    defaultRoleId: config.defaultRoleId,
    dynamicVoiceCreateChannelId: config.dynamicVoiceCreateChannelId,
    enabledModules: config.enabledModules ?? [],
    logsChannelId: config.logsChannelId,
    logsWatchEnabled: config.logsWatchEnabled ?? false,
    logsWatchGuild: config.logsWatchGuild,
    logsWatchRegion: config.logsWatchRegion,
    logsWatchServer: config.logsWatchServer,
    memberLogChannelId: config.memberLogChannelId,
    musicEnabled: config.musicEnabled ?? true,
    musicRoleIds: config.musicRoleIds ?? [],
    reactionRoles: normalizedRules,
    reactionRolesChannelId: config.reactionRolesChannelId,
    suggestionsDmUserId: config.suggestionsDmUserId,
    temporaryVoiceChannelIds: config.temporaryVoiceChannelIds ?? [],
    xpSyncRequested: config.xpSyncRequested ?? false,
  };
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const [record, reactionRoleRecords] = await Promise.all([
    prisma.guildConfig.findUnique({
      where: { guildId },
    }),
    prisma.reactionRoleRule.findMany({
      where: { guildId },
      orderBy: [{ messageId: "asc" }, { emojiKey: "asc" }],
    }),
  ]);

  const reactionRoles: ReactionRoleRule[] = reactionRoleRecords.map((rule) => ({
    channelId: rule.channelId ?? undefined,
    emojiKey: rule.emojiKey,
    messageId: rule.messageId,
    mode: rule.mode ? (rule.mode as ReactionRoleMode) : undefined,
    roleId: rule.roleId,
  }));

  return toGuildConfig(record, reactionRoles);
}

export async function replaceGuildConfig(
  guildId: string,
  fullConfig: GuildConfig,
): Promise<GuildConfig> {
  const normalized = normalizeGuildConfig(fullConfig);

  await prisma.$transaction(async (tx) => {
    await tx.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        bannedVoiceRoleIds: normalized.bannedVoiceRoleIds,
        dailyMessagesChannelId: normalized.dailyMessagesChannelId,
        dailyMessagesEnabled: normalized.dailyMessagesEnabled,
        dailyMessagesMaxMinutes: normalized.dailyMessagesMaxMinutes,
        dailyMessagesMinMinutes: normalized.dailyMessagesMinMinutes,
        logsChannelId: normalized.logsChannelId,
        logsWatchEnabled: normalized.logsWatchEnabled,
        logsWatchGuild: normalized.logsWatchGuild,
        logsWatchRegion: normalized.logsWatchRegion,
        logsWatchServer: normalized.logsWatchServer,
        memberLogChannelId: normalized.memberLogChannelId,
        dynamicVoiceCreateChannelId: normalized.dynamicVoiceCreateChannelId,
        reactionRolesChannelId: normalized.reactionRolesChannelId,
        defaultRoleId: normalized.defaultRoleId,
        xpSyncRequested: normalized.xpSyncRequested,
        enabledModules: normalized.enabledModules,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
        musicEnabled: normalized.musicEnabled,
        musicRoleIds: normalized.musicRoleIds,
        suggestionsDmUserId: normalized.suggestionsDmUserId,
      },
      update: {
        bannedVoiceRoleIds: normalized.bannedVoiceRoleIds,
        dailyMessagesChannelId: normalized.dailyMessagesChannelId,
        dailyMessagesEnabled: normalized.dailyMessagesEnabled,
        dailyMessagesMaxMinutes: normalized.dailyMessagesMaxMinutes,
        dailyMessagesMinMinutes: normalized.dailyMessagesMinMinutes,
        logsChannelId: normalized.logsChannelId,
        logsWatchEnabled: normalized.logsWatchEnabled,
        logsWatchGuild: normalized.logsWatchGuild,
        logsWatchRegion: normalized.logsWatchRegion,
        logsWatchServer: normalized.logsWatchServer,
        memberLogChannelId: normalized.memberLogChannelId,
        dynamicVoiceCreateChannelId: normalized.dynamicVoiceCreateChannelId,
        reactionRolesChannelId: normalized.reactionRolesChannelId,
        defaultRoleId: normalized.defaultRoleId,
        xpSyncRequested: normalized.xpSyncRequested,
        enabledModules: normalized.enabledModules,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
        musicEnabled: normalized.musicEnabled,
        musicRoleIds: normalized.musicRoleIds,
        suggestionsDmUserId: normalized.suggestionsDmUserId,
      },
    });

    await tx.reactionRoleRule.deleteMany({
      where: { guildId },
    });

    if (normalized.reactionRoles.length > 0) {
      await tx.reactionRoleRule.createMany({
        data: normalized.reactionRoles.map((rule) => ({
          channelId: rule.channelId,
          emojiKey: rule.emojiKey,
          guildId,
          messageId: rule.messageId,
          mode: rule.mode,
          roleId: rule.roleId,
        })),
      });
    }
  });

  return getGuildConfig(guildId);
}

export async function upsertGuildConfig(
  guildId: string,
  partialConfig: GuildConfig,
): Promise<GuildConfig> {
  const current = await getGuildConfig(guildId);
  const next: GuildConfig = {
    ...current,
    ...partialConfig,
  };

  return replaceGuildConfig(guildId, next);
}
