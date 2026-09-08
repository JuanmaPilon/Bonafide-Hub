import { prisma } from "../db/prisma.js";

// Permiso de staff: un rol de Discord tiene acceso a ciertos módulos del
// panel Admin.
export type AdminRoleRule = {
  roleId: string;
  modules: string[];
};

export type GuildConfig = {
  adminRoleModules?: AdminRoleRule[];
  bannedVoiceRoleIds?: string[];
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  karutaBotUserId?: string;
  karutaChannelId?: string;
  karutaRarePrintMax?: number;
  karutaRareWishlistMin?: number;
  karutaWatchEnabled?: boolean;
  logsChannelId?: string;
  logsWatchEnabled?: boolean;
  logsWatchGuild?: string;
  logsWatchRegion?: string;
  logsWatchServer?: string;
  memberLogChannelId?: string;
  musicEnabled?: boolean;
  musicRoleIds?: string[];
  suggestionsDmUserId?: string;
  suggestionsDmTiers?: string[];
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
    karutaBotUserId: string | null;
    karutaChannelId: string | null;
    karutaRarePrintMax: number;
    karutaRareWishlistMin: number;
    karutaWatchEnabled: boolean;
    logsChannelId: string | null;
    logsWatchEnabled: boolean;
    logsWatchGuild: string | null;
    logsWatchRegion: string | null;
    logsWatchServer: string | null;
    memberLogChannelId: string | null;
    musicEnabled: boolean;
    musicRoleIds: string[];
    suggestionsDmUserId: string | null;
    suggestionsDmTiers: string[];
    temporaryVoiceChannelIds: string[];
    xpSyncRequested: boolean;
  } | null,
  adminRoleModules: AdminRoleRule[],
): GuildConfig {
  if (!record) {
    return {
      adminRoleModules,
      temporaryVoiceChannelIds: [],
    };
  }

  return {
    adminRoleModules,
    bannedVoiceRoleIds: record.bannedVoiceRoleIds,
    dailyMessagesChannelId: record.dailyMessagesChannelId ?? undefined,
    dailyMessagesEnabled: record.dailyMessagesEnabled,
    dailyMessagesMaxMinutes: record.dailyMessagesMaxMinutes,
    dailyMessagesMinMinutes: record.dailyMessagesMinMinutes,
    defaultRoleId: record.defaultRoleId ?? undefined,
    dynamicVoiceCreateChannelId:
      record.dynamicVoiceCreateChannelId ?? undefined,
    enabledModules: record.enabledModules,
    karutaBotUserId: record.karutaBotUserId ?? undefined,
    karutaChannelId: record.karutaChannelId ?? undefined,
    karutaRarePrintMax: record.karutaRarePrintMax,
    karutaRareWishlistMin: record.karutaRareWishlistMin,
    karutaWatchEnabled: record.karutaWatchEnabled,
    logsChannelId: record.logsChannelId ?? undefined,
    logsWatchEnabled: record.logsWatchEnabled,
    logsWatchGuild: record.logsWatchGuild ?? undefined,
    logsWatchRegion: record.logsWatchRegion ?? undefined,
    logsWatchServer: record.logsWatchServer ?? undefined,
    memberLogChannelId: record.memberLogChannelId ?? undefined,
    musicEnabled: record.musicEnabled,
    musicRoleIds: record.musicRoleIds,
    suggestionsDmUserId: record.suggestionsDmUserId ?? undefined,
    suggestionsDmTiers: record.suggestionsDmTiers,
    temporaryVoiceChannelIds: record.temporaryVoiceChannelIds,
    xpSyncRequested: record.xpSyncRequested,
  };
}

type NormalizedGuildConfig = {
  adminRoleModules: AdminRoleRule[];
  bannedVoiceRoleIds: string[];
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled: boolean;
  dailyMessagesMaxMinutes: number;
  dailyMessagesMinMinutes: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  enabledModules: string[];
  karutaBotUserId?: string;
  karutaChannelId?: string;
  karutaRarePrintMax: number;
  karutaRareWishlistMin: number;
  karutaWatchEnabled: boolean;
  logsChannelId?: string;
  logsWatchEnabled: boolean;
  logsWatchGuild?: string;
  logsWatchRegion?: string;
  logsWatchServer?: string;
  memberLogChannelId?: string;
  musicEnabled: boolean;
  musicRoleIds: string[];
  suggestionsDmUserId?: string;
  suggestionsDmTiers: string[];
  temporaryVoiceChannelIds: string[];
  xpSyncRequested: boolean;
};

