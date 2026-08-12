import { env } from "../config/env.js";

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

export { getErrorMessage, isRemoteStoreEnabled };
