import {
  AuditLogEvent,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { commandHandlers } from "./commands.js";
import { env } from "./config/env.js";
import {
  addTemporaryVoiceChannelId,
  clearGuildDynamicVoiceCreateChannelId,
  getGuildConfig,
  isTemporaryVoiceChannel,
  removeTemporaryVoiceChannelId,
  setGuildDynamicVoiceCreateChannelId,
  setGuildMemberLogChannelId,
} from "./services/guild-config-store.js";
import {
  getCommunicationContent,
  listCommunicationFiles,
  splitForDiscord,
} from "./services/communications-store.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
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

async function sendChunksToTextChannel(
  channel: { send: (content: string) => Promise<unknown>; id: string },
  chunks: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const chunk of chunks) {
    try {
      await channel.send(chunk);
    } catch (error: unknown) {
      const maybeDiscordError = error as {
        code?: number;
        status?: number;
        message?: string;
      };

      if (
        maybeDiscordError.status === 403 ||
        maybeDiscordError.code === 50013 ||
        maybeDiscordError.code === 50001
      ) {
        return {
          ok: false,
          reason:
            "El bot no tiene permisos para publicar en ese canal (View Channel / Send Messages).",
        };
      }

      return {
        ok: false,
        reason: `Error al publicar en canal ${channel.id}: ${maybeDiscordError.message ?? "desconocido"}`,
      };
    }
  }

  return { ok: true };
}

type MemberLeaveDetails = {
  kind: "leave" | "kick" | "ban";
  moderatorId?: string;
  reason?: string;
};

function formatLeaveMessage(
  username: string,
  memberId: string,
  details: MemberLeaveDetails,
): string {
  if (details.kind === "leave") {
    return `${username} se retiro del servidor.`;
  }

  const actionText = details.kind === "kick" ? "expulsado" : "baneado";
  const moderatorText = details.moderatorId
    ? `<@${details.moderatorId}>`
    : "desconocido";
  const reasonText = details.reason?.trim() || "sin razon informada";

  return `<@${memberId}> (${username}) fue ${actionText} por ${moderatorText}. Razon: ${reasonText}.`;
}

async function resolveMemberLeaveDetails(
  member: unknown,
): Promise<MemberLeaveDetails> {
  const typedMember = member as {
    id: string;
    guild: {
      fetchAuditLogs: (options: unknown) => Promise<{
        entries: {
          find: (
            predicate: (entry: {
              target?: { id?: string } | null;
              createdTimestamp: number;
              executor?: { id: string } | null;
              reason?: string | null;
            }) => boolean,
          ) =>
            | {
                executor?: { id: string } | null;
                reason?: string | null;
              }
            | undefined;
        };
      }>;
    };
  };

  const now = Date.now();
  const maxAgeMs = 15_000;

  const findRelevantEntry = (entries: {
    find: (
      predicate: (entry: {
        target?: { id?: string } | null;
        createdTimestamp: number;
      }) => boolean,
    ) =>
      | { executor?: { id: string } | null; reason?: string | null }
      | undefined;
  }) =>
    entries.find((entry) => {
      const targetId = entry.target?.id;
      if (targetId !== typedMember.id) {
        return false;
      }

      return Math.abs(now - entry.createdTimestamp) <= maxAgeMs;
    });

  const [kickLogs, banLogs] = await Promise.all([
    typedMember.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 })
      .catch(() => null),
    typedMember.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 })
      .catch(() => null),
  ]);

  const kickEntry = kickLogs ? findRelevantEntry(kickLogs.entries) : undefined;
  if (kickEntry) {
    return {
      kind: "kick",
      moderatorId: kickEntry.executor?.id,
      reason: kickEntry.reason ?? undefined,
    };
  }

  const banEntry = banLogs ? findRelevantEntry(banLogs.entries) : undefined;
  if (banEntry) {
    return {
      kind: "ban",
      moderatorId: banEntry.executor?.id,
      reason: banEntry.reason ?? undefined,
    };
  }

  return { kind: "leave" };
}

