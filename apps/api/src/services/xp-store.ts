import { prisma } from "../db/prisma.js";
import {
  getXpConfig,
  levelForXp,
  xpRequiredForLevel,
} from "./xp-config-store.js";

export type XpProfile = {
  guildId: string;
  level: number;
  updatedAt: string;
  userId: string;
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
  updatedAt: Date;
  userId: string;
  xp: number;
}): XpProfile {
  return {
    guildId: record.guildId,
    level: record.level,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
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
 */
export async function addXp(input: {
  amount: number;
  guildId: string;
  userId: string;
}): Promise<AddXpResult> {
  const safeAmount = Math.max(0, Math.floor(input.amount));

  if (safeAmount === 0) {
    const existing = await getXpProfile(input.guildId, input.userId);
    const levelBaseXp = (await getXpConfig(input.guildId)).levelBaseXp;

    const profile = existing ?? {
      guildId: input.guildId,
      level: 0,
      updatedAt: new Date().toISOString(),
      userId: input.userId,
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

  const xpConfig = await getXpConfig(input.guildId);
  const current = await prisma.xpProfile.findUnique({
    where: {
      guildId_userId: {
        guildId: input.guildId,
        userId: input.userId,
      },
    },
  });

  const previousXp = current?.xp ?? 0;
  const nextXp = previousXp + safeAmount;
  const nextLevel = levelForXp(nextXp, xpConfig.levelBaseXp);
  const previousLevel =
    current?.level ?? levelForXp(previousXp, xpConfig.levelBaseXp);

  const record = await prisma.xpProfile.upsert({
    where: {
      guildId_userId: {
        guildId: input.guildId,
        userId: input.userId,
      },
    },
    update: {
      level: nextLevel,
      xp: nextXp,
    },
    create: {
      guildId: input.guildId,
      level: nextLevel,
      userId: input.userId,
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
