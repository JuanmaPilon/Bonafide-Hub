import { env } from "../config/env.js";

export type ReactionRolePair = {
  emoji: string;
  roleId: string;
};

export type PendingReactionRoleJob = {
  action: string;
  channelId: string | null;
  description: string | null;
  guildId: string;
  id: string;
  messageId: string | null;
  mode: string;
  rules: ReactionRolePair[];
  title: string | null;
};

const remoteApiBaseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const remoteApiToken = env.BOT_CONFIG_API_TOKEN?.trim();
const remoteTimeoutMs = 4000;

function isRemoteStoreEnabled(): boolean {
  return Boolean(remoteApiBaseUrl && remoteApiToken);
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

export async function fetchPendingReactionRoleJobs(
  guildId: string,
): Promise<PendingReactionRoleJob[]> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    return [];
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/reaction-roles/jobs`,
    {
      headers: {
        "x-bot-token": remoteApiToken,
      },
      method: "GET",
      signal: controller.signal,
    },
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    jobs?: PendingReactionRoleJob[];
    ok?: boolean;
  };

  return payload.jobs ?? [];
}

export async function completeReactionRoleJob(
  guildId: string,
  jobId: string,
  input: { error?: string; messageId?: string },
): Promise<void> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    return;
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/reaction-roles/jobs/${encodeURIComponent(jobId)}/complete`,
    {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "x-bot-token": remoteApiToken,
      },
      method: "POST",
      signal: controller.signal,
    },
  ).catch(() => undefined);
}
