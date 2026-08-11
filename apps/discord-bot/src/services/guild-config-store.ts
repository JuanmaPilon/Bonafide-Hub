import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

type GuildConfig = {
  dynamicVoiceCreateChannelId?: string;
  memberLogChannelId?: string;
  reactionRoles?: ReactionRoleRule[];
  temporaryVoiceChannelIds?: string[];
};

export type ReactionRoleRule = {
  channelId?: string;
  emojiKey: string;
  messageId: string;
  mode?: ReactionRoleMode;
  roleId: string;
};

export type ReactionRoleMode = "multiple" | "unique" | "additive";

type GuildConfigStore = Record<string, GuildConfig>;

const dataDirPath = path.resolve(process.cwd(), "data");
const configFilePath = path.resolve(dataDirPath, "guild-config.json");
const remoteApiBaseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const remoteApiToken = env.BOT_CONFIG_API_TOKEN?.trim();

function isRemoteStoreEnabled(): boolean {
  return Boolean(remoteApiBaseUrl && remoteApiToken);
}

function normalizeGuildConfig(input: GuildConfig): GuildConfig {
  return {
    dynamicVoiceCreateChannelId: input.dynamicVoiceCreateChannelId,
    memberLogChannelId: input.memberLogChannelId,
    reactionRoles: input.reactionRoles ?? [],
    temporaryVoiceChannelIds: input.temporaryVoiceChannelIds ?? [],
  };
}

async function fetchRemoteGuildConfig(guildId: string): Promise<GuildConfig> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot config store is not configured");
  }

  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/config`,
    {
      headers: {
        "x-bot-token": remoteApiToken,
      },
      method: "GET",
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(
      `Remote guild config fetch failed (${response.status}): ${details}`,
    );
  }

  const payload = (await response.json()) as {
    config?: GuildConfig;
    ok?: boolean;
  };

  return normalizeGuildConfig(payload.config ?? {});
}

async function saveRemoteGuildConfig(
  guildId: string,
  config: GuildConfig,
): Promise<GuildConfig> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot config store is not configured");
  }

  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/config`,
    {
      body: JSON.stringify({ config: normalizeGuildConfig(config) }),
      headers: {
        "content-type": "application/json",
        "x-bot-token": remoteApiToken,
      },
      method: "PUT",
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(
      `Remote guild config save failed (${response.status}): ${details}`,
    );
  }

  const payload = (await response.json()) as {
    config?: GuildConfig;
    ok?: boolean;
  };

  return normalizeGuildConfig(payload.config ?? config);
}

async function readStore(): Promise<GuildConfigStore> {
  try {
    const raw = await readFile(configFilePath, "utf8");
    const parsed = JSON.parse(raw) as GuildConfigStore;

    return parsed;
  } catch (error: unknown) {
    const maybeFsError = error as NodeJS.ErrnoException;
    if (maybeFsError.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeStore(store: GuildConfigStore): Promise<void> {
  await mkdir(dataDirPath, { recursive: true });
  await writeFile(configFilePath, JSON.stringify(store, null, 2), "utf8");
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  if (isRemoteStoreEnabled()) {
    return fetchRemoteGuildConfig(guildId);
  }

  const store = await readStore();
  return normalizeGuildConfig(store[guildId] ?? {});
}

async function mutateGuildConfig(
  guildId: string,
  updater: (current: GuildConfig) => GuildConfig,
): Promise<GuildConfig> {
  if (isRemoteStoreEnabled()) {
    const current = await fetchRemoteGuildConfig(guildId);
    const next = normalizeGuildConfig(updater(current));
    return saveRemoteGuildConfig(guildId, next);
  }

  const store = await readStore();
  const current = normalizeGuildConfig(store[guildId] ?? {});
  const next = normalizeGuildConfig(updater(current));
  store[guildId] = next;
  await writeStore(store);

  return next;
}

export async function setGuildMemberLogChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => ({
    ...current,
    memberLogChannelId: channelId,
  }));
}

export async function setGuildDynamicVoiceCreateChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => ({
    ...current,
    dynamicVoiceCreateChannelId: channelId,
  }));
}

export async function clearGuildDynamicVoiceCreateChannelId(
  guildId: string,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => {
    const { dynamicVoiceCreateChannelId: _ignored, ...restConfig } = current;
    return restConfig;
  });
}

export async function addTemporaryVoiceChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => {
    const existingIds = current.temporaryVoiceChannelIds ?? [];
    if (existingIds.includes(channelId)) {
      return current;
    }

    return {
      ...current,
      temporaryVoiceChannelIds: [...existingIds, channelId],
    };
  });
}

export async function removeTemporaryVoiceChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => {
    const existingIds = current.temporaryVoiceChannelIds ?? [];
    if (!existingIds.length) {
      return current;
    }

    return {
      ...current,
      temporaryVoiceChannelIds: existingIds.filter((id) => id !== channelId),
    };
  });
}

export async function isTemporaryVoiceChannel(
  guildId: string,
  channelId: string,
): Promise<boolean> {
  const config = await getGuildConfig(guildId);
  return config.temporaryVoiceChannelIds?.includes(channelId) ?? false;
}

export async function upsertReactionRoleRule(
  guildId: string,
  rule: ReactionRoleRule,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => {
    const existingRules = current.reactionRoles ?? [];
    const filteredRules = existingRules.filter(
      (existingRule) =>
        !(
          existingRule.messageId === rule.messageId &&
          existingRule.emojiKey === rule.emojiKey
        ),
    );

    return {
      ...current,
      reactionRoles: [...filteredRules, rule],
    };
  });
}

export async function removeReactionRoleRule(
  guildId: string,
  messageId: string,
  emojiKey: string,
): Promise<boolean> {
  const current = await getGuildConfig(guildId);
  const existingRules = current.reactionRoles ?? [];
  const updatedRules = existingRules.filter(
    (rule) => !(rule.messageId === messageId && rule.emojiKey === emojiKey),
  );

  if (updatedRules.length === existingRules.length) {
    return false;
  }

  await mutateGuildConfig(guildId, (draft) => ({
    ...draft,
    reactionRoles: updatedRules,
  }));

  return true;
}

export async function listReactionRoleRules(
  guildId: string,
): Promise<ReactionRoleRule[]> {
  const config = await getGuildConfig(guildId);
  return config.reactionRoles ?? [];
}

export async function findReactionRoleRule(
  guildId: string,
  messageId: string,
  emojiKey: string,
): Promise<ReactionRoleRule | null> {
  const rules = await listReactionRoleRules(guildId);
  const rule = rules.find(
    (entry) => entry.messageId === messageId && entry.emojiKey === emojiKey,
  );

  return rule ?? null;
}

export async function updateReactionRoleModeForMessage(
  guildId: string,
  messageId: string,
  mode: ReactionRoleMode,
): Promise<number> {
  const current = await getGuildConfig(guildId);
  const existingRules = current.reactionRoles ?? [];
  let updatedCount = 0;

  const updatedRules = existingRules.map((rule) => {
    if (rule.messageId !== messageId) {
      return rule;
    }

    updatedCount += 1;
    return {
      ...rule,
      mode,
    };
  });

  if (updatedCount > 0) {
    await mutateGuildConfig(guildId, (draft) => ({
      ...draft,
      reactionRoles: updatedRules,
    }));
  }

  return updatedCount;
}
