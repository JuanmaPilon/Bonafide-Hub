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

/**
 * Lista todos los perfiles de XP de una guild (para exportar/migrar).
 */
export async function listXpProfiles(guildId: string): Promise<XpProfile[]> {
  const records = await prisma.xpProfile.findMany({
    where: { guildId },
    orderBy: [{ xp: "desc" }],
  });

  return records.map(toXpProfile);
}

export type XpImportEntry = {
  messageCount?: number;
  userId: string;
  voiceMinutes?: number;
  xp?: number;
  level?: number;
};

/**
 * Fija (upsert) el perfil de XP de un usuario con valores absolutos.
 * El nivel se recalcula desde la XP (respetando el cap si existe).
 */
export async function setXpProfile(input: {
  guildId: string;
  messageCount?: number;
  userId: string;
  voiceMinutes?: number;
  xp: number;
}): Promise<XpProfile> {
  const safeXp = Math.max(0, Math.floor(input.xp));
  const xpConfig = await getXpConfig(input.guildId);

  let nextLevel = levelForXp(safeXp, xpConfig.levelBaseXp);
  if (xpConfig.maxLevel > 0) {
    nextLevel = Math.min(nextLevel, xpConfig.maxLevel);
  }

  const existing = await getXpProfile(input.guildId, input.userId);
  const nextMessageCount = input.messageCount ?? existing?.messageCount ?? 0;
  const nextVoiceMinutes = input.voiceMinutes ?? existing?.voiceMinutes ?? 0;

  const record = await prisma.xpProfile.upsert({
    where: {
      guildId_userId: { guildId: input.guildId, userId: input.userId },
    },
    update: {
      level: nextLevel,
      messageCount: nextMessageCount,
      voiceMinutes: nextVoiceMinutes,
      xp: safeXp,
    },
    create: {
      guildId: input.guildId,
      level: nextLevel,
      messageCount: nextMessageCount,
      userId: input.userId,
      voiceMinutes: nextVoiceMinutes,
      xp: safeXp,
    },
  });

  return toXpProfile(record);
}

/**
 * Importa una lista de perfiles de XP (migración estilo Enguage/MEE6).
 * Si la entrada trae xp, se usa directo; si no, se deriva del level.
 */
export async function importXpEntries(
  guildId: string,
  entries: XpImportEntry[],
): Promise<{ imported: number }> {
  const xpConfig = await getXpConfig(guildId);
  let imported = 0;

  for (const entry of entries) {
    const userId = entry.userId?.trim();
    if (!userId) {
      continue;
    }

    const xp =
      typeof entry.xp === "number" && entry.xp >= 0
        ? Math.floor(entry.xp)
        : xpRequiredForLevel(
            Math.max(1, Math.floor(entry.level ?? 0)),
            xpConfig.levelBaseXp,
          );

    await setXpProfile({
      guildId,
      messageCount: entry.messageCount,
      userId,
      voiceMinutes: entry.voiceMinutes,
      xp,
    });

    imported += 1;
  }

  return { imported };
}
