import { env } from "../config/env.js";

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

export type AddXpResult = {
  level: number;
  leveledUp: boolean;
  previousLevel: number;
  xp: number;
};

const remoteApiBaseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const remoteApiToken = env.BOT_CONFIG_API_TOKEN?.trim();
const remoteTimeoutMs = 4000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRemoteStoreEnabled(): boolean {
  return Boolean(remoteApiBaseUrl && remoteApiToken);
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

function normalizeXpConfig(input: Partial<XpConfig>): XpConfig {
  return {
    cooldownSeconds: input.cooldownSeconds ?? 60,
    guildId: input.guildId ?? "",
    levelBaseXp: input.levelBaseXp ?? 100,
    levelRoles: input.levelRoles ?? [],
    maxLevel: input.maxLevel ?? 0,
    messageXp: input.messageXp ?? 15,
    roleMultipliers: input.roleMultipliers ?? [],
    roleStacking: input.roleStacking === "replace" ? "replace" : "stack",
    voiceXpPerMinute: input.voiceXpPerMinute ?? 3,
  };
}

export async function fetchRemoteXpConfig(guildId: string): Promise<XpConfig> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot xp store is not configured");
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/xp-config`,
    {
      headers: {
        "x-bot-token": remoteApiToken,
      },
      method: "GET",
      signal: controller.signal,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(
      `Remote xp config fetch failed (${response.status}): ${details}`,
    );
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    xpConfig?: Partial<XpConfig>;
  };

  return normalizeXpConfig(payload.xpConfig ?? {});
}

export async function addRemoteXp(input: {
  amount: number;
  guildId: string;
  source?: "message" | "voice";
  userId: string;
}): Promise<AddXpResult> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot xp store is not configured");
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(input.guildId)}/xp/add`,
    {
      body: JSON.stringify({
        amount: input.amount,
        source: input.source ?? "message",
        userId: input.userId,
      }),
      headers: {
        "content-type": "application/json",
        "x-bot-token": remoteApiToken,
      },
      method: "POST",
      signal: controller.signal,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(`Remote xp add failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as {
    level?: number;
    leveledUp?: boolean;
    ok?: boolean;
    previousLevel?: number;
    xp?: number;
  };

  return {
    level: payload.level ?? 0,
    leveledUp: payload.leveledUp ?? false,
    previousLevel: payload.previousLevel ?? 0,
    xp: payload.xp ?? 0,
  };
}

export async function setRemoteXpLevel(input: {
  action: "add" | "remove" | "set" | "reset";
  guildId: string;
  level?: number;
  userId: string;
}): Promise<{ level: number; xp: number }> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot xp store is not configured");
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(input.guildId)}/xp/level`,
    {
      body: JSON.stringify({
        action: input.action,
        level: input.level,
        userId: input.userId,
      }),
      headers: {
        "content-type": "application/json",
        "x-bot-token": remoteApiToken,
      },
      method: "POST",
      signal: controller.signal,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(
      `Remote xp level update failed (${response.status}): ${details}`,
    );
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    profile?: { level?: number; xp?: number };
  };

  return {
    level: payload.profile?.level ?? 0,
    xp: payload.profile?.xp ?? 0,
  };
}

/**
 * Calcula el multiplicador de XP de un miembro a partir de sus roles.
 * Se multiplican los multiplicadores de todos los roles de la config que el
 * miembro tenga (por ejemplo Booster x3 * VIP x2 = x6).
 */
export function computeXpMultiplier(
  config: XpConfig,
  memberRoleIds: ReadonlySet<string> | string[],
): number {
  if (!config.roleMultipliers || config.roleMultipliers.length === 0) {
    return 1;
  }

  const roleSet = new Set(memberRoleIds);

  let multiplier = 1;
  for (const entry of config.roleMultipliers) {
    if (roleSet.has(entry.roleId) && entry.multiplier > 1) {
      multiplier *= entry.multiplier;
    }
  }

  return multiplier;
}

export async function fetchRemoteXpProfiles(
  guildId: string,
): Promise<Array<{ level: number; userId: string; xp: number }>> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot xp store is not configured");
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/xp/profiles`,
    {
      headers: {
        "x-bot-token": remoteApiToken,
      },
      method: "GET",
      signal: controller.signal,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(
      `Remote xp profiles fetch failed (${response.status}): ${details}`,
    );
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    profiles?: Array<{ level?: number; userId?: string; xp?: number }>;
  };

  return (payload.profiles ?? []).map((profile) => ({
    level: profile.level ?? 0,
    userId: profile.userId ?? "",
    xp: profile.xp ?? 0,
  }));
}

export { getErrorMessage, isRemoteStoreEnabled };
