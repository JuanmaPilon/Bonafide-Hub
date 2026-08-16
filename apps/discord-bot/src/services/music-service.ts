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
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  VoiceBasedChannel,
} from "discord.js";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { writeFileSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import { create as createYoutubeDl } from "youtube-dl-exec";
import { env } from "../config/env.js";
import { getGuildConfig } from "./guild-config-store.js";

const youtubeCookie = env.YOUTUBE_COOKIE?.trim();

// yt-dlp NO acepta cookies por header (--add-header es deprecado y YouTube
// lo ignora). Hay que pasarle un ARCHIVO de cookies en formato Netscape
// mediante --cookies. Convertimos la cadena "a=b; c=d" a ese formato.
function writeYoutubeCookiesFile(cookieString: string): string {
  const dir = path.join(process.cwd(), ".cache");
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "youtube-cookies.txt");

  const lines: string[] = [
    "# Netscape HTTP Cookie File",
    "# Generado por Bonafide",
  ];
  for (const part of cookieString.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) {
      continue;
    }
    const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
    // Expiración lejana (2100-01-01).
    const expires = 4102444800;
    lines.push(
      `.youtube.com\tTRUE\t/\t${secure ? "TRUE" : "FALSE"}\t${expires}\t${name}\t${value}`,
    );
  }

  writeFileSync(target, lines.join("\n"), "utf8");
  return target;
}

const YOUTUBE_COOKIES_FILE = youtubeCookie
  ? writeYoutubeCookiesFile(youtubeCookie)
  : null;
if (youtubeCookie) {
  console.log("[music] YouTube cookies configuradas (archivo Netscape)");
}

// ── Streaming con yt-dlp ────────────────────────────────────────────
const YTDL_BIN_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const YTDL_BUNDLED_BIN = path.join(
  process.cwd(),
  "node_modules",
  "youtube-dl-exec",
  "bin",
  YTDL_BIN_NAME,
);
const YTDL_CACHE_BIN = path.join(
  process.cwd(),
  ".cache",
  "yt-dlp",
  YTDL_BIN_NAME,
);

let ytdlInstance: ReturnType<typeof createYoutubeDl> | null = null;

function ytdlWorks(binary: string): boolean {
  try {
    const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

async function downloadBinary(
  label: string,
  url: string,
  targetPath: string,
): Promise<string> {
  console.log(`[music] Descargando ${label}...`, { url });
  mkdirSync(path.dirname(targetPath), { recursive: true });

  // fetch sigue las redirecciones de GitHub (los /releases/latest
  // devuelven un 302 al archivo real; https.get no las seguía).
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Bonafide-Bot" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar ${label} (HTTP ${response.status})`);
  }

  const file = createWriteStream(targetPath);
  await pipeline(
    Readable.fromWeb(
      response.body as unknown as import("node:stream/web").ReadableStream,
    ),
    file,
  );
  await chmod(targetPath, 0o755).catch(() => undefined);
  return targetPath;
}

function downloadYtDlp(targetPath: string): Promise<string> {
  return downloadBinary(
    "yt-dlp",
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDL_BIN_NAME}`,
    targetPath,
  );
}

async function resolveYtDlpBinary(): Promise<string> {
  const explicit = process.env.YOUTUBE_DL_BIN?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  // 1. Binario empaquetado por youtube-dl-exec, SOLO si es un binario
  //    real (no el shim de Python que deja si el postinstall no corrió).
  if (existsSync(YTDL_BUNDLED_BIN) && ytdlWorks(YTDL_BUNDLED_BIN)) {
    return YTDL_BUNDLED_BIN;
  }

  // 2. Descarga previa cacheada (última versión).
  if (existsSync(YTDL_CACHE_BIN) && ytdlWorks(YTDL_CACHE_BIN)) {
    return YTDL_CACHE_BIN;
  }

  // 3. Descargamos la última versión a un cache local. La preferimos a
  //    la de apt porque es más nueva y soporta --js-runtimes.
  try {
    return await downloadYtDlp(YTDL_CACHE_BIN);
  } catch (error) {
    console.warn("[music] No se pudo descargar yt-dlp, usando el del sistema", {
      error,
    });
  }

  // 4. Último recurso: binario del sistema.
  if (process.platform !== "win32" && ytdlWorks("/usr/bin/yt-dlp")) {
    return "/usr/bin/yt-dlp";
  }

  throw new Error("No hay binario de yt-dlp disponible.");
}

async function getYoutubeDl(): Promise<ReturnType<typeof createYoutubeDl>> {
  if (!ytdlInstance) {
    await ensurePython();
    const binaryPath = await resolveYtDlpBinary();
    console.log("[music] Usando yt-dlp desde:", binaryPath);
    ytdlInstance = createYoutubeDl(binaryPath);
  }
  return ytdlInstance;
}

// ── ffmpeg ──────────────────────────────────────────────────────────
// @discordjs/voice (vía prism-media) convierte el stream a opus con
// ffmpeg, buscándolo en este orden: ffmpeg-static, ffmpeg, avconv,
// ./ffmpeg. Acá aseguramos que exista un binario operativo (con
// descarga de respaldo) para que el audio siempre se pueda convertir.
let ffmpegPromise: Promise<boolean> | null = null;

function ffmpegWorks(binary: string): boolean {
  try {
    const result = spawnSync(binary, ["-h"], { stdio: "ignore" });
    return !result.error;
  } catch {
    return false;
  }
}

function downloadFfmpeg(targetPath: string): Promise<string> {
  const asset = `ffmpeg-${process.platform}-${process.arch}${
    process.platform === "win32" ? ".exe" : ""
  }`;
  return downloadBinary(
    "ffmpeg",
    `https://github.com/eugeneware/ffmpeg-static/releases/latest/download/${asset}`,
    targetPath,
  );
}

