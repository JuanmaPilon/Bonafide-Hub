import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  VoiceBasedChannel,
} from "discord.js";
import * as play from "play-dl";
import { env } from "../config/env.js";

const youtubeCookie = env.YOUTUBE_COOKIE?.trim();
if (youtubeCookie) {
  try {
    play.setToken({ youtube: { cookie: youtubeCookie } });
    console.log("[music] YouTube cookies configuradas");
  } catch (error) {
    console.error("[music] Error al configurar cookies de YouTube", { error });
  }
}

export type Track = {
  duration?: string;
  requestedBy: string;
  title: string;
  url: string;
};

type GuildMusicState = {
  connection: VoiceConnection | null;
  current: Track | null;
  player: ReturnType<typeof createAudioPlayer>;
  queue: Track[];
  volume: number;
  guild: Guild | null;
  idleTimer: NodeJS.Timeout | null;
  emptyTimer: NodeJS.Timeout | null;
};

const musicStates = new Map<string, GuildMusicState>();
const AUTO_LEAVE_MS = 60_000;
const EMPTY_GRACE_MS = 15_000;
const SWEEP_INTERVAL_MS = 30_000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getState(guildId: string): GuildMusicState {
  let state = musicStates.get(guildId);
  if (!state) {
    const player = createAudioPlayer();
    state = {
      connection: null,
      current: null,
      player,
      queue: [],
      volume: 0.5,
      guild: null,
      idleTimer: null,
      emptyTimer: null,
    };
    musicStates.set(guildId, state);

    player.on(AudioPlayerStatus.Idle, () => {
      void playNext(guildId);
    });
    player.on("error", (error) => {
      console.error("[music] player error", { guildId, error });
      void playNext(guildId);
    });
  }

  return state;
}

function destroyState(guildId: string): void {
  const state = musicStates.get(guildId);
  if (!state) {
    return;
  }

  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.emptyTimer) {
    clearTimeout(state.emptyTimer);
    state.emptyTimer = null;
  }

  state.queue = [];
  state.current = null;
  state.connection?.destroy();
  state.connection = null;
  musicStates.delete(guildId);
}

