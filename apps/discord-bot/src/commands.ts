import {
  ChannelType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

type CommandHandler = (
  interaction: ChatInputCommandInteraction,
) => Promise<void>;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("saludo")
    .setDescription("Responde con un saludo"),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Chequea si el bot esta online"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Muestra comandos disponibles"),
  new SlashCommandBuilder()
    .setName("setlogchannel")
    .setDescription("Configura el canal de logs de entradas y salidas")
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de texto para logs")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
].map((command) => command.toJSON());

export const commandHandlers: Record<string, CommandHandler> = {
  saludo: async (interaction) => {
    await interaction.reply("Hola");
  },
  ping: async (interaction) => {
    await interaction.reply("Pong");
  },
  help: async (interaction) => {
    await interaction.reply(
      [
        "Comandos disponibles:",
        "/saludo",
        "/ping",
        "/help",
        "/setlogchannel",
      ].join("\n"),
    );
  },
};
