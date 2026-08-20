import { Client, Events, Guild } from "discord.js";
import { env } from "../config/env.js";
import { getGuildConfig } from "./guild-config-store.js";

// "Loro de Karpindomo": el bot publica frases aleatorias a intervalos
// aleatorios (no fijos) en el canal configurado de la guild. Cada ciclo
// relee la config, así los cambios del admin aplican sin reiniciar.

const remoteApiBaseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const remoteApiToken = env.BOT_CONFIG_API_TOKEN?.trim();
const remoteTimeoutMs = 5000;
// Cada cuanto revisamos si la config/frases cambiaron para re-programar.
// IMPORTANTE: el sweep solo reprograma si la config cambió; no resetea un
// timer que ya está programado (si lo reseteáramos, un rango de 30-90 min
// nunca dispararía porque el sweep de 2 min lo reinicia siempre).
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;

type DailyMessage = { content: string; id: string };

// Timer + la config con la que se programó, para detectar cambios.
type ScheduledTimer = {
  configKey: string;
  timer: NodeJS.Timeout;
};

const timers = new Map<string, ScheduledTimer>();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

async function fetchEnabledDailyMessages(
  guildId: string,
): Promise<DailyMessage[]> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    return [];
  }

  try {
    const controller = createTimeoutController(remoteTimeoutMs);
    const response = await fetch(
      `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/daily-messages`,
      {
        headers: {
          "x-bot-token": remoteApiToken,
        },
        method: "GET",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      messages?: DailyMessage[];
    };
    return payload.messages ?? [];
  } catch (error) {
    console.warn(
      `[daily-messages] Failed to fetch messages for guild ${guildId}: ${getErrorMessage(error)}`,
    );
    return [];
  }
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Introducciones estilo "mayordomo de Karpindomo": se eligen al azar y la
// frase del loro se publica debajo, en su propia línea.
const BUTLER_OPENERS = [
  "📢 Atención todos, frase del día:",
  "🗞️ Frase del día:",
  "🎩 La minuta del momento, señor:",
  "☕ Un momento, señor. Frase del día:",
  "📜 Proclama de Karpindomo:",
  "🕰️ La hora del conocimiento ha llegado:",
  "🧐 Disculpe la molestia, señor, pero:",
  "🔔 Atención, atención:",
  "🪄 Ejem, ejem... frase del día:",
  "🍾 Un brindis y una reflexión, señor:",
];

// Publica una frase al azar en el canal configurado (si corresponde).
async function postRandomMessage(guild: Guild): Promise<void> {
  try {
    const config = await getGuildConfig(guild.id);
    if (!config.dailyMessagesEnabled) {
      return;
    }
    const channelId = config.dailyMessagesChannelId;
    if (!channelId) {
      return;
    }

    const messages = await fetchEnabledDailyMessages(guild.id);
    if (messages.length === 0) {
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return;
    }

    const picked = pickRandom(messages);
    const opener = pickRandom(BUTLER_OPENERS);
    await channel.send(`${opener}\n${picked.content}`).catch((error) => {
      console.warn("[daily-messages] Failed to send", {
        guildId: guild.id,
        error: getErrorMessage(error),
      });
    });
  } catch (error) {
    console.warn("[daily-messages] postRandomMessage failed", {
      guildId: guild.id,
      error: getErrorMessage(error),
    });
  }
}

function clearTimer(guildId: string): void {
  const entry = timers.get(guildId);
  if (entry) {
    clearTimeout(entry.timer);
    timers.delete(guildId);
  }
}

// Clave de la config que afecta al scheduler: si cambia, reprogramamos.
function scheduleConfigKey(config: {
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
}): string {
  return [
    config.dailyMessagesEnabled ? "1" : "0",
    config.dailyMessagesChannelId ?? "",
    config.dailyMessagesMinMinutes ?? 15,
    config.dailyMessagesMaxMinutes ?? 90,
  ].join("|");
}

// Programa la próxima publicación con un delay aleatorio en [min, max]
// minutos. Al publicar, vuelve a programar (el loro nunca se detiene solo).
// Si ya hay un timer activo con la misma config, no lo toca.
function scheduleNext(guild: Guild, config: {
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
}): void {
  const guildId = guild.id;
  const configKey = scheduleConfigKey(config);

  const existing = timers.get(guildId);
  if (existing) {
    if (existing.configKey === configKey) {
      return; // ya programado con esta config: no reseteamos el delay
    }
    clearTimer(guildId);
  }

  if (!config.dailyMessagesEnabled || !config.dailyMessagesChannelId) {
    return;
  }

  const min = Math.max(1, config.dailyMessagesMinMinutes ?? 15);
  const max = Math.max(min, config.dailyMessagesMaxMinutes ?? 90);
  const delayMinutes = randomBetween(min, max);
  const delayMs = delayMinutes * 60 * 1000;

  const timer = setTimeout(() => {
    timers.delete(guildId);
    void (async () => {
      await postRandomMessage(guild);
      const nextConfig = await getGuildConfig(guildId).catch(() => null);
      if (nextConfig) {
        scheduleNext(guild, nextConfig);
      }
    })();
  }, delayMs);
  timers.set(guildId, { configKey, timer });
}

export function startDailyMessagesProcessor(client: Client): void {
  const sweep = (): void => {
    for (const guild of client.guilds.cache.values()) {
      void getGuildConfig(guild.id)
        .then((config) => {
          scheduleNext(guild, config);
        })
        .catch(() => {
          // Silencioso: si el API no responde, reintentamos en el próximo sweep.
        });
    }
  };

  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS);

  client.on(Events.GuildCreate, (guild) => {
    void getGuildConfig(guild.id)
      .then((config) => scheduleNext(guild, config))
      .catch(() => {});
  });
  client.on(Events.GuildDelete, (guild) => clearTimer(guild.id));
}