function buildTemporaryVoiceChannelName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "Sala temporal";
  }

  return `${trimmed.slice(0, 70)} room`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasDeleteMethod(
  value: unknown,
): value is { delete: (reason?: string) => Promise<unknown> } {
  return isObjectRecord(value) && typeof value.delete === "function";
}

function isVoiceBasedChannelLike(
  value: unknown,
): value is { isVoiceBased: () => boolean; members: { size: number } } {
  return (
    isObjectRecord(value) &&
    typeof value.isVoiceBased === "function" &&
    isObjectRecord(value.members) &&
    typeof value.members.size === "number"
  );
}

async function createDynamicVoiceChannelForMember(newState: {
  guild: {
    id: string;
    channels: {
      create: (options: {
        name: string;
        type: ChannelType.GuildVoice;
        parent?: string | null;
        reason: string;
      }) => Promise<{ id: string }>;
      fetch: (channelId: string) => Promise<unknown>;
    };
  };
  channelId: string | null;
  channel: { parentId?: string | null; isVoiceBased: () => boolean } | null;
  member?: { displayName: string; id: string } | null;
  setChannel: (channelId: string) => Promise<unknown>;
}): Promise<void> {
  if (!newState.channelId || !newState.member) {
    return;
  }

  const guildConfig = await getGuildConfig(newState.guild.id);
  const creatorChannelId = guildConfig.dynamicVoiceCreateChannelId;
  if (!creatorChannelId || newState.channelId !== creatorChannelId) {
    return;
  }

  const creatorChannel = newState.channel;
  if (!creatorChannel || !creatorChannel.isVoiceBased()) {
    return;
  }

  const createdChannel = await newState.guild.channels.create({
    name: buildTemporaryVoiceChannelName(newState.member.displayName),
    type: ChannelType.GuildVoice,
    parent: creatorChannel.parentId ?? null,
    reason: `Dynamic voice room for ${newState.member.id}`,
  });

  await addTemporaryVoiceChannelId(newState.guild.id, createdChannel.id);

  const moved = await newState
    .setChannel(createdChannel.id)
    .then(() => true)
    .catch(() => false);

  if (moved) {
    return;
  }

  const channelToDelete = await newState.guild.channels
    .fetch(createdChannel.id)
    .catch(() => null);

  if (hasDeleteMethod(channelToDelete)) {
    await channelToDelete.delete();
  }

  await removeTemporaryVoiceChannelId(newState.guild.id, createdChannel.id);
}

