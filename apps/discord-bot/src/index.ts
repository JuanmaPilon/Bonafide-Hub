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
  const candidateChannelIds = [configuredChannelId, fallbackChannelId].filter(
    (channelId): channelId is string => Boolean(channelId),
  );

  if (candidateChannelIds.length === 0) {
    console.log(`[discord-bot] ${message}`);
    return;
  }

  for (const channelId of candidateChannelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      continue;
    }

    const sent = await channel
      .send(message)
      .then(() => true)
      .catch((error: unknown) => {
        console.error("[discord-bot] Failed to send member log message", {
          guildId,
          channelId,
          error,
        });
        return false;
      });

    if (sent) {
      return;
    }
  }

  console.warn(
    "[discord-bot] No available channel to send member log. Falling back to console.",
  );
  console.log(`[discord-bot] ${message}`);
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
    await interaction.reply(
      `Canal de logs configurado en <#${channel.id}>. Puedes probar con /testmemberlog.`,
    );
    return;
  }

  if (interaction.commandName === "getlogchannel") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const guildConfig = await getGuildConfig(interaction.guildId);
    const configuredChannelId = guildConfig.memberLogChannelId;
    if (!configuredChannelId) {
      await interaction.reply(
        "No hay canal de logs configurado. Usa /setlogchannel.",
      );
      return;
    }

    await interaction.reply(`Canal de logs actual: <#${configuredChannelId}>.`);
    return;
  }

  if (interaction.commandName === "testmemberlog") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    await sendMemberLog(
      interaction.guildId,
      interaction.guild.systemChannelId,
      `Prueba de log ejecutada por <@${interaction.user.id}>.`,
    );
    await interaction.reply("Mensaje de prueba enviado al canal de logs.");
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
