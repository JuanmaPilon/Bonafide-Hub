import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

type GuildConfig = {
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  memberLogChannelId?: string;
  musicEnabled?: boolean;
  musicRoleIds?: string[];
  reactionRoles?: ReactionRoleRule[];
  temporaryVoiceChannelIds?: string[];
  xpSyncRequested?: boolean;
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

function normalizeGuildConfig(input: GuildConfig): GuildConfig {
  return {
    dailyMessagesChannelId: input.dailyMessagesChannelId,
    dailyMessagesEnabled: input.dailyMessagesEnabled ?? false,
    dailyMessagesMaxMinutes: input.dailyMessagesMaxMinutes ?? 90,
    dailyMessagesMinMinutes: input.dailyMessagesMinMinutes ?? 15,
    defaultRoleId: input.defaultRoleId,
    dynamicVoiceCreateChannelId: input.dynamicVoiceCreateChannelId,
    memberLogChannelId: input.memberLogChannelId,
    musicEnabled: input.musicEnabled ?? true,
    musicRoleIds: input.musicRoleIds ?? [],
    reactionRoles: input.reactionRoles ?? [],
    temporaryVoiceChannelIds: input.temporaryVoiceChannelIds ?? [],
    xpSyncRequested: input.xpSyncRequested ?? false,
  };
}

function hasAnyConfigData(config: GuildConfig): boolean {
  return Boolean(
    config.dailyMessagesChannelId ||
    config.dynamicVoiceCreateChannelId ||
    config.memberLogChannelId ||
    (config.reactionRoles?.length ?? 0) > 0 ||
    (config.temporaryVoiceChannelIds?.length ?? 0) > 0,
  );
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

async function readLocalGuildConfig(guildId: string): Promise<GuildConfig> {
  const store = await readStore();
  return normalizeGuildConfig(store[guildId] ?? {});
}

async function writeLocalGuildConfig(
  guildId: string,
  config: GuildConfig,
): Promise<void> {
  const store = await readStore();
  store[guildId] = normalizeGuildConfig(config);
  await writeStore(store);
}

async function fetchRemoteGuildConfig(guildId: string): Promise<GuildConfig> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    throw new Error("Remote bot config store is not configured");
  }

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/config`,
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

  const controller = createTimeoutController(remoteTimeoutMs);
  const response = await fetch(
    `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/config`,
    {
      body: JSON.stringify({ config: normalizeGuildConfig(config) }),
      headers: {
        "content-type": "application/json",
        "x-bot-token": remoteApiToken,
      },
      method: "PUT",
      signal: controller.signal,
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
  const localConfig = await readLocalGuildConfig(guildId);

  if (isRemoteStoreEnabled()) {
    try {
      const remoteConfig = await fetchRemoteGuildConfig(guildId);

      if (!hasAnyConfigData(remoteConfig) && hasAnyConfigData(localConfig)) {
        const syncedConfig = await saveRemoteGuildConfig(guildId, localConfig);
        await writeLocalGuildConfig(guildId, syncedConfig);
        console.log(
          `[discord-bot] Synced local fallback config to remote store for guild ${guildId}.`,
        );
        return syncedConfig;
      }

      await writeLocalGuildConfig(guildId, remoteConfig);
      return remoteConfig;
    } catch (error: unknown) {
      console.warn(
        `[discord-bot] Remote config unavailable for guild ${guildId}, using local fallback: ${getErrorMessage(error)}`,
      );
    }
  }

  return localConfig;
}

async function mutateGuildConfig(
  guildId: string,
  updater: (current: GuildConfig) => GuildConfig,
): Promise<GuildConfig> {
  if (isRemoteStoreEnabled()) {
    try {
      const current = await fetchRemoteGuildConfig(guildId);
      const next = normalizeGuildConfig(updater(current));
      const saved = await saveRemoteGuildConfig(guildId, next);
      await writeLocalGuildConfig(guildId, saved);
      return saved;
    } catch (error: unknown) {
      console.warn(
        `[discord-bot] Remote config update failed for guild ${guildId}, using local fallback: ${getErrorMessage(error)}`,
      );
    }
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

export async function setXpSyncRequested(
  guildId: string,
  requested: boolean,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => ({
    ...current,
    xpSyncRequested: requested,
  }));
}

export async function clearGuildMemberLogChannelId(
  guildId: string,
): Promise<void> {
  await mutateGuildConfig(guildId, (current) => {
    const { memberLogChannelId: _ignored, ...restConfig } = current;
    return restConfig;
  });
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

export async function removeReactionRoleRulesForMessage(
  guildId: string,
  messageId: string,
): Promise<number> {
  const current = await getGuildConfig(guildId);
  const existingRules = current.reactionRoles ?? [];
  const updatedRules = existingRules.filter(
    (rule) => rule.messageId !== messageId,
  );
  const removedCount = existingRules.length - updatedRules.length;

  if (removedCount === 0) {
    return 0;
  }

  await mutateGuildConfig(guildId, (draft) => ({
    ...draft,
    reactionRoles: updatedRules,
  }));

  return removedCount;
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
