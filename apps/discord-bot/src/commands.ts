import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("saludo")
    .setDescription("Responde con un saludo"),
].map((command) => command.toJSON());
