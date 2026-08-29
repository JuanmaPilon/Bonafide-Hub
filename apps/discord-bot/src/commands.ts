import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

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
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Muestra el perfil de un miembro en este canal")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario a consultar (por defecto: vos)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Reproduce una canción o URL (YouTube / SoundCloud)")
    .addStringOption((option) =>
      option
        .setName("cancion")
        .setDescription("Búsqueda o URL de YouTube/SoundCloud")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("fuente")
        .setDescription("Dónde buscar (YouTube por defecto)")
        .addChoices(
          { name: "YouTube", value: "youtube" },
          { name: "SoundCloud", value: "soundcloud" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pausa la reproducción"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Reanuda la reproducción"),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Salta a la siguiente canción"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Muestra la cola de reproducción"),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Muestra la canción que está sonando"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ajusta el volumen (0-200)")
    .addIntegerOption((option) =>
      option
        .setName("nivel")
        .setDescription("Volumen 0-200")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200),
    ),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Detiene la música y limpia la cola"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Saca al bot del canal de voz"),
  new SlashCommandBuilder()
    .setName("desperuanizar")
    .setDescription(
      "Oculta tu sala de voz dinámica a los roles vetados (solo salas de Karpindomo)",
    ),
  new SlashCommandBuilder()
    .setName("reperuanizar")
    .setDescription(
      "Vuelve a hacer visible tu sala de voz dinámica a los roles vetados",
    ),
  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription(
      "Muestra el top 10 del ranking de XP del servidor",
    ),
].map((command) => command.toJSON());

export const commandHandlers: Record<string, CommandHandler> = {};
