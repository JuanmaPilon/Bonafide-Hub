import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  const store = await readStore();
  return store[guildId] ?? {};
}

export async function setGuildMemberLogChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  const store = await readStore();

  store[guildId] = {
    ...store[guildId],
    memberLogChannelId: channelId,
  };

  await writeStore(store);
}

export async function setGuildDynamicVoiceCreateChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  const store = await readStore();

  store[guildId] = {
    ...store[guildId],
    dynamicVoiceCreateChannelId: channelId,
  };

  await writeStore(store);
}

export async function clearGuildDynamicVoiceCreateChannelId(
  guildId: string,
): Promise<void> {
  const store = await readStore();
  const current = store[guildId];

  if (!current) {
    return;
  }

  const { dynamicVoiceCreateChannelId: _ignored, ...restConfig } = current;
  store[guildId] = restConfig;
  await writeStore(store);
}

export async function addTemporaryVoiceChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  const store = await readStore();
  const current = store[guildId] ?? {};
  const existingIds = current.temporaryVoiceChannelIds ?? [];

  if (existingIds.includes(channelId)) {
    return;
  }

  store[guildId] = {
    ...current,
    temporaryVoiceChannelIds: [...existingIds, channelId],
  };

  await writeStore(store);
}

export async function removeTemporaryVoiceChannelId(
  guildId: string,
  channelId: string,
): Promise<void> {
  const store = await readStore();
  const current = store[guildId];

  if (!current?.temporaryVoiceChannelIds?.length) {
    return;
  }

  const updatedIds = current.temporaryVoiceChannelIds.filter(
    (id) => id !== channelId,
  );

  store[guildId] = {
    ...current,
    temporaryVoiceChannelIds: updatedIds,
  };

  await writeStore(store);
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
  const store = await readStore();
  const current = store[guildId] ?? {};
  const existingRules = current.reactionRoles ?? [];

  const filteredRules = existingRules.filter(
    (existingRule) =>
      !(
        existingRule.messageId === rule.messageId &&
        existingRule.emojiKey === rule.emojiKey
      ),
  );

  store[guildId] = {
    ...current,
    reactionRoles: [...filteredRules, rule],
  };

  await writeStore(store);
}

export async function removeReactionRoleRule(
  guildId: string,
  messageId: string,
  emojiKey: string,
): Promise<boolean> {
  const store = await readStore();
  const current = store[guildId];
  const existingRules = current?.reactionRoles ?? [];
  const updatedRules = existingRules.filter(
    (rule) => !(rule.messageId === messageId && rule.emojiKey === emojiKey),
  );

  if (updatedRules.length === existingRules.length) {
    return false;
  }

  store[guildId] = {
    ...(current ?? {}),
    reactionRoles: updatedRules,
  };
  await writeStore(store);

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
  const store = await readStore();
  const current = store[guildId];
  const existingRules = current?.reactionRoles ?? [];
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

  if (updatedCount === 0) {
    return 0;
  }

  store[guildId] = {
    ...(current ?? {}),
    reactionRoles: updatedRules,
  };
  await writeStore(store);

  return updatedCount;
}
