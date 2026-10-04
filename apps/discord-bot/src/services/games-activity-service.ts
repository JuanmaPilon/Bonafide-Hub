import { env } from "../config/env.js";

// ── Juegos que se juegan en el server (lado bot) ───────────────────
// Discord no expone los "Server Insights" por API, así que acumulamos lo que
// vemos con presenceUpdate (intent GuildPresences) y lo mandamos al API.
//
// El Gateway dispara MUCHOS presenceUpdate: acá solo se encola cuando el juego
// CAMBIA (o cuando aparece uno nuevo), y el flush agrupa por guild.

const remoteApiBaseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const remoteApiToken = env.BOT_CONFIG_API_TOKEN?.trim();
// Cada cuánto se manda lo acumulado. El API agrupa por persona + juego + día,
// así que mandar el mismo juego dos veces no duplica nada.
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;
// Techo por las dudas de que el API esté caído mucho rato.
const MAX_PENDING_ENTRIES = 2000;

type PendingGameActivity = {
  applicationId: string;
  applicationName: string;
  guildId: string;
  userId: string;
};

const pending = new Map<string, PendingGameActivity>();
// Último juego reportado por persona y guild: null = no está jugando nada.
const lastReported = new Map<string, string | null>();

export function isGameTrackingEnabled(): boolean {
  return Boolean(remoteApiBaseUrl && remoteApiToken);
}

export function trackGamePresence(input: {
  applicationId?: string | null;
  applicationName?: string | null;
  guildId: string;
  userId: string;
}): void {
  if (!isGameTrackingEnabled()) {
    return;
  }

  const key = `${input.guildId}:${input.userId}`;
  const applicationId = input.applicationId?.trim() || null;
  if (lastReported.get(key) === applicationId) {
    return;
  }
  lastReported.set(key, applicationId);
  if (!applicationId || !input.applicationName?.trim()) {
    return;
  }
  if (pending.size >= MAX_PENDING_ENTRIES) {
    return;
  }

  pending.set(`${key}:${applicationId}`, {
    applicationId,
    applicationName: input.applicationName.trim(),
    guildId: input.guildId,
    userId: input.userId,
  });
}

export async function flushGameActivity(): Promise<void> {
  if (!isGameTrackingEnabled() || pending.size === 0) {
    return;
  }

  const byGuild = new Map<string, PendingGameActivity[]>();
  for (const entry of pending.values()) {
    const bucket = byGuild.get(entry.guildId) ?? [];
    bucket.push(entry);
    byGuild.set(entry.guildId, bucket);
  }
  pending.clear();

  for (const [guildId, entries] of byGuild) {
    try {
      const response = await fetch(
        `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/games/presence`,
        {
          body: JSON.stringify({
            entries: entries.map((entry) => ({
              applicationId: entry.applicationId,
              applicationName: entry.applicationName,
              userId: entry.userId,
            })),
          }),
          headers: {
            "content-type": "application/json",
            "x-bot-token": remoteApiToken as string,
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(`${response.status}${details ? `: ${details.slice(0, 160)}` : ""}`);
      }
    } catch (error) {
      // Se devuelve a la cola: el próximo flush reintenta.
      for (const entry of entries) {
        pending.set(`${guildId}:${entry.userId}:${entry.applicationId}`, entry);
      }
      console.error("[discord-bot] Failed to report game activity", {
        entries: entries.length,
        error,
        guildId,
      });
    }
  }
}

export function startGameActivityReporter(): void {
  if (!isGameTrackingEnabled()) {
    console.log(
      "[discord-bot] Game activity tracking disabled (remote store not configured)",
    );
    return;
  }
  setInterval(() => {
    void flushGameActivity();
  }, FLUSH_INTERVAL_MS);
}