async function maybeDeleteTemporaryVoiceChannel(channelState: {
  guild: {
    id: string;
    channels: { fetch: (channelId: string) => Promise<unknown> };
  };
  channelId: string | null;
}): Promise<void> {
  const channelId = channelState.channelId;
  if (!channelId) {
    return;
  }

  const isTemporary = await isTemporaryVoiceChannel(
    channelState.guild.id,
    channelId,
  );
  if (!isTemporary) {
    return;
  }

  const channel = await channelState.guild.channels
    .fetch(channelId)
    .catch(() => null);
  if (!channel) {
    await removeTemporaryVoiceChannelId(channelState.guild.id, channelId);
    return;
  }

  if (!isVoiceBasedChannelLike(channel) || !channel.isVoiceBased()) {
    await removeTemporaryVoiceChannelId(channelState.guild.id, channelId);
    return;
  }

  const members = channel.members;
  if (members.size > 0) {
    return;
  }

  if (hasDeleteMethod(channel)) {
    await channel.delete("Dynamic voice channel empty");
  }

  await removeTemporaryVoiceChannelId(channelState.guild.id, channelId);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] Online as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== "publicarcomunicado") {
      return;
    }

    const focusedValue = interaction.options.getFocused(true);
    if (focusedValue.name !== "archivo") {
      await interaction.respond([]);
      return;
    }

    const files = await listCommunicationFiles(
      String(focusedValue.value),
    ).catch(() => []);

    await interaction.respond(
      files.map((file) => ({
        name: file.length > 100 ? `${file.slice(0, 97)}...` : file,
        value: file,
      })),
    );
    return;
  }

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

  if (interaction.commandName === "setvoicecreator") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageChannels")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Channels para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel("canal", true);

    await setGuildDynamicVoiceCreateChannelId(interaction.guildId, channel.id);
    await interaction.reply(
      `Canal creador de voz configurado en <#${channel.id}>.`,
    );
    return;
  }

  if (interaction.commandName === "getvoicecreator") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    const guildConfig = await getGuildConfig(interaction.guildId);
    if (!guildConfig.dynamicVoiceCreateChannelId) {
      await interaction.reply(
        "No hay canal creador configurado. Usa /setvoicecreator.",
      );
      return;
    }

    await interaction.reply(
      `Canal creador actual: <#${guildConfig.dynamicVoiceCreateChannelId}>.`,
    );
    return;
  }

  if (interaction.commandName === "clearvoicecreator") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageChannels")) {
      await interaction.reply({
        content: "Necesitas el permiso Manage Channels para usar este comando.",
        ephemeral: true,
      });
      return;
    }

    await clearGuildDynamicVoiceCreateChannelId(interaction.guildId);
    await interaction.reply("Canal creador de voz limpiado.");
    return;
  }

  if (interaction.commandName === "publicarcomunicado") {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo se puede usar dentro de un servidor.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({
        content:
          "Necesitas el permiso Manage Server para publicar comunicados.",
        ephemeral: true,
      });
      return;
    }

    const relativePath = interaction.options.getString("archivo", true);
    const selectedChannel = interaction.options.getChannel("canal");
    const targetChannelId = selectedChannel?.id ?? interaction.channelId;
    const targetChannel = await interaction.guild.channels
      .fetch(targetChannelId)
      .catch(() => null);

    if (!targetChannel || !targetChannel.isTextBased()) {
      await interaction.reply({
        content: "No se pudo resolver un canal de texto valido para publicar.",
        ephemeral: true,
      });
      return;
    }

    const content = await getCommunicationContent(relativePath).catch(
      (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Error desconocido";
        return `__ERROR__${message}`;
      },
    );

    if (content.startsWith("__ERROR__")) {
      await interaction.reply({
        content: `No se pudo leer el comunicado: ${content.replace("__ERROR__", "")}`,
        ephemeral: true,
      });
      return;
    }

    const chunks = splitForDiscord(content);

    const publishResult = await sendChunksToTextChannel(targetChannel, chunks);
    if (!publishResult.ok) {
      await interaction.reply({
        content: `No se pudo publicar el comunicado: ${publishResult.reason}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Comunicado publicado en <#${targetChannel.id}> (${chunks.length} mensaje/s).`,
      ephemeral: true,
    });
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
  const leaveDetails = await resolveMemberLeaveDetails(member).catch(
    () => ({ kind: "leave" }) as MemberLeaveDetails,
  );
  const message = formatLeaveMessage(username, member.id, leaveDetails);

  await sendMemberLog(member.guild.id, member.guild.systemChannelId, message);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.channelId && newState.channelId !== oldState.channelId) {
    await createDynamicVoiceChannelForMember(newState).catch(
      (error: unknown) => {
        console.error("[discord-bot] Failed to create dynamic voice channel", {
          guildId: newState.guild.id,
          memberId: newState.member?.id,
          error,
        });
      },
    );
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await maybeDeleteTemporaryVoiceChannel(oldState).catch((error: unknown) => {
      console.error("[discord-bot] Failed to delete dynamic voice channel", {
        guildId: oldState.guild.id,
        channelId: oldState.channelId,
        error,
      });
    });
  }
});

client.login(env.DISCORD_BOT_TOKEN).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (message.includes("Used disallowed intents")) {
    console.error(
      "[discord-bot] Enable required intents. For member logs, enable Server Members Intent in Discord Developer Portal > Bot.",
    );
  }

  console.error("[discord-bot] Failed to login", error);
  process.exit(1);
});
