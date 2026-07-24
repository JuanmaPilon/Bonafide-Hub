import { Client, Events, GatewayIntentBits } from "discord.js";
import { commandHandlers } from "./commands.js";
import { env } from "./config/env.js";
import {
  getGuildConfig,
  setGuildMemberLogChannelId,
} from "./services/guild-config-store.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

async function sendMemberLog(
  guildId: string,
  fallbackChannelId: string | null,
  message: string,
): Promise<void> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.warn("[discord-bot] Could not fetch guild for member log");
    return;
  }

  const guildConfig = await getGuildConfig(guildId);
  const configuredChannelId = guildConfig.memberLogChannelId;
  const targetChannelId = configuredChannelId ?? fallbackChannelId;

  if (!targetChannelId) {
    console.log(`[discord-bot] ${message}`);
    return;
  }

  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(
      "[discord-bot] Member log channel is not available or not text-based",
    );
    console.log(`[discord-bot] ${message}`);
    return;
  }

  await channel.send(message).catch((error: unknown) => {
    console.error("[discord-bot] Failed to send member log message", error);
  });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] Online as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "setlogchannel") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Server para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel("canal", true);
    await setGuildMemberLogChannelId(interaction.guildId, channel.id);
    await interaction.reply(`Canal de logs configurado en <#${channel.id}>.`);
    return;
  }

  const handler = commandHandlers[interaction.commandName];
  if (!handler) {
    await interaction.reply({
      content: "Comando no soportado.",
      ephemeral: true,
    });
    return;
  }

  await handler(interaction);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const message = `Bienvenido <@${member.id}> al servidor.`;

  await sendMemberLog(member.guild.id, member.guild.systemChannelId, message);
});

client.on(Events.GuildMemberRemove, async (member) => {
  const username = member.user?.tag ?? member.id;
  const message = `${username} salio del servidor.`;

  await sendMemberLog(member.guild.id, member.guild.systemChannelId, message);
});

client.login(env.DISCORD_BOT_TOKEN).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (message.includes("Used disallowed intents")) {
    console.error(
      "[discord-bot] Enable Server Members Intent in Discord Developer Portal > Bot.",
    );
  }

  console.error("[discord-bot] Failed to login", error);
  process.exit(1);
});