function cancelIdleLeave(guildId: string): void {
  const state = musicStates.get(guildId);
  if (state?.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function scheduleIdleLeave(guildId: string): void {
  const state = musicStates.get(guildId);
  if (!state) {
    return;
  }

  cancelIdleLeave(guildId);
  state.idleTimer = setTimeout(() => {
    const current = musicStates.get(guildId);
    if (current && current.queue.length === 0 && !current.current) {
      console.log("[music] sin actividad, desconectando", { guildId });
      destroyState(guildId);
    }
  }, AUTO_LEAVE_MS);
}

function scheduleEmptyLeave(guildId: string): void {
  const state = musicStates.get(guildId);
  if (!state || state.emptyTimer) {
    return;
  }

  state.emptyTimer = setTimeout(() => {
    const current = musicStates.get(guildId);
    if (current) {
      console.log("[music] canal sin oyentes, desconectando", { guildId });
      destroyState(guildId);
    }
  }, EMPTY_GRACE_MS);
}

function cancelEmptyLeave(guildId: string): void {
  const state = musicStates.get(guildId);
  if (state?.emptyTimer) {
    clearTimeout(state.emptyTimer);
    state.emptyTimer = null;
  }
}

export function checkMusicChannelEmpty(channel: VoiceBasedChannel): void {
  const state = musicStates.get(channel.guild.id);
  if (!state?.connection) {
    return;
  }
  if (state.connection.joinConfig.channelId !== channel.id) {
    return;
  }

  const humans = channel.members.filter((member) => !member.user.bot).size;
  if (humans === 0) {
    scheduleEmptyLeave(channel.guild.id);
  } else {
    cancelEmptyLeave(channel.guild.id);
  }
}

function sweepMusicStates(): void {
  for (const [guildId, state] of musicStates) {
    if (!state.connection || !state.guild) {
      continue;
    }

    const channelId = state.connection.joinConfig.channelId;
    if (!channelId) {
      destroyState(guildId);
      continue;
    }
    const channel = state.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) {
      console.log("[music] canal de voz ya no existe, desconectando", {
        guildId,
      });
      destroyState(guildId);
      continue;
    }

    checkMusicChannelEmpty(channel);
  }
}

setInterval(sweepMusicStates, SWEEP_INTERVAL_MS);

async function playNext(guildId: string): Promise<void> {
  const state = musicStates.get(guildId);
  if (!state) {
    return;
  }

  if (state.player.state.status !== AudioPlayerStatus.Idle) {
    return;
  }

  const next = state.queue.shift();
  if (!next) {
    state.current = null;

    // Si nadie más encoló, nos desconectamos solo al rato.
    if (state.connection) {
      scheduleIdleLeave(guildId);
    }
    return;
  }

  cancelIdleLeave(guildId);

  try {
    const streamInfo = await play.stream(next.url, {
      discordPlayerCompatibility: true,
    });
    streamInfo.stream.on("error", (error) => {
      console.error("[music] stream error", {
        error,
        guildId,
        title: next.title,
      });
    });
    const resource = createAudioResource(streamInfo.stream, {
      inputType: streamInfo.type as unknown as StreamType,
    });
    resource.volume?.setVolume(state.volume);
    state.current = next;
    console.log("[music] playing", {
      guildId,
      title: next.title,
      streamType: streamInfo.type,
      connectionStatus: state.connection?.state.status ?? "none",
    });
    state.player.play(resource);
  } catch (error) {
    console.error("[music] failed to stream", {
      error,
      guildId,
      url: next.url,
    });
    void playNext(guildId);
  }
}

async function joinChannel(
  guildId: string,
  channelId: string,
  adapterCreator: Parameters<typeof joinVoiceChannel>[0]["adapterCreator"],
  guild: Guild,
): Promise<VoiceConnection> {
  const state = getState(guildId);
  state.guild = guild;
  if (
    state.connection &&
    state.connection.state.status !== VoiceConnectionStatus.Disconnected
  ) {
    return state.connection;
  }

  const connection = joinVoiceChannel({
    adapterCreator,
    channelId,
    guildId,
    selfDeaf: true,
  });
  state.connection = connection;

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      destroyState(guildId);
    }
  });

  connection.subscribe(state.player);
  return connection;
}

const RETRY_DELAY_MS = 2_000;

function isRateLimited(error: unknown): boolean {
  return error instanceof Error && error.message.includes("429");
}

async function resolveTrack(query: string): Promise<Track | null> {
  const trimmed = query.trim();
  const isUrl = /^https?:\/\//.test(trimmed);
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (isUrl) {
        const info = await play.video_info(trimmed);
        const details = info.video_details;
        return {
          duration: details.durationRaw,
          requestedBy: "",
          title: details.title ?? trimmed,
          url: details.url ?? trimmed,
        };
      }

      const results = await play.search(trimmed, { limit: 1 });
      const video = results[0];
      if (!video) {
        return null;
      }

      return {
        duration: video.durationRaw,
        requestedBy: "",
        title: video.title ?? trimmed,
        url: video.url,
      };
    } catch (error) {
      const lastAttempt = attempt === maxAttempts;
      if (isRateLimited(error) && !lastAttempt) {
        console.warn("[music] YouTube rate limited, reintentando", {
          query: trimmed,
          attempt,
        });
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      throw error;
    }
  }

  return null;
}

function replyError(interaction: ChatInputCommandInteraction, message: string) {
  return interaction.reply({ content: message, ephemeral: true });
}

