import { prisma } from "../db/prisma.js";

export type XpRoleMultiplier = {
  multiplier: number;
  roleId: string;
};

export type XpRoleRule = {
  addRoleIds: string[];
  color?: string;
  level: number;
  nicknamePrefix?: string;
  removeRoleIds: string[];
  roleId: string;
  stacking: "stack" | "replace";
};

function normalizeColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

export type XpConfig = {
  cooldownSeconds: number;
  guildId: string;
  levelBaseXp: number;
  levelRoles: XpRoleRule[];
  maxLevel: number;
  messageXp: number;
  roleMultipliers: XpRoleMultiplier[];
  roleStacking: "stack" | "replace";
  voiceXpPerMinute: number;
};

const DEFAULT_CONFIG: Omit<XpConfig, "guildId"> = {
  cooldownSeconds: 60,
  levelBaseXp: 100,
  levelRoles: [],
  maxLevel: 0,
  messageXp: 15,
  roleMultipliers: [],
  roleStacking: "stack",
  voiceXpPerMinute: 3,
};

type XpConfigRecord = {
  cooldownSeconds: number;
  guildId: string;
  levelBaseXp: number;
  levelRoles: unknown;
  maxLevel: number;
  messageXp: number;
  roleMultipliers: unknown;
  roleStacking: string;
  voiceXpPerMinute: number;
};

function normalizeRoleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => String(entry).trim()).filter(Boolean);
}

function toXpConfig(record: XpConfigRecord | null): XpConfig {
  const levelRoles = Array.isArray(record?.levelRoles)
    ? (record.levelRoles as unknown[])
        .filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null,
        )
        .map((entry) => ({
          addRoleIds: normalizeRoleIds(entry.addRoleIds),
          color: normalizeColor(entry.color),
          level: Number(entry.level) || 0,
          nicknamePrefix:
            typeof entry.nicknamePrefix === "string" &&
            entry.nicknamePrefix.trim()
              ? entry.nicknamePrefix.trim()
              : undefined,
          removeRoleIds: normalizeRoleIds(entry.removeRoleIds),
          roleId: String(entry.roleId ?? ""),
          stacking: (entry.stacking === "replace"
            ? "replace"
            : record?.roleStacking === "replace"
              ? "replace"
              : "stack") as "stack" | "replace",
        }))
        .filter((entry) => entry.level >= 0 && entry.roleId)
        .sort((left, right) => left.level - right.level)
    : [];

  const roleMultipliers = Array.isArray(record?.roleMultipliers)
    ? (record.roleMultipliers as unknown[])
        .filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null,
        )
        .map((entry) => ({
          multiplier: Math.max(1, Number(entry.multiplier) || 1),
          roleId: String(entry.roleId ?? "").trim(),
        }))
        .filter((entry) => entry.roleId)
    : [];

  return {
    cooldownSeconds: record?.cooldownSeconds ?? DEFAULT_CONFIG.cooldownSeconds,
    guildId: record?.guildId ?? "",
    levelBaseXp: record?.levelBaseXp ?? DEFAULT_CONFIG.levelBaseXp,
    levelRoles,
    maxLevel: record?.maxLevel ?? DEFAULT_CONFIG.maxLevel,
    messageXp: record?.messageXp ?? DEFAULT_CONFIG.messageXp,
    roleMultipliers,
    roleStacking: record?.roleStacking === "replace" ? "replace" : "stack",
    voiceXpPerMinute:
      record?.voiceXpPerMinute ?? DEFAULT_CONFIG.voiceXpPerMinute,
  };
}

export async function getXpConfig(guildId: string): Promise<XpConfig> {
  const record = await prisma.xpConfig.findUnique({ where: { guildId } });
  return toXpConfig(record);
}

