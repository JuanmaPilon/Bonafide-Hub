import { prisma } from "../db/prisma.js";

export type XpRoleRule = {
  level: number;
  removeRoleIds: string[];
  roleId: string;
  xpMultiplier: number;
};

export type XpConfig = {
  cooldownSeconds: number;
  guildId: string;
  levelBaseXp: number;
  levelRoles: XpRoleRule[];
  maxLevel: number;
  messageXp: number;
  roleStacking: "stack" | "replace";
  voiceXpPerMinute: number;
};

const DEFAULT_CONFIG: Omit<XpConfig, "guildId"> = {
  cooldownSeconds: 60,
  levelBaseXp: 100,
  levelRoles: [],
  maxLevel: 0,
  messageXp: 15,
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
          level: Number(entry.level) || 0,
          removeRoleIds: normalizeRoleIds(entry.removeRoleIds),
          roleId: String(entry.roleId ?? ""),
          xpMultiplier: Number(entry.xpMultiplier) || 1,
        }))
        .filter((entry) => entry.level > 0 && entry.roleId)
        .sort((left, right) => left.level - right.level)
    : [];

  return {
    cooldownSeconds: record?.cooldownSeconds ?? DEFAULT_CONFIG.cooldownSeconds,
    guildId: record?.guildId ?? "",
    levelBaseXp: record?.levelBaseXp ?? DEFAULT_CONFIG.levelBaseXp,
    levelRoles,
    maxLevel: record?.maxLevel ?? DEFAULT_CONFIG.maxLevel,
    messageXp: record?.messageXp ?? DEFAULT_CONFIG.messageXp,
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
      level: Math.max(1, Math.floor(Number(rule.level) || 0)),
      removeRoleIds: normalizeRoleIds(rule.removeRoleIds),
      roleId: String(rule.roleId ?? "").trim(),
      xpMultiplier: Math.max(1, Number(rule.xpMultiplier) || 1),
    }))
    .filter((rule) => rule.roleId)
    .sort((left, right) => left.level - right.level);
}

export async function upsertXpConfig(input: {
  guildId: string;
  cooldownSeconds?: number;
  levelBaseXp?: number;
  levelRoles?: XpRoleRule[];
  maxLevel?: number;
  messageXp?: number;
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
