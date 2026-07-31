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
  new SlashCommandBuilder()
    .setName("getlogchannel")
    .setDescription("Muestra el canal de logs configurado"),
  new SlashCommandBuilder()
    .setName("testmemberlog")
    .setDescription("Envia un mensaje de prueba al canal de logs"),
  new SlashCommandBuilder()
    .setName("setvoicecreator")
    .setDescription("Configura el canal de voz que crea salas temporales")
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de voz disparador")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice),
    ),
  new SlashCommandBuilder()
    .setName("getvoicecreator")
    .setDescription("Muestra el canal disparador de salas temporales"),
  new SlashCommandBuilder()
    .setName("clearvoicecreator")
    .setDescription("Limpia el canal disparador de salas temporales"),
  new SlashCommandBuilder()
    .setName("setreactionrole")
    .setDescription("Asocia reaccion en un mensaje a un rol")
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de texto donde esta el mensaje")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((option) =>
      option
        .setName("mensaje_id")
        .setDescription("ID del mensaje objetivo")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("emoji")
        .setDescription("Emoji unicode o custom (<:name:id>)")
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName("rol")
        .setDescription("Rol a asignar cuando reaccionen")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("removereactionrole")
    .setDescription("Elimina una regla de reaction role")
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de texto donde esta el mensaje")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((option) =>
      option
        .setName("mensaje_id")
        .setDescription("ID del mensaje objetivo")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("emoji")
        .setDescription("Emoji unicode o custom (<:name:id>)")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("listreactionroles")
    .setDescription("Lista reglas configuradas de reaction role"),
  new SlashCommandBuilder()
    .setName("createreactionpanel")
    .setDescription("Crea panel de roles y configura reglas automaticamente")
    .addStringOption((option) =>
      option
        .setName("titulo")
        .setDescription("Titulo del panel")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("emoji_1")
        .setDescription("Emoji para el rol 1")
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("rol_1").setDescription("Rol 1").setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de texto destino (opcional, por defecto actual)")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((option) =>
      option
        .setName("descripcion")
        .setDescription("Texto opcional del panel")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("emoji_2")
        .setDescription("Emoji para el rol 2")
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option.setName("rol_2").setDescription("Rol 2").setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("emoji_3")
        .setDescription("Emoji para el rol 3")
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option.setName("rol_3").setDescription("Rol 3").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("publicarcomunicado")
    .setDescription("Publica un comunicado desde docs/comunicados")
    .addStringOption((option) =>
      option
        .setName("archivo")
        .setDescription(
          "Ruta relativa dentro de docs/comunicados (ej: reclutamiento/raid-off.md)",
        )
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de destino (opcional, por defecto canal actual)")
        .setRequired(false)
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
        "/getlogchannel",
        "/testmemberlog",
        "/setvoicecreator",
        "/getvoicecreator",
        "/clearvoicecreator",
        "/setreactionrole",
        "/removereactionrole",
        "/listreactionroles",
        "/createreactionpanel",
        "/publicarcomunicado",
      ].join("\n"),
    );
  },
};
