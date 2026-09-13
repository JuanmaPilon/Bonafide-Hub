import { prisma } from "../db/prisma.js";
import { EVENT_TEMPLATES, findEventTemplate } from "./event-templates.js";

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

// Juego configurado por la guild: sus roles de inscripción y su etiqueta.
// El catálogo de clases/specs vive en RaidSpec con el mismo `key` en `game`.
export type EventGameConfig = {
  key: string;
  label: string;
  roles: EventRoleOption[];
};

// Juego efectivo que se ofrece en los selectores: lo configurado por la guild
// o, si ese juego no fue personalizado, los roles de la plantilla del código.
export type EventGameOption = EventGameConfig & {
  // true = roles definidos por la guild; false = los de la plantilla.
  configured: boolean;
};

export const DEFAULT_EVENT_ROLES: EventRoleOption[] = [
  { animated: false, emoji: "🛡️", key: "tank", label: "Tank" },
  { animated: false, emoji: "💚", key: "healer", label: "Healer" },
  { animated: false, emoji: "⚔️", key: "melee", label: "Melee" },
  { animated: false, emoji: "🏹", key: "ranged", label: "Range" },
];

// Juego por defecto cuando la guild no configuró ninguno y el evento no
// especifica otro (los eventos anteriores al juego por evento son de WoW).
export const DEFAULT_EVENT_GAME = "wow";

// La clave de los roles es interna (nunca se muestra) y está guardada en las
// inscripciones y en la config de cada guild, así que no se renombra: solo
// se corrige la ETIQUETA visible (el rol `ranged` se muestra como "Range").
function normalizeRoleLabel(key: string, label: string): string {
  return key === "ranged" && /^ranged$/i.test(label) ? "Range" : label;
}

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
    const label = String(raw.label ?? "")
      .trim()
      .slice(0, 24);
    if (!key || !label || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const emojiId = String(raw.emojiId ?? "").trim() || undefined;
    const emojiName = String(raw.emojiName ?? "").trim() || undefined;
    const emoji =
      String(raw.emoji ?? "")
        .trim()
        .slice(0, 8) || undefined;

    roles.push({
      animated: emojiId ? Boolean(raw.animated) : false,
      // El emoji custom manda; el unicode queda como texto alternativo.
      emoji: emojiId ? undefined : emoji,
      emojiId,
      emojiName: emojiName ?? (emojiId ? "emoji" : undefined),
      key,
      label: normalizeRoleLabel(key, label),
    });

    if (roles.length >= 12) {
      break;
    }
  }

  return roles;
}

// Sanea la lista de juegos que manda el panel: clave en minúscula, etiqueta
// corta y roles saneados con la misma regla que los roles sueltos.
export function normalizeEventGames(value: unknown): EventGameConfig[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const games: EventGameConfig[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const key = normalizeKey(raw.key);
    const label = String(raw.label ?? "")
      .trim()
      .slice(0, 40);
    if (!key || !label || seen.has(key)) {
      continue;
    }
    seen.add(key);
    games.push({
      key,
      label,
      roles: normalizeEventRoles(raw.roles) ?? [],
    });

    if (games.length >= 12) {
      break;
    }
  }

  return games;
}

// Clave interna de un juego/rol (slug): minúsculas, sin espacios ni símbolos.
function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

// Roles efectivos de un juego: los configurados por la guild para ese juego o,
// si no los personalizó, los de su plantilla (wow/lol del código). Sin juego
// conocido se cae a los 4 clásicos, así un juego borrado nunca deja el roster
// sin roles.
export function resolveEventRoles(
  config: { eventGames?: unknown } | null | undefined,
  game?: string | null,
): EventRoleOption[] {
  const key = normalizeKey(game) || DEFAULT_EVENT_GAME;
  const configured = normalizeEventGames(config?.eventGames)?.find(
    (entry) => entry.key === key,
  );
  if (configured && configured.roles.length > 0) {
    return configured.roles;
  }
  return findEventTemplate(key)?.roles ?? DEFAULT_EVENT_ROLES;
}

// Juegos que puede elegir un evento: los configurados por la guild y, si
// todavía no personalizó ninguno, las plantillas del código (así el selector
// nunca queda vacío). Se completa con la plantilla de los juegos que la guild
// tenga configurados sin roles propios.
export function resolveEventGames(
  config: { eventGames?: unknown } | null | undefined,
): EventGameOption[] {
  const configured = normalizeEventGames(config?.eventGames) ?? [];
  const keys = new Set(configured.map((game) => game.key));

  for (const template of EVENT_TEMPLATES) {
    keys.add(template.key);
  }

  const games: EventGameOption[] = [];
  for (const key of keys) {
    const custom = configured.find((game) => game.key === key);
    const template = findEventTemplate(key);
    games.push({
      configured: Boolean(custom && custom.roles.length > 0),
      key,
      label: custom?.label ?? template?.label ?? key,
      roles:
        custom && custom.roles.length > 0
          ? custom.roles
          : (template?.roles ?? DEFAULT_EVENT_ROLES),
    });
  }
  return games;
}

// Etiqueta visible de un juego (para el aviso de Discord y el panel).
export function resolveGameLabel(
  config: { eventGames?: unknown } | null | undefined,
  game?: string | null,
): string {
  const key = normalizeKey(game) || DEFAULT_EVENT_GAME;
  return (
    resolveEventGames(config).find((entry) => entry.key === key)?.label ?? key
  );
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
  eventGames?: EventGameConfig[];
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
    eventGames: unknown;
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
    eventGames: normalizeEventGames(record.eventGames) ?? undefined,
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
  eventGames?: EventGameConfig[];
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
    eventGames: normalizeEventGames(config.eventGames) ?? [],
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
        eventGames: normalized.eventGames ?? [],
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
        eventGames: normalized.eventGames ?? [],
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
