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
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  memberLogChannelId?: string;
  reactionRoles?: ReactionRoleRule[];
  reactionRolesChannelId?: string;
  temporaryVoiceChannelIds?: string[];
};

function toGuildConfig(
  record: {
    dynamicVoiceCreateChannelId: string | null;
    enabledModules: string[];
    memberLogChannelId: string | null;
    reactionRolesChannelId: string | null;
    temporaryVoiceChannelIds: string[];
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
    dynamicVoiceCreateChannelId:
      record.dynamicVoiceCreateChannelId ?? undefined,
    enabledModules: record.enabledModules,
    memberLogChannelId: record.memberLogChannelId ?? undefined,
    reactionRoles,
    reactionRolesChannelId: record.reactionRolesChannelId ?? undefined,
    temporaryVoiceChannelIds: record.temporaryVoiceChannelIds,
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
  dynamicVoiceCreateChannelId?: string;
  enabledModules: string[];
  memberLogChannelId?: string;
  reactionRoles: ReactionRoleRule[];
  reactionRolesChannelId?: string;
  temporaryVoiceChannelIds: string[];
};

function normalizeGuildConfig(config: GuildConfig): NormalizedGuildConfig {
  const normalizedRules = (config.reactionRoles ?? [])
    .map((rule) => normalizeReactionRoleRule(rule))
    .filter((rule): rule is ReactionRoleRule => Boolean(rule));

  return {
    dynamicVoiceCreateChannelId: config.dynamicVoiceCreateChannelId,
    enabledModules: config.enabledModules ?? [],
    memberLogChannelId: config.memberLogChannelId,
    reactionRoles: normalizedRules,
    reactionRolesChannelId: config.reactionRolesChannelId,
    temporaryVoiceChannelIds: config.temporaryVoiceChannelIds ?? [],
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
        memberLogChannelId: normalized.memberLogChannelId,
        dynamicVoiceCreateChannelId: normalized.dynamicVoiceCreateChannelId,
        reactionRolesChannelId: normalized.reactionRolesChannelId,
        enabledModules: normalized.enabledModules,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
      },
      update: {
        memberLogChannelId: normalized.memberLogChannelId,
        dynamicVoiceCreateChannelId: normalized.dynamicVoiceCreateChannelId,
        reactionRolesChannelId: normalized.reactionRolesChannelId,
        enabledModules: normalized.enabledModules,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
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
