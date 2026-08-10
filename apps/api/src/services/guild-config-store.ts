import { prisma } from "../db/prisma.js";

export type GuildConfig = {
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  memberLogChannelId?: string;
  reactionRolesChannelId?: string;
};

function toGuildConfig(
  record: {
    dynamicVoiceCreateChannelId: string | null;
    enabledModules: string[];
    memberLogChannelId: string | null;
    reactionRolesChannelId: string | null;
  } | null,
): GuildConfig {
  if (!record) {
    return {};
  }

  return {
    dynamicVoiceCreateChannelId:
      record.dynamicVoiceCreateChannelId ?? undefined,
    enabledModules: record.enabledModules,
    memberLogChannelId: record.memberLogChannelId ?? undefined,
    reactionRolesChannelId: record.reactionRolesChannelId ?? undefined,
  };
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const record = await prisma.guildConfig.findUnique({
    where: { guildId },
  });

  return toGuildConfig(record);
}

export async function upsertGuildConfig(
  guildId: string,
  partialConfig: GuildConfig,
): Promise<GuildConfig> {
  const record = await prisma.guildConfig.upsert({
    where: { guildId },
    create: {
      guildId,
      memberLogChannelId: partialConfig.memberLogChannelId,
      dynamicVoiceCreateChannelId: partialConfig.dynamicVoiceCreateChannelId,
      reactionRolesChannelId: partialConfig.reactionRolesChannelId,
      enabledModules: partialConfig.enabledModules ?? [],
    },
    update: {
      memberLogChannelId: partialConfig.memberLogChannelId,
      dynamicVoiceCreateChannelId: partialConfig.dynamicVoiceCreateChannelId,
      reactionRolesChannelId: partialConfig.reactionRolesChannelId,
      enabledModules: partialConfig.enabledModules,
    },
  });

  return toGuildConfig(record);
}