function ensureFfmpeg(): Promise<boolean> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      // 1. ffmpeg en PATH.
      if (ffmpegWorks("ffmpeg")) {
        console.log("[music] ffmpeg disponible (PATH)");
        return true;
      }

      // 2. Binario de ffmpeg-static (prism-media lo detecta solo).
      if (
        ffmpegStatic &&
        existsSync(ffmpegStatic) &&
        ffmpegWorks(ffmpegStatic)
      ) {
        console.log("[music] ffmpeg disponible (ffmpeg-static)");
        return true;
      }

      // 3. Descarga de respaldo a ./ffmpeg (prism-media también lo busca ahí).
      const localFfmpeg = path.join(
        process.cwd(),
        process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      );
      if (existsSync(localFfmpeg) && ffmpegWorks(localFfmpeg)) {
        console.log("[music] ffmpeg disponible (local):", localFfmpeg);
        return true;
      }

      try {
        await downloadFfmpeg(localFfmpeg);
        if (ffmpegWorks(localFfmpeg)) {
          console.log("[music] ffmpeg descargado y operativo:", localFfmpeg);
          return true;
        }
      } catch (error) {
        console.error("[music] No se pudo descargar ffmpeg", { error });
      }

      console.error(
        "[music] ⚠️ ffmpeg NO disponible — el audio no se va a escuchar (conversión a opus falla)",
      );
      return false;
    })();
  }
  return ffmpegPromise;
}

void ensureFfmpeg();

// ── python3 ─────────────────────────────────────────────────────────
// yt-dlp es un script de Python; sin python3 no corre (exit 127).
// El apt del build no está instalando paquetes en Railway, así que el
// bot intenta instalarlo en runtime (el contenedor corre como root).
function python3Works(): boolean {
  try {
    const result = spawnSync("python3", ["--version"], { stdio: "ignore" });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore" });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve(1);
      });
    } catch {
      resolve(1);
    }
  });
}

let pythonPromise: Promise<boolean> | null = null;

function ensurePython(): Promise<boolean> {
  if (!pythonPromise) {
    pythonPromise = (async () => {
      if (python3Works()) {
        console.log("[music] python3 disponible");
        return true;
      }

      // Instalación asíncrona: no bloquea el event loop del bot.
      console.log(
        "[music] python3 no está en PATH — instalándolo con apt (async)...",
      );
      await runCommand("apt-get", ["update", "-qq"], 60_000);
      await runCommand("apt-get", ["install", "-y", "-qq", "python3"], 180_000);

      if (python3Works()) {
        console.log("[music] python3 instalado en runtime ✅");
        return true;
      }

      console.error(
        "[music] ⚠️ python3 NO disponible — yt-dlp no va a funcionar",
      );
      return false;
    })();
  }
  return pythonPromise;
}

void ensurePython();

