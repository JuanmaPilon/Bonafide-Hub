import { prisma } from "../db/prisma.js";

// Permiso de staff: un rol de Discord tiene acceso a ciertos módulos del
// panel Admin.
export type AdminRoleRule = {
  roleId: string;
  modules: string[];
};

// Rol de inscripción de eventos (configurable). Con los 4 clásicos como
// default, se puede adaptar a cualquier juego (LoL: Top/Jungle/Mid/ADC/Support).
export type EventRoleOption = {
  animated: boolean;
  emoji?: string;
  emojiId?: string;
  emojiName?: string;
  key: string;
  label: string;
};

export const DEFAULT_EVENT_ROLES: EventRoleOption[] = [
  { animated: false, emoji: "🛡️", key: "tank", label: "Tank" },
  { animated: false, emoji: "💚", key: "healer", label: "Healer" },
  { animated: false, emoji: "⚔️", key: "melee", label: "Melee" },
  { animated: false, emoji: "🏹", key: "ranged", label: "Ranged" },
];

// Sanea la lista de roles que manda el panel: claves únicas y en minúscula,
// labels cortos, emoji unicode o custom de Discord (id + nombre).
export function normalizeEventRoles(value: unknown): EventRoleOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const roles: EventRoleOption[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const key = String(raw.key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    const label = String(raw.label ?? "").trim().slice(0, 24);
    if (!key || !label || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const emojiId = String(raw.emojiId ?? "").trim() || undefined;
    const emojiName = String(raw.emojiName ?? "").trim() || undefined;
    const emoji = String(raw.emoji ?? "").trim().slice(0, 8) || undefined;

    roles.push({
      animated: emojiId ? Boolean(raw.animated) : false,
      // El emoji custom manda; el unicode queda como texto alternativo.
      emoji: emojiId ? undefined : emoji,
      emojiId,
      emojiName: emojiName ?? (emojiId ? "emoji" : undefined),
      key,
      label,
    });

    if (roles.length >= 12) {
      break;
    }
  }

  return roles;
}

// Roles efectivos de una guild (los configurados o los clásicos).
export function resolveEventRoles(
  config: { eventRoles?: unknown } | null | undefined,
): EventRoleOption[] {
  const roles = normalizeEventRoles(config?.eventRoles);
  return roles && roles.length > 0 ? roles : DEFAULT_EVENT_ROLES;
}

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
  eventClassLabel?: string;
  eventRoles?: EventRoleOption[];
  eventSpecEnabled?: boolean;
  eventSpecLabel?: string;
  karutaBotUserId?: string;
  karutaChannelId?: string;
  karutaRarePrintMax?: number;
  karutaRareWishlistMin?: number;
  karutaSuperRarePrintMax?: number;
  karutaSuperRareWishlistMin?: number;
  karutaUltraRarePrintMax?: number;
  karutaUltraRareWishlistMin?: number;
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
    eventClassLabel: string | null;
    eventRoles: unknown;
    eventSpecEnabled: boolean;
    eventSpecLabel: string | null;
    karutaBotUserId: string | null;
    karutaChannelId: string | null;
    karutaRarePrintMax: number;
    karutaRareWishlistMin: number;
    karutaSuperRarePrintMax: number;
    karutaSuperRareWishlistMin: number;
    karutaUltraRarePrintMax: number;
    karutaUltraRareWishlistMin: number;
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
    eventClassLabel: record.eventClassLabel ?? undefined,
    eventRoles: normalizeEventRoles(record.eventRoles) ?? undefined,
    eventSpecEnabled: record.eventSpecEnabled,
    eventSpecLabel: record.eventSpecLabel ?? undefined,
    karutaBotUserId: record.karutaBotUserId ?? undefined,
    karutaChannelId: record.karutaChannelId ?? undefined,
    karutaRarePrintMax: record.karutaRarePrintMax,
    karutaRareWishlistMin: record.karutaRareWishlistMin,
    karutaSuperRarePrintMax: record.karutaSuperRarePrintMax,
    karutaSuperRareWishlistMin: record.karutaSuperRareWishlistMin,
    karutaUltraRarePrintMax: record.karutaUltraRarePrintMax,
    karutaUltraRareWishlistMin: record.karutaUltraRareWishlistMin,
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
  eventClassLabel?: string;
  eventRoles?: EventRoleOption[];
  eventSpecEnabled: boolean;
  eventSpecLabel?: string;
  karutaBotUserId?: string;
  karutaChannelId?: string;
  karutaRarePrintMax: number;
  karutaRareWishlistMin: number;
  karutaSuperRarePrintMax: number;
  karutaSuperRareWishlistMin: number;
  karutaUltraRarePrintMax: number;
  karutaUltraRareWishlistMin: number;
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
    eventClassLabel: config.eventClassLabel?.trim().slice(0, 24) || undefined,
    eventRoles: normalizeEventRoles(config.eventRoles) ?? [],
    eventSpecEnabled: config.eventSpecEnabled ?? true,
    eventSpecLabel: config.eventSpecLabel?.trim().slice(0, 24) || undefined,
    karutaBotUserId: config.karutaBotUserId,
    karutaChannelId: config.karutaChannelId,
    karutaRarePrintMax: config.karutaRarePrintMax ?? 10,
    karutaRareWishlistMin: config.karutaRareWishlistMin ?? 3,
    karutaSuperRarePrintMax: config.karutaSuperRarePrintMax ?? 3,
    karutaSuperRareWishlistMin: config.karutaSuperRareWishlistMin ?? 10,
    karutaUltraRarePrintMax: config.karutaUltraRarePrintMax ?? 1,
    karutaUltraRareWishlistMin: config.karutaUltraRareWishlistMin ?? 25,
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
        eventClassLabel: normalized.eventClassLabel,
        eventRoles: normalized.eventRoles ?? [],
        eventSpecEnabled: normalized.eventSpecEnabled,
        eventSpecLabel: normalized.eventSpecLabel,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
        musicEnabled: normalized.musicEnabled,
        musicRoleIds: normalized.musicRoleIds,
        suggestionsDmUserId: normalized.suggestionsDmUserId,
        suggestionsDmTiers: normalized.suggestionsDmTiers,
        karutaBotUserId: normalized.karutaBotUserId,
        karutaChannelId: normalized.karutaChannelId,
        karutaRarePrintMax: normalized.karutaRarePrintMax,
        karutaRareWishlistMin: normalized.karutaRareWishlistMin,
        karutaSuperRarePrintMax: normalized.karutaSuperRarePrintMax,
        karutaSuperRareWishlistMin: normalized.karutaSuperRareWishlistMin,
        karutaUltraRarePrintMax: normalized.karutaUltraRarePrintMax,
        karutaUltraRareWishlistMin: normalized.karutaUltraRareWishlistMin,
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
        eventClassLabel: normalized.eventClassLabel,
        eventRoles: normalized.eventRoles ?? [],
        eventSpecEnabled: normalized.eventSpecEnabled,
        eventSpecLabel: normalized.eventSpecLabel,
        temporaryVoiceChannelIds: normalized.temporaryVoiceChannelIds,
        musicEnabled: normalized.musicEnabled,
        musicRoleIds: normalized.musicRoleIds,
        suggestionsDmUserId: normalized.suggestionsDmUserId,
        suggestionsDmTiers: normalized.suggestionsDmTiers,
        karutaBotUserId: normalized.karutaBotUserId,
        karutaChannelId: normalized.karutaChannelId,
        karutaRarePrintMax: normalized.karutaRarePrintMax,
        karutaRareWishlistMin: normalized.karutaRareWishlistMin,
        karutaSuperRarePrintMax: normalized.karutaSuperRarePrintMax,
        karutaSuperRareWishlistMin: normalized.karutaSuperRareWishlistMin,
        karutaUltraRarePrintMax: normalized.karutaUltraRarePrintMax,
        karutaUltraRareWishlistMin: normalized.karutaUltraRareWishlistMin,
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