function normalizeLevelRoles(
  levelRoles: XpRoleRule[] | undefined,
): XpRoleRule[] {
  if (!levelRoles) {
    return [];
  }

  return levelRoles
    .map((rule) => ({
      addRoleIds: normalizeRoleIds(rule.addRoleIds),
      color: normalizeColor(rule.color),
      level: Math.max(0, Math.floor(Number(rule.level) || 0)),
      nicknamePrefix:
        typeof rule.nicknamePrefix === "string" && rule.nicknamePrefix.trim()
          ? rule.nicknamePrefix.trim()
          : undefined,
      removeRoleIds: normalizeRoleIds(rule.removeRoleIds),
      roleId: String(rule.roleId ?? "").trim(),
      stacking: (rule.stacking === "replace" ? "replace" : "stack") as
        | "stack"
        | "replace",
    }))
    .filter((rule) => rule.roleId)
    .sort((left, right) => left.level - right.level);
}

function normalizeRoleMultipliers(
  roleMultipliers: XpRoleMultiplier[] | undefined,
): XpRoleMultiplier[] {
  if (!roleMultipliers) {
    return [];
  }

  return roleMultipliers
    .map((entry) => ({
      multiplier: Math.max(1, Number(entry.multiplier) || 1),
      roleId: String(entry.roleId ?? "").trim(),
    }))
    .filter((entry) => entry.roleId);
}

export async function upsertXpConfig(input: {
  guildId: string;
  cooldownSeconds?: number;
  levelBaseXp?: number;
  levelRoles?: XpRoleRule[];
  maxLevel?: number;
  messageXp?: number;
  roleMultipliers?: XpRoleMultiplier[];
  roleStacking?: "stack" | "replace";
  voiceXpPerMinute?: number;
}): Promise<XpConfig> {
  const current = await getXpConfig(input.guildId);
  const next = {
    cooldownSeconds: input.cooldownSeconds ?? current.cooldownSeconds,
    levelBaseXp: input.levelBaseXp ?? current.levelBaseXp,
    levelRoles: input.levelRoles
      ? normalizeLevelRoles(input.levelRoles)
      : current.levelRoles,
    maxLevel: input.maxLevel ?? current.maxLevel,
    messageXp: input.messageXp ?? current.messageXp,
    roleMultipliers: input.roleMultipliers
      ? normalizeRoleMultipliers(input.roleMultipliers)
      : current.roleMultipliers,
    roleStacking: input.roleStacking ?? current.roleStacking,
    voiceXpPerMinute: input.voiceXpPerMinute ?? current.voiceXpPerMinute,
  };

  await prisma.xpConfig.upsert({
    where: { guildId: input.guildId },
    update: {
      cooldownSeconds: next.cooldownSeconds,
      levelBaseXp: next.levelBaseXp,
      levelRoles: next.levelRoles,
      maxLevel: next.maxLevel,
      messageXp: next.messageXp,
      roleMultipliers: next.roleMultipliers,
      roleStacking: next.roleStacking,
      voiceXpPerMinute: next.voiceXpPerMinute,
    },
    create: {
      guildId: input.guildId,
      ...next,
    },
  });

  return {
    guildId: input.guildId,
    ...next,
  };
}

/**
 * XP total acumulada necesaria para alcanzar un nivel dado.
 * Formula: base * N * (N + 1) / 2
 *
 * Nivel 1 -> base
 * Nivel 2 -> 3 * base
 * Nivel 3 -> 6 * base
 * Nivel 4 -> 10 * base
 * ...
 */
export function xpRequiredForLevel(level: number, levelBaseXp: number): number {
  const n = Math.max(1, Math.floor(level));
  return (levelBaseXp * (n * (n + 1))) / 2;
}

/**
 * Calcula el nivel actual a partir de la XP acumulada total.
 */
export function levelForXp(totalXp: number, levelBaseXp: number): number {
  if (totalXp <= 0) {
    return 0;
  }

  let level = 0;
  while (xpRequiredForLevel(level + 1, levelBaseXp) <= totalXp) {
    level += 1;
  }

  return level;
}
