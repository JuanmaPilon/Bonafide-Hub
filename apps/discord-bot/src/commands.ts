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
    .setName("memberstats")
    .setDescription("Muestra estadisticas de miembros del servidor")
    .addBooleanOption((option) =>
      option
        .setName("publico")
        .setDescription("Si es true, publica el resultado en el canal")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("rolstats")
    .setDescription("Muestra cantidad de miembros por rol y listado opcional")
    .addRoleOption((option) =>
      option.setName("rol").setDescription("Rol a consultar").setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("listar")
        .setDescription("Si es true, lista miembros del rol")
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("publico")
        .setDescription("Si es true, publica el resultado en el canal")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("listtimers")
    .setDescription("Lista timers pendientes"),
  new SlashCommandBuilder()
    .setName("canceltimer")
    .setDescription("Cancela un timer por ID")
    .addStringOption((option) =>
      option.setName("id").setDescription("ID del timer").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("removetimer")
    .setDescription("Elimina todos tus timers pendientes"),
  new SlashCommandBuilder()
    .setName("settimer")
    .setDescription("Programa un timer que te avisa por DM")
    .addIntegerOption((option) =>
      option
        .setName("segundos")
        .setDescription("Segundos hasta el aviso")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(86_400),
    )
    .addIntegerOption((option) =>
      option
        .setName("minutos")
        .setDescription("Minutos hasta el aviso")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(1_440),
    )
    .addIntegerOption((option) =>
      option
        .setName("horas")
        .setDescription("Horas hasta el aviso")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(24),
    )
    .addBooleanOption((option) =>
      option
        .setName("repetir")
        .setDescription("Si es true, repite el timer automaticamente")
        .setRequired(false),
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
  new SlashCommandBuilder()
    .setName("addlvl")
    .setDescription("Agrega niveles de XP a un usuario")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario objetivo")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("niveles")
        .setDescription("Cantidad de niveles a agregar")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000),
    ),
  new SlashCommandBuilder()
    .setName("removelvl")
    .setDescription("Resta niveles de XP a un usuario")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario objetivo")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("niveles")
        .setDescription("Cantidad de niveles a quitar")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000),
    ),
  new SlashCommandBuilder()
    .setName("setlvl")
    .setDescription("Fija el nivel de XP de un usuario")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario objetivo")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("nivel")
        .setDescription("Nivel a fijar")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(1000),
    ),
  new SlashCommandBuilder()
    .setName("resetlvl")
    .setDescription("Reinicia el XP de un usuario a cero")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario objetivo")
        .setRequired(true),
    ),
].map((command) => command.toJSON());

export const commandHandlers: Record<string, CommandHandler> = {};
