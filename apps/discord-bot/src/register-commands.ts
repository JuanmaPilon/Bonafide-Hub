import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands.js";
import { env } from "./config/env.js";

if (!env.DISCORD_APPLICATION_ID) {
  throw new Error("DISCORD_APPLICATION_ID is required to register commands");
}

if (!env.DISCORD_GUILD_ID) {
  throw new Error("DISCORD_GUILD_ID is required to register commands");
}

const applicationId = env.DISCORD_APPLICATION_ID;
const guildId = env.DISCORD_GUILD_ID;

const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

async function registerGuildCommands(): Promise<void> {
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
    body: commandDefinitions,
  });

  console.log("[discord-bot] Guild commands registered");
}

registerGuildCommands().catch((error: unknown) => {
  const maybeDiscordError = error as {
    code?: number;
    status?: number;
    message?: string;
  };

  if (maybeDiscordError.code === 50001 || maybeDiscordError.status === 403) {
    console.error("[discord-bot] Missing Access while registering commands.");
    console.error(
      "[discord-bot] Checklist: verify DISCORD_GUILD_ID is your SERVER ID (not Application ID), install the app in that server, and keep bot + applications.commands scopes.",
    );
  }

  console.error("[discord-bot] Failed to register commands", error);
  process.exit(1);
});
