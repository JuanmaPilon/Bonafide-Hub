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
    .setName("setroomchannel")
    .setDescription("Configura canal de logs o canal creador de rooms")
    .addStringOption((option) =>
      option
        .setName("tipo")
        .setDescription("Que tipo de canal quieres configurar")
        .setRequired(true)
        .addChoices(
          { name: "Logs", value: "logs" },
          { name: "Rooms", value: "rooms" },
        ),
    )
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal a configurar segun el tipo")
        .setRequired(true)
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
        ),
    ),
  new SlashCommandBuilder()
    .setName("getlogchannel")
    .setDescription("Muestra el canal de logs configurado"),
  new SlashCommandBuilder()
    .setName("getroomchannel")
    .setDescription("Muestra el canal disparador de salas temporales"),
  new SlashCommandBuilder()
    .setName("clearchannel")
    .setDescription("Limpia un canal configurado por tipo")
    .addStringOption((option) =>
      option
        .setName("tipo")
        .setDescription("Que tipo de canal quieres limpiar")
        .setRequired(true)
        .addChoices(
          { name: "Logs", value: "logs" },
          { name: "Rooms", value: "rooms" },
          { name: "Todos", value: "all" },
        ),
    ),
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
    )
    .addStringOption((option) =>
      option
        .setName("modo")
        .setDescription("Comportamiento: multiple, unique o additive")
        .setRequired(false)
        .addChoices(
          { name: "Multiple", value: "multiple" },
          { name: "Unique", value: "unique" },
          { name: "Additive", value: "additive" },
        ),
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
    .setName("setreactionpanelmode")
    .setDescription("Cambia el modo de todas las reglas de un panel")
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de texto donde esta el panel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((option) =>
      option
        .setName("mensaje_id")
        .setDescription("ID del mensaje del panel")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("modo")
        .setDescription("Nuevo modo: multiple, unique o additive")
        .setRequired(true)
        .addChoices(
          { name: "Multiple", value: "multiple" },
          { name: "Unique", value: "unique" },
          { name: "Additive", value: "additive" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("listreminders")
    .setDescription("Lista recordatorios de este servidor"),
  new SlashCommandBuilder()
    .setName("listreminder")
    .setDescription("Lista recordatorios activos"),
  new SlashCommandBuilder()
    .setName("cancelreminder")
    .setDescription("Cancela un recordatorio por ID")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("ID del recordatorio")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("removereminder")
    .setDescription("Elimina tus recordatorios (todos o por tipo)")
    .addStringOption((option) =>
      option
        .setName("tipo")
        .setDescription("Filtra por tipo (opcional)")
        .setRequired(false)
        .addChoices(
          { name: "KD", value: "kd" },
          { name: "KDaily", value: "kdaily" },
          { name: "Custom", value: "custom" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("setreminder")
    .setDescription("Programa un recordatorio privado de Karpindomo")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("kd")
        .setDescription("Recordatorio KD con tiempo fijo (30 min)")
        .addBooleanOption((option) =>
          option
            .setName("repetir")
            .setDescription(
              "Si es true, repite el recordatorio automaticamente",
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("kdaily")
        .setDescription("Recordatorio KDaily con tiempo fijo (12 horas)")
        .addBooleanOption((option) =>
          option
            .setName("repetir")
            .setDescription(
              "Si es true, repite el recordatorio automaticamente",
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("custom")
        .setDescription("Recordatorio personalizado en minutos u horas")
        .addIntegerOption((option) =>
          option
            .setName("minutos")
            .setDescription("Minutos hasta el aviso")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(43_200),
        )
        .addIntegerOption((option) =>
          option
            .setName("horas")
            .setDescription("Horas hasta el aviso")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(720),
        )
        .addBooleanOption((option) =>
          option
            .setName("repetir")
            .setDescription(
              "Si es true, repite el recordatorio automaticamente",
            )
            .setRequired(false),
        ),
    ),
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
    .addStringOption((option) =>
      option
        .setName("modo")
        .setDescription("Comportamiento del panel: multiple, unique o additive")
        .setRequired(false)
        .addChoices(
          { name: "Multiple", value: "multiple" },
          { name: "Unique", value: "unique" },
          { name: "Additive", value: "additive" },
        ),
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

export const commandHandlers: Record<string, CommandHandler> = {};