export type Track = {
  duration?: string;
  query?: string;
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
  ytdlProcess: { kill(): void } | null;
  nowPlayingChannelId: string | null;
  nowPlayingMessageId: string | null;
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
      ytdlProcess: null,
      nowPlayingChannelId: null,
      nowPlayingMessageId: null,
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

  const { guild, nowPlayingChannelId, nowPlayingMessageId } = state;

  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.emptyTimer) {
    clearTimeout(state.emptyTimer);
    state.emptyTimer = null;
  }
  if (state.ytdlProcess) {
    state.ytdlProcess.kill();
    state.ytdlProcess = null;
  }

  state.queue = [];
  state.current = null;
  state.connection?.destroy();
  state.connection = null;
  musicStates.delete(guildId);

  if (guild && nowPlayingChannelId && nowPlayingMessageId) {
    void deleteMessageById(guild, nowPlayingChannelId, nowPlayingMessageId);
  }
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

  if (state.ytdlProcess) {
    state.ytdlProcess.kill();
    state.ytdlProcess = null;
  }

  try {
    const youtubedl = await getYoutubeDl();
    const flags = {
      format: "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
      output: "-",
      noPlaylist: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      // yt-dlp necesita un runtime de JS para descifrar el parámetro "n"
      // de YouTube; usamos el propio Node que ejecuta el bot.
      jsRuntimes: `node:${process.execPath}`,
      ...(YOUTUBE_COOKIES_FILE ? { cookies: YOUTUBE_COOKIES_FILE } : {}),
    } as Parameters<typeof youtubedl.exec>[1];

    const proc = youtubedl.exec(next.url, flags);
    state.ytdlProcess = proc;
    const stream = proc.stdout;

    if (!stream) {
      throw new Error("yt-dlp no devolvió un stream de audio.");
    }

    stream.on("error", (error) => {
      console.error("[music] stream error", {
        error,
        guildId,
        title: next.title,
      });
    });

    proc.catch((error) => {
      console.error("[music] yt-dlp failed", {
        error,
        guildId,
        title: next.title,
      });
      const current = musicStates.get(guildId);
      if (current && current.current?.url === next.url) {
        void handleStreamFailure(guildId, next);
      }
    });

    await ensureFfmpeg();
    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });
    resource.volume?.setVolume(state.volume);
    state.current = next;
    console.log("[music] playing", {
      guildId,
      title: next.title,
      streamType: "arbitrary (yt-dlp)",
      connectionStatus: state.connection?.state.status ?? "none",
    });
    state.player.play(resource);

    // Confirma que el reproductor realmente está consumiendo audio.
    state.player.once(AudioPlayerStatus.Playing, () => {
      console.log("[music] player reproduciendo (audio fluyendo)", {
        guildId,
        title: next.title,
      });
    });
    void updateNowPlaying(guildId);
  } catch (error) {
    console.error("[music] failed to stream", {
      error,
      guildId,
      url: next.url,
    });
    void playNext(guildId);
  }
}

// Normaliza un título para detectar duplicados del mismo tema: una misma
// canción aparece varias veces en SoundCloud ("Song", "Song (Official)",
// "Song - Topic", etc.) y no queremos encolar copias del mismo tema.
function normalizeTrackTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[.*?\]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[-–—].*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Busca varios candidatos en SoundCloud. Si uno es DRM protected, la cola
// tiene los siguientes y playNext los probará en orden.
async function searchSoundCloud(query: string): Promise<Track[]> {
  const youtubedl = await getYoutubeDl();
  const flags = {
    dumpSingleJson: true,
    flatPlaylist: true,
    quiet: true,
    noWarnings: true,
    noPlaylist: true,
    noCheckCertificates: true,
  } as Parameters<typeof youtubedl.exec>[1];

  const raw = await youtubedl(`scsearch5:${query}`, flags);
  const entries =
    (
      raw as {
        entries?: Array<{ title?: string; url?: string; webpage_url?: string }>;
      }
    ).entries ?? [];

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const tracks: Track[] = [];
  for (const entry of entries) {
    if (tracks.length >= 3) {
      break;
    }
    const candidate = entry.webpage_url || entry.url;
    if (!candidate || !/^https?:\/\//.test(candidate)) {
      continue;
    }
    if (seenUrls.has(candidate)) {
      continue;
    }
    seenUrls.add(candidate);
    const title = entry.title ?? query;
    const titleKey = normalizeTrackTitle(title);
    if (seenTitles.has(titleKey)) {
      continue;
    }
    seenTitles.add(titleKey);
    tracks.push({
      duration: undefined,
      requestedBy: "",
      title,
      url: candidate,
    });
  }
  return tracks;
}

