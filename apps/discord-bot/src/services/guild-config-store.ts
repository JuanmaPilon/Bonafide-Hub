import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type GuildConfig = {
  memberLogChannelId?: string;
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