export async function handleMusicCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await replyError(
      interaction,
      "Este comando solo se puede usar dentro de un servidor.",
    );
    return;
  }

  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;

  try {
    switch (interaction.commandName) {
      case "play": {
        const query = interaction.options.getString("cancion", true);
        const voiceChannel = member?.voice.channel;
        console.log("[music] play requested", {
          guildId,
          query,
          voiceChannel: voiceChannel?.id ?? null,
        });
        if (!voiceChannel?.id) {
          await replyError(
            interaction,
            "Primero entrá a un canal de voz para reproducir música.",
          );
          return;
        }

        await interaction.deferReply();

        let track: Track | null;
        try {
          track = await resolveTrack(query);
        } catch (error) {
          console.error("[music] resolveTrack failed", {
            error,
            guildId,
            query,
          });
          await interaction.editReply(
            "No pude conectarme con YouTube para buscar el tema (429: YouTube está limitando la IP del servidor). " +
              "Si YOUTUBE_COOKIE no está configurada, agregala en Railway. También podés probar de nuevo en unos minutos.",
          );
          return;
        }

        if (!track) {
          await interaction.editReply(`No encontré nada para "${query}".`);
          return;
        }

        await joinChannel(
          guildId,
          voiceChannel.id,
          interaction.guild.voiceAdapterCreator,
          interaction.guild,
        );

        const state = getState(guildId);
        track.requestedBy = interaction.user.tag;
        cancelIdleLeave(guildId);
        state.queue.push(track);

        const duration = track.duration ? ` (${track.duration})` : "";
        if (state.player.state.status !== AudioPlayerStatus.Idle) {
          await interaction.editReply(
            `🎵 Agregado a la cola: **${track.title}**${duration}`,
          );
        } else {
          await interaction.editReply(
            `🎵 Reproduciendo: **${track.title}**${duration}`,
          );
          void playNext(guildId);
        }
        return;
      }

      case "pause": {
        const state = getState(guildId);
        if (state.player.state.status !== AudioPlayerStatus.Playing) {
          await replyError(interaction, "No hay nada reproduciéndose.");
          return;
        }
        state.player.pause();
        await interaction.reply("⏸️ Reproducción pausada.");
        return;
      }

      case "resume": {
        const state = getState(guildId);
        if (state.player.state.status !== AudioPlayerStatus.Paused) {
          await replyError(interaction, "No hay nada pausado.");
          return;
        }
        state.player.unpause();
        await interaction.reply("▶️ Reproducción reanudada.");
        return;
      }

      case "skip": {
        const state = getState(guildId);
        if (!state.current) {
          await replyError(interaction, "No hay canción reproduciéndose.");
          return;
        }
        const title = state.current.title;
        state.player.stop();
        await interaction.reply(`⏭️ Saltando: **${title}**`);
        return;
      }

      case "queue": {
        const state = getState(guildId);
        if (!state.current && state.queue.length === 0) {
          await replyError(interaction, "La cola está vacía.");
          return;
        }

        const lines: string[] = [];
        if (state.current) {
          lines.push(`▶️ **Sonando:** ${state.current.title}`);
        }
        const pending = state.queue.slice(0, 10);
        pending.forEach((track, index) => {
          lines.push(
            `${index + 1}. ${track.title}${track.duration ? ` (${track.duration})` : ""}`,
          );
        });
        if (state.queue.length > pending.length) {
          lines.push(`...y ${state.queue.length - pending.length} más.`);
        }
        await interaction.reply(lines.join("\n"));
        return;
      }

      case "nowplaying": {
        const state = getState(guildId);
        if (!state.current) {
          await replyError(interaction, "No hay canción reproduciéndose.");
          return;
        }
        await interaction.reply(
          `🎶 **Sonando:** ${state.current.title} — pedida por ${state.current.requestedBy}`,
        );
        return;
      }

      case "volume": {
        const state = getState(guildId);
        const level = interaction.options.getInteger("nivel", true);
        const normalized = Math.max(0, Math.min(200, level)) / 100;
        state.volume = normalized;
        const playerState = state.player.state as {
          resource?: { volume?: { setVolume(volume: number): void } };
        };
        playerState.resource?.volume?.setVolume(normalized);
        await interaction.reply(`🔊 Volumen: **${level}%**`);
        return;
      }

      case "stop": {
        destroyState(guildId);
        await interaction.reply("⏹️ Música detenida y cola limpiada.");
        return;
      }

      case "leave": {
        destroyState(guildId);
        await interaction.reply("👋 Me fui del canal de voz.");
        return;
      }

      default:
        await replyError(interaction, "Comando de música no soportado.");
    }
  } catch (error) {
    console.error("[music] command error", { error, guildId });
    if (interaction.deferred) {
      await interaction.editReply(`Error de música: ${getErrorMessage(error)}`);
    } else {
      await replyError(
        interaction,
        `Error de música: ${getErrorMessage(error)}`,
      );
    }
  }
}
