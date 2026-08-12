import { prisma } from "../db/prisma.js";
import {
  getXpConfig,
  levelForXp,
  xpRequiredForLevel,
} from "./xp-config-store.js";

export type XpProfile = {
  guildId: string;
  level: number;
  messageCount: number;
  updatedAt: string;
  userId: string;
  voiceMinutes: number;
  xp: number;
};

export type AddXpResult = {
  level: number;
  leveledUp: boolean;
  previousLevel: number;
  profile: XpProfile;
  xp: number;
};

function toXpProfile(record: {
  guildId: string;
  level: number;
  messageCount: number;
  updatedAt: Date;
  userId: string;
  voiceMinutes: number;
  xp: number;
}): XpProfile {
  return {
    guildId: record.guildId,
    level: record.level,
    messageCount: record.messageCount,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    voiceMinutes: record.voiceMinutes,
    xp: record.xp,
  };
}

export async function getXpProfile(
  guildId: string,
  userId: string,
): Promise<XpProfile | null> {
  const record = await prisma.xpProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });

  return record ? toXpProfile(record) : null;
}

/**
 * Registra XP acumulada para un usuario en una guild y recalcula su nivel.
 * La XP es acumulativa: se suma al total y el nivel se deriva de la formula.
 * Si hay un cap de nivel (maxLevel > 0), el nivel no sube mas alla del cap,
 * pero la XP, mensajes y minutos se siguen acumulando.
 */
export async function addXp(input: {
  amount: number;
  guildId: string;
  source?: "message" | "voice";
  userId: string;
}): Promise<AddXpResult> {
  const safeAmount = Math.max(0, Math.floor(input.amount));
  const source = input.source ?? "message";

  const existing = await getXpProfile(input.guildId, input.userId);
  const xpConfig = await getXpConfig(input.guildId);

  if (safeAmount === 0) {
    const profile = existing ?? {
      guildId: input.guildId,
      level: 0,
      messageCount: 0,
      updatedAt: new Date().toISOString(),
      userId: input.userId,
      voiceMinutes: 0,
      xp: 0,
    };

    return {
      level: profile.level,
      leveledUp: false,
      previousLevel: profile.level,
      profile,
      xp: profile.xp,
    };
  }

  const previousXp = existing?.xp ?? 0;
  const previousLevel = existing?.level ?? 0;
  const nextXp = previousXp + safeAmount;

  let nextLevel = levelForXp(nextXp, xpConfig.levelBaseXp);
  if (xpConfig.maxLevel > 0) {
    nextLevel = Math.min(nextLevel, xpConfig.maxLevel);
  }

  const nextMessageCount =
    (existing?.messageCount ?? 0) + (source === "message" ? 1 : 0);
  const nextVoiceMinutes =
    (existing?.voiceMinutes ?? 0) + (source === "voice" ? 1 : 0);

  const record = await prisma.xpProfile.upsert({
    where: {
      guildId_userId: {
        guildId: input.guildId,
        userId: input.userId,
      },
    },
    update: {
      level: nextLevel,
      messageCount: nextMessageCount,
      voiceMinutes: nextVoiceMinutes,
      xp: nextXp,
    },
    create: {
      guildId: input.guildId,
      level: nextLevel,
      messageCount: nextMessageCount,
      userId: input.userId,
      voiceMinutes: nextVoiceMinutes,
      xp: nextXp,
    },
  });

  return {
    level: nextLevel,
    leveledUp: nextLevel > previousLevel,
    previousLevel,
    profile: toXpProfile(record),
    xp: nextXp,
  };
}

/**
 * Devuelve el XP necesario para alcanzar el proximo nivel a partir del actual.
 */
export async function xpToNextLevel(
  guildId: string,
  userId: string,
): Promise<number | null> {
  const xpConfig = await getXpConfig(guildId);
  const profile = await getXpProfile(guildId, userId);

  if (!profile) {
    return xpRequiredForLevel(1, xpConfig.levelBaseXp);
  }

  return (
    xpRequiredForLevel(profile.level + 1, xpConfig.levelBaseXp) - profile.xp
  );
}

export type LeaderboardEntry = {
  level: number;
  messageCount: number;
  rank: number;
  userId: string;
  voiceMinutes: number;
  xp: number;
};

export async function getLeaderboard(
  guildId: string,
  limit = 20,
): Promise<LeaderboardEntry[]> {
  const records = await prisma.xpProfile.findMany({
    where: { guildId },
    orderBy: [{ xp: "desc" }],
    take: Math.min(50, Math.max(1, limit)),
  });

  return records.map((record, index) => ({
    level: record.level,
    messageCount: record.messageCount,
    rank: index + 1,
    userId: record.userId,
    voiceMinutes: record.voiceMinutes,
    xp: record.xp,
  }));
}
