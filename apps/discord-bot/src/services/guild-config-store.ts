import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type GuildConfig = {
  dynamicVoiceCreateChannelId?: string;
  memberLogChannelId?: string;
  temporaryVoiceChannelIds?: string[];
};

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
