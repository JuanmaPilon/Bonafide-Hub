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
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;

type DailyMessage = { content: string; id: string };

const timers = new Map<string, NodeJS.Timeout>();

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

    const picked = messages[Math.floor(Math.random() * messages.length)];
    await channel.send(picked.content).catch((error) => {
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
  const timer = timers.get(guildId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(guildId);
  }
}

// Programa la próxima publicación con un delay aleatorio en [min, max]
// minutos. Al publicar, vuelve a programar (el loro nunca se detiene solo).
// Si la config no está activa, no programa (el sweep lo vuelve a chequear).
function scheduleNext(guild: Guild): void {
  const guildId = guild.id;
  clearTimer(guildId);

  void getGuildConfig(guildId)
    .then((config) => {
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
          scheduleNext(guild);
        })();
      }, delayMs);
      timers.set(guildId, timer);
    })
    .catch(() => {
      // Silencioso: si el API no responde, el sweep reintenta después.
    });
}

export function startDailyMessagesProcessor(client: Client): void {
  const sweep = (): void => {
    for (const guild of client.guilds.cache.values()) {
      scheduleNext(guild);
    }
  };

  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS);

  client.on(Events.GuildCreate, (guild) => scheduleNext(guild));
  client.on(Events.GuildDelete, (guild) => clearTimer(guild.id));
}