// Si un tema de YouTube no se puede transmitir (p. ej. IP de datacenter
// bloqueada), reintentamos el mismo texto en SoundCloud automáticamente.
async function handleStreamFailure(
  guildId: string,
  next: Track,
): Promise<void> {
  const state = musicStates.get(guildId);
  if (!state) {
    return;
  }

  const isYouTubeUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(
    next.url,
  );

  // Solo buscamos alternativas si el tema falló por YouTube (datacenter).
  // Si falla un tema de SoundCloud (p. ej. DRM), la cola ya tiene más
  // candidatos del fallback anterior y playNext los probará en orden.
  if (isYouTubeUrl && next.query) {
    try {
      const fallbacks = await searchSoundCloud(next.query);
      if (fallbacks.length > 0) {
        state.queue.unshift(...fallbacks);
        console.log("[music] YouTube falló — reintentando en SoundCloud", {
          guildId,
          query: next.query,
          candidates: fallbacks.map((track) => track.title),
        });
      }
    } catch (error) {
      console.error("[music] fallback a SoundCloud falló", {
        error,
        guildId,
        query: next.query,
      });
    }
  }

  if (state.player.state.status !== AudioPlayerStatus.Idle) {
    state.player.stop();
  } else {
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
    selfMute: false,
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

  // Esperamos a que la conexión esté lista antes de suscribir/reproducir.
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    console.error("[music] No se pudo conectar al canal de voz", {
      guildId,
      channelId,
      error,
    });
    destroyState(guildId);
    throw new Error(
      "No se pudo conectar al canal de voz. Verificá que el bot tenga permisos de Conectar/Hablar.",
    );
  }

  connection.subscribe(state.player);
  console.log("[music] conectado al canal de voz", { guildId, channelId });
  return connection;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// ── Player embed con botones (estilo Rythm) ─────────────────────────
function applyVolume(state: GuildMusicState): void {
  const playerState = state.player.state as {
    resource?: { volume?: { setVolume(volume: number): void } };
  };
  playerState.resource?.volume?.setVolume(state.volume);
}

function buildNowPlayingEmbed(state: GuildMusicState): EmbedBuilder {
  const paused = state.player.state.status === AudioPlayerStatus.Paused;
  const embed = new EmbedBuilder()
    .setColor(paused ? 0xf0b429 : 0x43b581)
    .setTitle(
      state.current
        ? paused
          ? "⏸️ Pausado"
          : "▶️ Reproduciendo"
        : "🎵 Música",
    );

  if (!state.current) {
    embed.setDescription("No hay nada sonando.");
    return embed;
  }

  embed.setDescription(state.current.title);
  const lines: string[] = [];
  if (state.current.requestedBy) {
    lines.push(`Pedida por: **${state.current.requestedBy}**`);
  }
  if (state.current.duration) {
    lines.push(`Duración: ${state.current.duration}`);
  }
  if (lines.length > 0) {
    embed.addFields({ name: "\u200b", value: lines.join("\n") });
  }
  embed.addFields(
    {
      name: "Cola",
      value:
        state.queue.length > 0
          ? `${state.queue.length} tema/s pendiente/s`
          : "Vacía",
      inline: true,
    },
    {
      name: "Volumen",
      value: `${Math.round(state.volume * 100)}%`,
      inline: true,
    },
  );

  return embed;
}

function buildMusicComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const playPause = new ButtonBuilder()
    .setCustomId("music:playpause")
    .setStyle(ButtonStyle.Primary)
    .setEmoji("⏯️");
  const skip = new ButtonBuilder()
    .setCustomId("music:skip")
    .setStyle(ButtonStyle.Primary)
    .setEmoji("⏭️");
  const stop = new ButtonBuilder()
    .setCustomId("music:stop")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("⏹️");
  const leave = new ButtonBuilder()
    .setCustomId("music:leave")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("👋");
  const volDown = new ButtonBuilder()
    .setCustomId("music:vol-")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("🔉");
  const volUp = new ButtonBuilder()
    .setCustomId("music:vol+")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("🔊");
  const queue = new ButtonBuilder()
    .setCustomId("music:queue")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("📜");

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    playPause,
    skip,
    stop,
    leave,
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    volDown,
    volUp,
    queue,
  );
  return [row1, row2];
}

async function deleteMessageById(
  guild: Guild,
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) {
    return;
  }
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) {
    await message.delete().catch(() => {});
  }
}

async function deleteNowPlayingMessage(guildId: string): Promise<void> {
  const state = musicStates.get(guildId);
  if (!state?.guild || !state.nowPlayingMessageId) {
    return;
  }
  const channelId = state.nowPlayingChannelId;
  if (channelId) {
    await deleteMessageById(state.guild, channelId, state.nowPlayingMessageId);
  }
  state.nowPlayingMessageId = null;
}