function normalizeGuildConfig(config: GuildConfig): NormalizedGuildConfig {
  const minMinutes = Math.max(
    1,
    Math.floor(config.dailyMessagesMinMinutes ?? 15),
  );
  const maxMinutes = Math.max(
    minMinutes,
    Math.floor(config.dailyMessagesMaxMinutes ?? 90),
  );

  return {
    adminRoleModules: (config.adminRoleModules ?? []).map((rule) => ({
      modules: rule.modules ?? [],
      roleId: rule.roleId,
    })),
    bannedVoiceRoleIds: config.bannedVoiceRoleIds ?? [],
    dailyMessagesChannelId: config.dailyMessagesChannelId,
    dailyMessagesEnabled: config.dailyMessagesEnabled ?? false,
    dailyMessagesMaxMinutes: maxMinutes,
    dailyMessagesMinMinutes: minMinutes,
    defaultRoleId: config.defaultRoleId,
    dynamicVoiceCreateChannelId: config.dynamicVoiceCreateChannelId,
    enabledModules: config.enabledModules ?? [],
    karutaBotUserId: config.karutaBotUserId,
    karutaChannelId: config.karutaChannelId,
    karutaRarePrintMax: config.karutaRarePrintMax ?? 10,
    karutaRareWishlistMin: config.karutaRareWishlistMin ?? 3,
    karutaWatchEnabled: config.karutaWatchEnabled ?? false,
    logsChannelId: config.logsChannelId,
    logsWatchEnabled: config.logsWatchEnabled ?? false,
    logsWatchGuild: config.logsWatchGuild,
    logsWatchRegion: config.logsWatchRegion,
    logsWatchServer: config.logsWatchServer,
    memberLogChannelId: config.memberLogChannelId,
    musicEnabled: config.musicEnabled ?? true,
    musicRoleIds: config.musicRoleIds ?? [],
    suggestionsDmUserId: config.suggestionsDmUserId,
    suggestionsDmTiers: config.suggestionsDmTiers ?? [],
    temporaryVoiceChannelIds: config.temporaryVoiceChannelIds ?? [],
    xpSyncRequested: config.xpSyncRequested ?? false,
  };
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const [record, adminRoleRecords] = await Promise.all([
    prisma.guildConfig.findUnique({
      where: { guildId },
    }),
    prisma.adminRoleModule.findMany({
      where: { guildId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const adminRoleModules: AdminRoleRule[] = adminRoleRecords.map((rule) => ({
    modules: rule.modules,
    roleId: rule.roleId,
  }));

  return toGuildConfig(record, adminRoleModules);
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
        defaultRoleId: normalized.defaultRoleId,
        xpSyncRequested: normalized.xpSyncRequested,
        enabledModules: normalized.enabledModules,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
        musicEnabled: normalized.musicEnabled,
        musicRoleIds: normalized.musicRoleIds,
        suggestionsDmUserId: normalized.suggestionsDmUserId,
        suggestionsDmTiers: normalized.suggestionsDmTiers,
        karutaBotUserId: normalized.karutaBotUserId,
        karutaChannelId: normalized.karutaChannelId,
        karutaRarePrintMax: normalized.karutaRarePrintMax,
        karutaRareWishlistMin: normalized.karutaRareWishlistMin,
        karutaWatchEnabled: normalized.karutaWatchEnabled,
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
        defaultRoleId: normalized.defaultRoleId,
        xpSyncRequested: normalized.xpSyncRequested,
        enabledModules: normalized.enabledModules,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
        musicEnabled: normalized.musicEnabled,
        musicRoleIds: normalized.musicRoleIds,
        suggestionsDmUserId: normalized.suggestionsDmUserId,
        suggestionsDmTiers: normalized.suggestionsDmTiers,
        karutaBotUserId: normalized.karutaBotUserId,
        karutaChannelId: normalized.karutaChannelId,
        karutaRarePrintMax: normalized.karutaRarePrintMax,
        karutaRareWishlistMin: normalized.karutaRareWishlistMin,
        karutaWatchEnabled: normalized.karutaWatchEnabled,
      },
    });

    // Los permisos de staff tienen su propia actualización lógica. Si el
    // payload no los incluye, conservarlos evita que un guardado de otra
    // tarjeta o del bot los borre accidentalmente.
    if (fullConfig.adminRoleModules !== undefined) {
      await tx.adminRoleModule.deleteMany({
        where: { guildId },
      });

      if (normalized.adminRoleModules.length > 0) {
        await tx.adminRoleModule.createMany({
          data: normalized.adminRoleModules.map((rule) => ({
            guildId,
            modules: rule.modules,
            roleId: rule.roleId,
          })),
        });
      }
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

  // No propagar la copia leída de adminRoleModules en guardados parciales:
  // solo el guardado explícito de permisos debe reemplazar esa relación.
  if (partialConfig.adminRoleModules === undefined) {
    delete next.adminRoleModules;
  }

  return replaceGuildConfig(guildId, next);
}
