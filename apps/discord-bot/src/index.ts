import { Client, Events, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] Online as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "saludo") {
    await interaction.reply("Hola");
  }
});

client.login(env.DISCORD_BOT_TOKEN).catch((error: unknown) => {
  console.error("[discord-bot] Failed to login", error);
  process.exit(1);
});