async function updateNowPlaying(guildId: string): Promise<void> {
  const state = musicStates.get(guildId);
  if (!state?.guild || !state.nowPlayingChannelId) {
    return;
  }

  // Si no hay nada sonando ni en cola, borramos el mensaje del player.
  if (!state.current && state.queue.length === 0) {
    await deleteNowPlayingMessage(guildId);
    return;
  }

  const channel = state.guild.channels.cache.get(state.nowPlayingChannelId);
  if (!channel?.isTextBased()) {
    return;
  }

  const embed = buildNowPlayingEmbed(state);
  const components = buildMusicComponents();

  if (state.nowPlayingMessageId) {
    const message = await channel.messages
      .fetch(state.nowPlayingMessageId)
      .catch(() => null);
    if (message) {
      await message.edit({ embeds: [embed], components }).catch(() => {});
      return;
    }
    state.nowPlayingMessageId = null;
  }

  const sent = await channel
    .send({ embeds: [embed], components })
    .catch(() => null);
  if (sent) {
    state.nowPlayingMessageId = sent.id;
  }
}

// Maneja los botones del player (estilo Rythm).
export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Este botón solo funciona dentro de un servidor.",
      ephemeral: true,
    });
    return;
  }

  // Confirmamos la interacción PRIMERO: Discord espera respuesta en 3s y
  // si tardamos (la config remota puede tardar más), desactiva los botones.
  await interaction.deferUpdate().catch(() => {});

  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;

  if (!(await canUseMusic(guildId, member))) {
    await interaction
      .followUp({
        content:
          "No tenés permiso para controlar la música (se requiere el rol DJ).",
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  const action = interaction.customId.replace("music:", "");
  const state = getState(guildId);

  switch (action) {
    case "playpause": {
      if (state.player.state.status === AudioPlayerStatus.Playing) {
        state.player.pause();
      } else if (state.player.state.status === AudioPlayerStatus.Paused) {
        state.player.unpause();
      }
      break;
    }
    case "skip": {
      if (state.current) {
        state.player.stop();
      }
      break;
    }
    case "stop": {
      if (!isInBotVoiceChannel(member, state)) {
        await interaction
          .followUp({
            content:
              "Para detener la música tenés que estar en el mismo canal de voz que el bot.",
            ephemeral: true,
          })
          .catch(() => {});
        return;
      }
      state.queue = [];
      state.current = null;
      state.player.stop();
      break;
    }
    case "leave": {
      if (!isInBotVoiceChannel(member, state)) {
        await interaction
          .followUp({
            content:
              "Para desconectar el bot tenés que estar en el mismo canal de voz que él.",
            ephemeral: true,
          })
          .catch(() => {});
        return;
      }
      destroyState(guildId);
      return;
    }
    case "vol-": {
      state.volume = Math.max(0, state.volume - 0.15);
      applyVolume(state);
      break;
    }
    case "vol+": {
      state.volume = Math.min(1.5, state.volume + 0.15);
      applyVolume(state);
      break;
    }
    case "queue": {
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
      await interaction
        .followUp({
          content: lines.length > 0 ? lines.join("\n") : "La cola está vacía.",
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }
    default:
      return;
  }

  await updateNowPlaying(guildId);
}

async function resolveTrack(
  query: string,
  fuente: "youtube" | "soundcloud" = "youtube",
): Promise<Track | null> {
  const trimmed = query.trim();
  const isUrl = /^https?:\/\//.test(trimmed);
  const youtubedl = await getYoutubeDl();

  const flags = {
    dumpSingleJson: true,
    flatPlaylist: true,
    quiet: true,
    noWarnings: true,
    noPlaylist: true,
    noCheckCertificates: true,
    // yt-dlp necesita un runtime de JS para descifrar el parámetro "n" de
    // YouTube; sin esto, la extracción de formatos falla.
    jsRuntimes: `node:${process.execPath}`,
    ...(YOUTUBE_COOKIES_FILE ? { cookies: YOUTUBE_COOKIES_FILE } : {}),
  } as Parameters<typeof youtubedl.exec>[1];

  // URL directa (YouTube/SoundCloud) o búsqueda según la fuente.
  // Con --flat-playlist no se extraen formatos (en YouTube eso falla desde
  // IPs de datacenter); solo tomamos id/título/URL de los resultados.
  const target = isUrl
    ? trimmed
    : fuente === "soundcloud"
      ? `scsearch1:${trimmed}`
      : `ytsearch1:${trimmed}`;
  const raw = await youtubedl(target, flags);
  const info = (raw as { entries?: (typeof raw)[] }).entries?.[0] ?? raw;

  // Solo aceptamos URLs de video reales (no "ytsearch1:..." ni entradas nulas).
  const candidate =
    typeof info.webpage_url === "string"
      ? info.webpage_url
      : (info as { url?: string }).url;
  const url =
    candidate && /^https?:\/\//.test(candidate)
      ? candidate
      : isUrl
        ? trimmed
        : "";

  if (!url) {
    console.warn("[music] búsqueda sin resultado utilizable", {
      query: trimmed,
      type: raw._type,
      hasEntries: Boolean((raw as { entries?: unknown[] }).entries?.length),
    });
    return null;
  }

  const title = info.title || trimmed;
  const duration =
    typeof info.duration === "number" && info.duration > 0
      ? formatDuration(info.duration)
      : undefined;

  return {
    duration,
    requestedBy: "",
    title,
    url,
    query: isUrl ? undefined : trimmed,
  };
}

function replyError(interaction: ChatInputCommandInteraction, message: string) {
  return interaction.reply({ content: message, ephemeral: true });
}

// Permiso para usar música: admin siempre puede; si hay roles DJ
// configurados (panel de admin), hay que tener uno de esos roles.
async function canUseMusic(
  guildId: string,
  member: GuildMember | null,
): Promise<boolean> {
  if (!member) {
    return false;
  }

  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  let config: Awaited<ReturnType<typeof getGuildConfig>> | undefined;
  try {
    config = await getGuildConfig(guildId);
  } catch {
    config = undefined;
  }

  if (config?.musicEnabled === false) {
    return false;
  }

  const roleIds = config?.musicRoleIds ?? [];
  if (roleIds.length === 0) {
    return true; // sin restricción de rol
  }

  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

// Para detener/desconectar el bot hay que estar en el MISMO canal de voz
// que él: evita que alguien externo (aunque tenga rol DJ) corte la música
// que se está reproduciendo.
function isInBotVoiceChannel(
  member: GuildMember | null,
  state: GuildMusicState,
): boolean {
  const botChannelId = state.connection?.joinConfig.channelId;
  if (!botChannelId) {
    return true; // el bot no está en ningún canal: no hay nada que proteger
  }
  return member?.voice.channelId === botChannelId;
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

  const allowed = await canUseMusic(guildId, member);
  if (!allowed) {
    await replyError(
      interaction,
      "No tenés permiso para usar la música. Se requiere el rol de DJ configurado en el panel de admin.",
    );
    return;
  }

  try {
    switch (interaction.commandName) {
      case "play": {
        const query = interaction.options.getString("cancion", true);
        const fuente = (interaction.options.getString("fuente") ??
          "youtube") as "youtube" | "soundcloud";
        const voiceChannel = member?.voice.channel;
        console.log("[music] play requested", {
          guildId,
          query,
          fuente,
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
          track = await resolveTrack(query, fuente);
        } catch (error) {
          console.error("[music] resolveTrack failed", {
            error,
            guildId,
            query,
            fuente,
          });
          await interaction.editReply(
            "No pude obtener el tema en este momento (posible bloqueo 429 o problema temporal). " +
              "Probá de nuevo en unos minutos.",
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
        // Canal donde vive el player embed con botones.
        state.nowPlayingChannelId = interaction.channelId;

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
        void updateNowPlaying(guildId);
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
        void updateNowPlaying(guildId);
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
        void updateNowPlaying(guildId);
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
        void updateNowPlaying(guildId);
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
        state.volume = Math.max(0, Math.min(200, level)) / 100;
        applyVolume(state);
        await interaction.reply(`🔊 Volumen: **${level}%**`);
        void updateNowPlaying(guildId);
        return;
      }

      case "stop": {
        const state = getState(guildId);
        if (!isInBotVoiceChannel(member, state)) {
          await replyError(
            interaction,
            "Para detener el bot tenés que estar en el mismo canal de voz que él.",
          );
          return;
        }
        destroyState(guildId);
        await interaction.reply("⏹️ Música detenida y cola limpiada.");
        return;
      }

      case "leave": {
        const state = getState(guildId);
        if (!isInBotVoiceChannel(member, state)) {
          await replyError(
            interaction,
            "Para desconectar el bot tenés que estar en el mismo canal de voz que él.",
          );
          return;
        }
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
