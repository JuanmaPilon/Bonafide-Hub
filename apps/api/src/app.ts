import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import {
  cancelReminder,
  createReminder,
  listGuildReminders,
} from "./services/reminders-store.js";
import {
  createAuditLogEntry,
  listAuditLogEntries,
} from "./services/audit-log-store.js";
import {
  createCommunication,
  deleteCommunication,
  getCommunication,
  createCommunicationInstance,
  deleteCommunicationInstance,
  deleteMessages,
  editMessages,
  getCommunicationInstance,
  listCommunications,
  listPublishedInstances,
  markCommunicationPublished,
  postMessages,
  splitForDiscord,
  updateCommunication,
  updateCommunicationInstance,
  type Communication,
  type CommunicationInstance,
} from "./services/communications-store.js";
import { resolveMentions } from "./services/mention-resolver.js";
import {
  createDailyMessage,
  deleteDailyMessage,
  listDailyMessages,
  listEnabledDailyMessages,
  updateDailyMessage,
} from "./services/daily-messages-store.js";
import {
  buildRaidLogMessage,
  createRaidLog,
  deleteRaidLog,
  extractReportCode,
  hideRaidLog,
  listHiddenRaidLogs,
  listRaidLogs,
  listUnpostedRaidLogs,
  listWatchGuildConfigs,
  markRaidLogPosted,
  refreshRaidLog,
  showRaidLog,
  syncGuildWatch,
} from "./services/raid-logs-store.js";
import {
  burnKarutaCard,
  createKarutaDrop,
  deleteKarutaAlbum,
  deleteKarutaCard,
  deleteKarutaDrop,
  createKarutaDebugEvent,
  getKarutaAlbumPageImage,
  listAllKarutaAlbums,
  listCachedKarutaAlbumPages,
  listKarutaAlbums,
  listKarutaDebugEvents,
  listOwnedKarutaCards,
  listRecentKarutaDrops,
  processKarutaGrab,
  processKarutaTransfer,
  pruneKarutaDebugEvents,
  saveKarutaAlbumPageImage,
  upsertKarutaAlbum,
  upsertKarutaCard,
} from "./services/karuta-store.js";
import {
  downloadDiscordImage,
  fetchDiscordMessageImageUrls,
  isDiscordCdnUrlFresh,
  refreshDiscordAttachmentUrls,
} from "./services/discord-cdn.js";
import {
  EVENT_TYPES,
  RAID_ROLES,
  SIGNUP_ROLES,
  SIGNUP_STATUSES,
  createEvent,
  createEventImage,
  createRaidSpec,
  deleteEvent,
  deleteEventImage,
  deleteRaidSpec,
  deleteSignup,
  getEvent,
  listEventImages,
  listEvents,
  listEventsPendingCloseAnnouncement,
  listRecurrenceSeries,
  listRaidSpecs,
  listReminderDueEvents,
  listReportPendingEvents,
  markEventRemindersSent,
  markEventReportSent,
  markEventSignupClosed,
  setEventDiscordInfo,
  setEventRecurrenceNext,
  type HubEvent,
  updateEvent,
  updateRaidSpec,
  upsertSignup,
} from "./services/events-store.js";
import {
  buildEventAnnouncementEmbeds,
  buildEventSignupActionRows,
  cleanupEventDiscord,
  syncEventToDiscord,
  updateEventAnnouncement,
  type AnnouncementSignup,
  type EventDiscordOptions,
  type EventRecurrence,
} from "./services/events-discord-publisher.js";
import {
  getGuildConfig,
  type GuildConfig,
  replaceGuildConfig,
  upsertGuildConfig,
} from "./services/guild-config-store.js";
import {
  getXpConfig,
  type XpConfig,
  type XpRoleRule,
  upsertXpConfig,
} from "./services/xp-config-store.js";
import {
  addXp,
  getLeaderboard,
  getXpProfile,
  importXpEntries,
  listXpProfiles,
  resetAllXp,
  resetXpProfile,
  setXpLevel,
  type XpImportEntry,
} from "./services/xp-store.js";
import {
  buildClearCookie,
  buildCookieHeader,
  buildSessionCookie,
  clearDiscordSession,
  consumeOAuthState,
  createDiscordSession,
  createOAuthState,
  getDiscordSession,
  getManageGuildFilter,
  getSessionCookieName,
  getStateCookieName,
  parseCookieHeader,
  verifySignedSessionId,
} from "./services/discord-auth.js";

type DiscordTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
};

type DiscordGuildWidgetResponse = {
  id: string;
  name: string;
  instant_invite?: string;
  presence_count?: number;
};

// Módulos por rango de staff. Deben coincidir con STAFF_TIERS de la web
// para poder resolver, a partir de adminRoleModules, qué roles tienen cada
// rango (usado para saber quién recibe las sugerencias).
const STAFF_TIER_MODULES: Record<"admin" | "officer", string[]> = {
  admin: ["config", "comunicados", "raids", "daily", "xp", "karuta", "eventos"],
  officer: ["comunicados", "raids", "daily", "karuta", "eventos"],
};

// Fetch a Discord con reintento ante rate limits (429). Discord manda el
// header retry-after; si no viene, usamos un backoff simple. Así un 429
// transitorio (común con IPs compartidas de Railway) no rompe el login ni
// la resolución de nombres.
async function fetchWithDiscordRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    response = await fetch(url, init);
    if (response.status !== 429) {
      return response;
    }

    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfterMs = retryAfterRaw ? Number(retryAfterRaw) * 1000 : NaN;
    const waitMs =
      Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs
        : 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  return response as Response;
}

async function fetchDiscordJson<T>(
  path: string,
  accessToken: string,
): Promise<T> {
  const response = await fetchWithDiscordRetry(
    `https://discord.com/api/v10${path}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Discord API request failed for ${path} (${response.status})`,
    );
  }

  return (await response.json()) as T;
}

type DiscordGuildMember = {
  avatar?: string | null;
  nick?: string | null;
  premium_since?: string | null;
  roles?: string[];
  user?: {
    avatar?: string | null;
    global_name?: string | null;
    id: string;
    username: string;
  } | null;
};

type LeaderboardUserInfo = {
  avatarUrl: string | null;
  isBooster: boolean;
  nickname: string | null;
  username: string;
};

type GuildBooster = {
  avatarUrl: string | null;
  nickname: string | null;
  premiumSince: string;
  userId: string;
  username: string;
};

function buildAvatarUrl(userId: string, avatarHash: string): string {
  // Discord marca los avatares animados con el hash PREFIJADO "a_"
  // (ej: a_4f8a...). Con eso elegimos la extensión gif.
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=128`;
}

// Los avatares de servidor (server avatars) usan OTRA URL en el CDN:
// /guilds/{guildId}/users/{userId}/avatars/{hash}.{ext}
function buildServerAvatarUrl(
  guildId: string,
  userId: string,
  avatarHash: string,
): string {
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${extension}?size=128`;
}

// Banner de usuario: https://cdn.discordapp.com/banners/{userId}/{hash}.{ext}
function buildUserBannerUrl(userId: string, bannerHash: string): string {
  const extension = bannerHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/banners/${userId}/${bannerHash}.${extension}?size=1024`;
}

// Caché corta de miembros: evita paginar TODA la guild en cada carga del
// leaderboard, que es lo que termina disparando rate limits (429) de
// Discord sobre la IP compartida de Railway.
const guildMembersCache = new Map<
  string,
  { at: number; members: DiscordGuildMember[] }
>();
const GUILD_MEMBERS_TTL_MS = 4 * 60 * 1000;

async function fetchAllGuildMembers(
  guildId: string,
): Promise<DiscordGuildMember[]> {
  if (!env.DISCORD_BOT_TOKEN) {
    return [];
  }

  const cached = guildMembersCache.get(guildId);
  if (cached && Date.now() - cached.at < GUILD_MEMBERS_TTL_MS) {
    return cached.members;
  }

  const members: DiscordGuildMember[] = [];
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) {
      query.set("after", after);
    }

    const response = await fetchWithDiscordRetry(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members?${query.toString()}`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      console.warn(
        `[api] Discord members fetch failed for guild ${guildId} (${response.status})`,
      );
      throw new Error(
        `Discord members fetch failed for guild ${guildId} (${response.status})`,
      );
    }

    const pageMembers = (await response.json()) as DiscordGuildMember[];
    members.push(...pageMembers);

    if (pageMembers.length < 1000) {
      break;
    }

    const lastMember = pageMembers[pageMembers.length - 1];
    after = lastMember.user?.id;
    if (!after) {
      break;
    }
  }

  if (members.length > 0) {
    guildMembersCache.set(guildId, { at: Date.now(), members });
  }

  return members;
}

// Miembro puntual (GET /guilds/:gid/members/:uid con el token del bot).
// Devuelve el miembro (nick + roles) para guardar el nick de servidor en el
// signup y para evaluar el rol mínimo requerido del evento.
async function fetchGuildMemberRecord(
  guildId: string,
  userId: string,
): Promise<DiscordGuildMember | null> {
  if (!env.DISCORD_BOT_TOKEN) {
    return null;
  }
  try {
    const response = await fetchWithDiscordRetry(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as DiscordGuildMember;
  } catch {
    return null;
  }
}

// Nombre para mostrar de un miembro: nick de servidor, si no global_name,
// si no username.
function memberDisplayName(member: DiscordGuildMember | null): string | null {
  if (!member) {
    return null;
  }
  const nick = member.nick?.trim();
  if (nick) {
    return nick;
  }
  return (
    member.user?.global_name?.trim() ?? member.user?.username?.trim() ?? null
  );
}

// Si el evento exige un rol mínimo y la persona NO lo tiene, un "Voy" (yes)
// pasa a bench (no entra al roster principal), estilo Raid Helper. Tarde y
// No asisto se mantienen igual.
function applyRequiredRoleStatus(
  status: string,
  member: DiscordGuildMember | null,
  requiredRoleId: string | undefined,
): string {
  if (
    status === "yes" &&
    requiredRoleId &&
    !(member?.roles ?? []).includes(requiredRoleId)
  ) {
    return "bench";
  }
  return status;
}

async function fetchGuildMembersForLeaderboard(
  guildId: string,
): Promise<Map<string, LeaderboardUserInfo>> {
  const result = new Map<string, LeaderboardUserInfo>();
  const members = await fetchAllGuildMembers(guildId).catch(() => []);

  for (const member of members) {
    if (!member.user) {
      continue;
    }

    // Avatar global si existe; si no, avatar de servidor (otra URL en el CDN).
    let avatarUrl: string | null = null;
    if (member.user.avatar) {
      avatarUrl = buildAvatarUrl(member.user.id, member.user.avatar);
    } else if (member.avatar) {
      avatarUrl = buildServerAvatarUrl(guildId, member.user.id, member.avatar);
    }

    result.set(member.user.id, {
      avatarUrl,
      isBooster: Boolean(member.premium_since),
      nickname: member.nick ?? null,
      username: member.user.username,
    });
  }

  return result;
}

async function fetchGuildBoosters(guildId: string): Promise<GuildBooster[]> {
  const members = await fetchAllGuildMembers(guildId).catch(() => []);

  return members
    .filter((member) => member.user && member.premium_since)
    .map((member) => {
      let avatarUrl: string | null = null;
      if (member.user?.avatar) {
        avatarUrl = buildAvatarUrl(member.user.id, member.user.avatar);
      } else if (member.user && member.avatar) {
        avatarUrl = buildServerAvatarUrl(
          guildId,
          member.user.id,
          member.avatar,
        );
      }

      return {
        avatarUrl,
        nickname: member.nick ?? null,
        premiumSince: member.premium_since as string,
        userId: member.user?.id ?? "",
        username: member.user?.username ?? "",
      };
    })
    .filter((booster) => booster.userId);
}

// ── Scheduler de Logs de Raid ───────────────────────────────────────
// "Observa" los reports que todavía no se publicaron en Discord: si ya
// tienen fights, publica el resumen en el canal configurado. Así un link
// pegado antes de que el report esté completo se publica apenas aparezcan
// los fights, sin spamear.
const RAID_LOG_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let raidLogSyncTimer: NodeJS.Timeout | null = null;

async function runRaidLogSync(): Promise<void> {
  // 1) Reports pegados manualmente que aún no se publicaron.
  //    try/catch independiente: un error acá no debe bloquear el watch (parte 2).
  try {
    const logs = await listUnpostedRaidLogs();
    for (const log of logs) {
      const config = await getGuildConfig(log.guildId);
      const token = env.DISCORD_BOT_TOKEN;
      if (!config.logsChannelId || !token) {
        continue; // sin canal configurado: no hay dónde publicar
      }

      const result = await refreshRaidLog(log.id);
      if (result.changed && result.log) {
        const chunks = splitForDiscord(buildRaidLogMessage(result.log));
        const ids = await postMessages(token, config.logsChannelId, chunks);
        if (ids.length > 0) {
          await markRaidLogPosted(log.id);
        }
      }
    }
  } catch (error) {
    console.error("[raid-logs] manual publish sync failed", error);
  }

  // 2) Vigilado de perfil: crea logs de RAID nuevos automáticamente.
  try {
    const watched = await listWatchGuildConfigs();
    if (watched.length > 0) {
      console.log(
        `[raid-logs] watch: ${watched.length} guild/s con vigilado configurado`,
      );
    }

    for (const watch of watched) {
      if (!watch.guild || !watch.server) {
        continue;
      }
      const config = await getGuildConfig(watch.guildId);
      const token = env.DISCORD_BOT_TOKEN;

      if (!config.logsWatchEnabled) {
        // Log claro: si el toggle está apagado, el watch NO corre. Esto
        // ayuda a diagnosticar "no detecta logs".
        console.warn(
          `[raid-logs] watch ${watch.guild}@${watch.server}: logsWatchEnabled está APAGADO para guild ${watch.guildId}. Activá "Vigilado activado" en el panel Admin.`,
        );
        continue;
      }

      const result = await syncGuildWatch({
        guild: watch.guild,
        guildId: watch.guildId,
        region: watch.region || "EU",
        server: watch.server,
      });

      if (result.error) {
        console.warn(
          `[raid-logs] watch failed for ${watch.guildId}: ${result.error}`,
        );
        continue;
      }

      for (const created of result.created) {
        const refreshed = await refreshRaidLog(created.id);
        if (refreshed.error) {
          console.warn(
            `[raid-logs] report ${created.reportCode} detectado pero no se pudo refrescar: ${refreshed.error}`,
          );
        }
        if (
          config.logsChannelId &&
          token &&
          refreshed.changed &&
          refreshed.log
        ) {
          const chunks = splitForDiscord(buildRaidLogMessage(refreshed.log));
          const ids = await postMessages(token, config.logsChannelId, chunks);
          if (ids.length > 0) {
            await markRaidLogPosted(created.id);
            console.log(
              `[raid-logs] report ${created.reportCode} publicado en Discord para guild ${watch.guildId}`,
            );
          } else {
            console.warn(
              `[raid-logs] report ${created.reportCode} detectado, pero Discord no devolvió mensajes creados (guild ${watch.guildId})`,
            );
          }
        } else if (!config.logsChannelId) {
          console.warn(
            `[raid-logs] report ${created.reportCode} detectado, pero no hay logsChannelId configurado para guild ${watch.guildId}`,
          );
        }
      }
    }
  } catch (error) {
    console.error("[raid-logs] watch sync failed", error);
  }
}

function startRaidLogSync(): void {
  if (raidLogSyncTimer) {
    return;
  }
  console.log(
    `[raid-logs] scheduler iniciado (intervalo ${RAID_LOG_SYNC_INTERVAL_MS / 60000} min, API key ${env.WARCRAFT_LOGS_API_KEY ? "configurada" : "FALTANTE"}, token Discord ${env.DISCORD_BOT_TOKEN ? "configurado" : "FALTANTE"})`,
  );
  void runRaidLogSync();
  raidLogSyncTimer = setInterval(() => {
    void runRaidLogSync();
  }, RAID_LOG_SYNC_INTERVAL_MS);
}

// ── Cierre de inscripciones de eventos ──────────────────────────────
// Cuando a un evento publicado le pasa el cierre de inscripciones, hay que
// re-renderizar el aviso en Discord (embed rojo + botones deshabilitados).
// Nada dispara ese refresh por sí solo (ya no se puede anotar), así que lo
// revisamos cada minuto. El marcador signupClosedAt evita repetirlo.
const EVENT_CLOSE_SYNC_INTERVAL_MS = 60 * 1000;
let eventCloseSyncTimer: NodeJS.Timeout | null = null;
// Para avisar una sola vez por evento si el refresh falla (si no, el
// reintento por minuto llenaría el log).
const closeSyncWarned = new Set<string>();

async function runEventCloseSync(): Promise<void> {
  try {
    const pending = await listEventsPendingCloseAnnouncement();
    for (const event of pending) {
      const refreshed = await refreshEventAnnouncement(event.guildId, event.id);
      if (refreshed) {
        closeSyncWarned.delete(event.id);
        await markEventSignupClosed(event.guildId, event.id);
        console.log(
          `[eventos] inscripciones cerradas: aviso actualizado (${event.title})`,
        );
      } else if (!closeSyncWarned.has(event.id)) {
        closeSyncWarned.add(event.id);
        console.warn(
          `[eventos] no se pudo actualizar el aviso por cierre de "${event.title}"; se reintenta.`,
        );
      }
    }
  } catch (error) {
    console.error("[eventos] close sync failed", error);
  }
}

function startEventCloseSync(): void {
  if (eventCloseSyncTimer) {
    return;
  }
  void runEventCloseSync();
  eventCloseSyncTimer = setInterval(() => {
    void runEventCloseSync();
  }, EVENT_CLOSE_SYNC_INTERVAL_MS);
}

// ── Recurrencia de eventos ──────────────────────────────────────────
// Cada minuto revisa las series (recurrenceEnabled) cuya próxima fecha ya
// venció: crea una COPIA del evento (con su propia publicación en Discord) y
// avanza la serie. Si el evento está pausado, no se genera nada.
const EVENT_RECURRENCE_SYNC_INTERVAL_MS = 60 * 1000;
// Tope de copias por tick: si el server estuvo caído mucho tiempo, evita
// crear de golpe decenas de eventos.
const EVENT_RECURRENCE_MAX_CATCHUP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
let eventRecurrenceTimer: NodeJS.Timeout | null = null;

async function createRecurrenceCopy(
  head: HubEvent,
  startsAt: Date,
): Promise<void> {
  // El cierre de inscripciones se mantiene a la misma antelación respecto
  // del inicio (si la tenía).
  const deadlineOffsetMs = head.signupDeadline
    ? head.signupDeadline.getTime() - head.startsAt.getTime()
    : null;
  const created = await createEvent({
    createdByUserId: head.createdByUserId,
    createdByUsername: head.createdByUsername,
    description: head.description,
    discordCleanupOnComplete: head.discordCleanupOnComplete,
    durationMinutes: head.durationMinutes,
    guildId: head.guildId,
    imageUrl: head.imageUrl,
    reminderHours: head.reminderHours,
    requiredRoleId: head.requiredRoleId ?? null,
    signupDeadline:
      deadlineOffsetMs !== null
        ? new Date(startsAt.getTime() + deadlineOffsetMs).toISOString()
        : undefined,
    startsAt: startsAt.toISOString(),
    title: head.title,
    type: head.type,
  });

  // Publicación en Discord igual que la cabecera (solo si tenía aviso o
  // Scheduled Event). Las copias NO heredan la recurrencia.
  const hadMessage = (head.discordMessageIds ?? []).length > 0;
  const hadScheduledEvent = Boolean(head.discordEventId);
  if (head.publishChannelId || hadScheduledEvent) {
    const discordOpts: EventDiscordOptions = {
      createScheduledEvent:
        head.discordEventConfig?.createScheduledEvent ?? hadScheduledEvent,
      entityType: head.discordEventConfig?.entityType ?? "voice",
      location: head.discordEventConfig?.location,
      publishChannelId: head.publishChannelId,
      publishMessage: hadMessage && Boolean(head.publishChannelId),
      recurrence: "none",
      voiceChannelId: head.voiceChannelId,
    };
    if (!validateDiscordOptions(discordOpts)) {
      await syncAndStoreEventDiscord({ discordOpts, event: created });
    }
  }

  console.log(
    `[eventos] recurrencia: copia creada de "${head.title}" para ${startsAt.toISOString()}`,
  );
}

async function runEventRecurrenceSync(): Promise<void> {
  try {
    const series = await listRecurrenceSeries();
    for (const head of series) {
      const every = head.recurrenceEveryDays;
      if (!every || every <= 0 || !head.recurrenceNextAt) {
        continue;
      }
      const stepMs = every * DAY_MS;
      // Cuántos días antes de la fecha del evento se publica la ocurrencia.
      const publishBeforeMs =
        Math.max(1, head.recurrencePublishDaysBefore ?? 1) * DAY_MS;
      let nextAt = head.recurrenceNextAt;
      let changed = false;

      // 1) Ocurrencias cuya fecha ya pasó (API caída mucho tiempo): las
      // salteamos para no crear eventos viejos.
      if (nextAt.getTime() <= Date.now()) {
        const steps = Math.ceil((Date.now() - nextAt.getTime()) / stepMs);
        nextAt = new Date(nextAt.getTime() + steps * stepMs);
        changed = true;
      }

      // 2) Creamos las ocurrencias que ya entraron en su ventana de
      // publicación (X días antes de la fecha del evento).
      let created = 0;
      while (
        nextAt.getTime() - publishBeforeMs <= Date.now() &&
        nextAt.getTime() > Date.now() &&
        created < EVENT_RECURRENCE_MAX_CATCHUP
      ) {
        try {
          await createRecurrenceCopy(head, nextAt);
        } catch (error) {
          console.error(
            `[eventos] recurrencia falló para "${head.title}"`,
            error,
          );
          break;
        }
        nextAt = new Date(nextAt.getTime() + stepMs);
        created += 1;
        changed = true;
      }

      if (changed) {
        await setEventRecurrenceNext(head.guildId, head.id, nextAt);
      }
    }
  } catch (error) {
    console.error("[eventos] recurrence sync failed", error);
  }
}

function startEventRecurrenceSync(): void {
  if (eventRecurrenceTimer) {
    return;
  }
  void runEventRecurrenceSync();
  eventRecurrenceTimer = setInterval(() => {
    void runEventRecurrenceSync();
  }, EVENT_RECURRENCE_SYNC_INTERVAL_MS);
}

// ── Imágenes de álbumes de Karuta ───────────────────────────────────
// Las URLs de los adjuntos de Discord vencen (~24 h). Estrategia en dos capas:
//   1) CACHE: bajamos los bytes de la imagen y los guardamos en nuestra DB
//      (`karuta_album_pages`). Una vez cacheada, la Colección se sirve desde
//      `/public/.../pages/:page/image` y ya no depende de Discord.
//   2) PUNTERO: si una URL venció y no tenemos los bytes, re-firmamos la URL
//      con el endpoint de refresh de adjuntos (o releyendo el mensaje de
//      Karuta, para la página que muestra hoy).
const KARUTA_ALBUM_IMAGE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
// No reintentamos el mismo álbum antes de este tiempo (evita castigar a
// Discord desde el refresco "lazy" que corre al abrir la Colección).
const KARUTA_ALBUM_IMAGE_THROTTLE_MS = 10 * 60 * 1000;
// Máximo de imágenes a cachear por pasada (evita ráfagas de descargas).
const KARUTA_ALBUM_PAGE_CACHE_PER_PASS = 12;
// Tope de tamaño por imagen (las páginas de Karuta rondan los cientos de KB).
const KARUTA_ALBUM_PAGE_MAX_BYTES = 6 * 1024 * 1024;
let karutaAlbumImageTimer: NodeJS.Timeout | null = null;
let karutaAlbumImageSyncRunning = false;
const karutaAlbumImageAttempts = new Map<string, number>();

// Ruta pública (relativa al API) donde servimos la imagen cacheada de una
// página. La web le antepone su base de API.
function karutaAlbumPageImagePath(
  guildId: string,
  albumId: string,
  page: number,
): string {
  return `/public/guilds/${encodeURIComponent(guildId)}/karuta/albums/${encodeURIComponent(albumId)}/pages/${page}/image`;
}

// Descarga y guarda los bytes de una página. Es el paso que "blinda" la
// imagen: después, la URL original de Discord ya no importa.
async function cacheKarutaAlbumPageImage(
  guildId: string,
  albumId: string,
  page: number,
  url: string,
): Promise<boolean> {
  if (!url || url.startsWith("/")) {
    return false;
  }
  try {
    const image = await downloadDiscordImage(url, KARUTA_ALBUM_PAGE_MAX_BYTES);
    if (!image) {
      return false;
    }
    await saveKarutaAlbumPageImage({
      albumId,
      data: image.data,
      guildId,
      mimeType: image.mimeType,
      page,
    });
    return true;
  } catch (error) {
    console.warn("[karuta] no se pudo cachear la imagen de página", error);
    return false;
  }
}

// Reemplaza, en la respuesta, las URLs de las páginas ya cacheadas por la ruta
// propia del API (las de Discord pueden estar vencidas y no las usamos más).
function withCachedAlbumImageUrls(
  albums: Awaited<ReturnType<typeof listAllKarutaAlbums>>,
  cachedPages: Array<{ albumId: string; page: number }>,
) {
  const byAlbum = new Map<string, Set<number>>();
  for (const row of cachedPages) {
    const pages = byAlbum.get(row.albumId) ?? new Set<number>();
    pages.add(row.page);
    byAlbum.set(row.albumId, pages);
  }

  return albums.map((album) => {
    const cached = byAlbum.get(album.id);
    if (!cached || cached.size === 0) {
      return album;
    }
    const images = album.images.map((image) =>
      cached.has(image.page)
        ? {
            page: image.page,
            url: karutaAlbumPageImagePath(album.guildId, album.id, image.page),
          }
        : image,
    );
    for (const page of [...cached].sort((a, b) => a - b)) {
      if (!images.some((image) => image.page === page)) {
        images.push({
          page,
          url: karutaAlbumPageImagePath(album.guildId, album.id, page),
        });
      }
    }
    images.sort((a, b) => a.page - b.page);
    const firstPage = images[0];
    return {
      ...album,
      imageUrl: firstPage?.url ?? album.imageUrl,
      images,
    };
  });
}

// Recorre los álbumes y cachea las páginas que todavía no tenemos, re-firmando
// antes las URLs vencidas cuando hace falta.
async function refreshStaleKarutaAlbumImages(
  candidates?: Awaited<ReturnType<typeof listAllKarutaAlbums>>,
): Promise<void> {
  if (karutaAlbumImageSyncRunning) {
    return;
  }
  karutaAlbumImageSyncRunning = true;
  try {
    const albums = candidates ?? (await listAllKarutaAlbums(200));
    if (albums.length === 0) {
      return;
    }
    const cachedRows = await listCachedKarutaAlbumPages(
      albums.map((album) => album.id),
    );
    const cachedByAlbum = new Map<string, Set<number>>();
    for (const row of cachedRows) {
      const pages = cachedByAlbum.get(row.albumId) ?? new Set<number>();
      pages.add(row.page);
      cachedByAlbum.set(row.albumId, pages);
    }

    let budget = KARUTA_ALBUM_PAGE_CACHE_PER_PASS;
    const now = Date.now();

    for (const album of albums) {
      if (budget <= 0) {
        break;
      }
      const pages =
        album.images.length > 0
          ? album.images
          : album.imageUrl
            ? [{ page: 1, url: album.imageUrl }]
            : [];
      const cached = cachedByAlbum.get(album.id) ?? new Set<number>();
      const pending = pages.filter(
        (page) => !cached.has(page.page) && !page.url.startsWith("/"),
      );
      if (pending.length === 0) {
        continue;
      }
      const throttleKey = `${album.guildId}:${album.id}`;
      if (
        now - (karutaAlbumImageAttempts.get(throttleKey) ?? 0) <
        KARUTA_ALBUM_IMAGE_THROTTLE_MS
      ) {
        continue;
      }
      karutaAlbumImageAttempts.set(throttleKey, now);

      // 1) Re-firmamos las URLs vencidas (sirve incluso para firmas ya
      //    expiradas, mientras el adjunto siga existiendo en Discord).
      const stale = pending.filter((page) => !isDiscordCdnUrlFresh(page.url));
      const refreshed =
        stale.length > 0
          ? await refreshDiscordAttachmentUrls(stale.map((page) => page.url))
          : new Map<string, string>();

      // 2) Cacheamos cada página que tengamos con URL utilizable.
      let saved = 0;
      const unresolved: typeof pending = [];
      for (const page of pending) {
        if (budget <= 0) {
          break;
        }
        const fresh = refreshed.get(page.url);
        const url = fresh ?? page.url;
        if (!fresh && !isDiscordCdnUrlFresh(page.url)) {
          unresolved.push(page);
          continue;
        }
        if (
          await cacheKarutaAlbumPageImage(
            album.guildId,
            album.id,
            page.page,
            url,
          )
        ) {
          budget -= 1;
          saved += 1;
        }
      }

      // 3) Último recurso: releer el mensaje de Karuta para la página que
      //    muestra hoy (es la única que el mensaje puede devolvernos).
      const currentPage = unresolved.find(
        (page) => page.page === (album.page ?? 1),
      );
      if (budget > 0 && currentPage && album.channelId && album.messageId) {
        const urls = await fetchDiscordMessageImageUrls(
          album.channelId,
          album.messageId,
        );
        if (
          urls[0] &&
          (await cacheKarutaAlbumPageImage(
            album.guildId,
            album.id,
            currentPage.page,
            urls[0],
          ))
        ) {
          budget -= 1;
          saved += 1;
        }
      }

      if (saved > 0) {
        console.log(
          `[karuta] imágenes de álbum cacheadas: "${album.albumName ?? album.id}" (+${saved})`,
        );
      }
    }
  } catch (error) {
    console.error("[karuta] album image sync failed", error);
  } finally {
    karutaAlbumImageSyncRunning = false;
  }
}

function startKarutaAlbumImageSync(): void {
  if (karutaAlbumImageTimer) {
    return;
  }
  void refreshStaleKarutaAlbumImages();
  karutaAlbumImageTimer = setInterval(() => {
    void refreshStaleKarutaAlbumImages();
  }, KARUTA_ALBUM_IMAGE_SYNC_INTERVAL_MS);
}

// ── Publicación de eventos en Discord (Módulo X) ────────────────────
// Normaliza el bloque "discord" que manda la web a una config tipada.
function normalizeDiscordOptions(
  body: Record<string, unknown> | undefined,
): EventDiscordOptions | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const recurrenceRaw =
    typeof body.recurrence === "string" ? body.recurrence : "none";
  const recurrence: EventRecurrence = [
    "none",
    "daily",
    "weekly",
    "biweekly",
  ].includes(recurrenceRaw)
    ? (recurrenceRaw as EventRecurrence)
    : "none";
  return {
    createScheduledEvent: Boolean(body.createScheduledEvent),
    entityType: body.entityType === "external" ? "external" : "voice",
    location:
      typeof body.location === "string"
        ? body.location.trim() || undefined
        : undefined,
    publishChannelId:
      typeof body.publishChannelId === "string"
        ? body.publishChannelId.trim() || undefined
        : undefined,
    publishMessage: Boolean(body.publishMessage),
    recurrence,
    voiceChannelId:
      typeof body.voiceChannelId === "string"
        ? body.voiceChannelId.trim() || undefined
        : undefined,
  };
}

function validateDiscordOptions(options: EventDiscordOptions): string | null {
  if (options.createScheduledEvent) {
    if (options.entityType === "voice" && !options.voiceChannelId) {
      return "Para crear el evento en Discord elegí una sala de voz.";
    }
    if (options.entityType === "external" && !options.location) {
      return "Para crear el evento externo en Discord poné una ubicación.";
    }
  }
  if (options.publishMessage && !options.publishChannelId) {
    return "Elegí el canal donde publicar el aviso.";
  }
  return null;
}

// Sincroniza el evento hacia Discord y persiste los ids resultantes.
// Devuelve { event, discordError } para incluir en la respuesta.
async function syncAndStoreEventDiscord(input: {
  discordOpts: EventDiscordOptions;
  event: {
    description?: string;
    durationMinutes?: number;
    guildId: string;
    id: string;
    imageUrl?: string;
    paused?: boolean;
    signupDeadline?: Date;
    signups: AnnouncementSignup[];
    startsAt: Date;
    title: string;
    type?: string;
  };
}): Promise<{
  discordError?: string;
  event: Awaited<ReturnType<typeof setEventDiscordInfo>>;
}> {
  const { discordOpts, event } = input;
  const specs = await listRaidSpecs(event.guildId);
  const result = await syncEventToDiscord({
    description: event.description,
    durationMinutes: event.durationMinutes,
    eventId: event.id,
    guildId: event.guildId,
    imageUrl: event.imageUrl,
    options: discordOpts,
    paused: event.paused,
    signupDeadline: event.signupDeadline,
    signups: event.signups,
    specs,
    startsAt: event.startsAt,
    title: event.title,
    type: event.type,
  });

  const updated = await setEventDiscordInfo(event.guildId, event.id, {
    discordEventConfig: {
      createScheduledEvent: discordOpts.createScheduledEvent,
      entityType: discordOpts.entityType,
      location: discordOpts.location,
      publishMessage: discordOpts.publishMessage,
      recurrence:
        discordOpts.recurrence === "none" ? undefined : discordOpts.recurrence,
    },
    discordEventId: result.discordEventId ?? null,
    discordMessageIds: result.messageIds,
    publishChannelId: discordOpts.publishMessage
      ? (discordOpts.publishChannelId ?? null)
      : null,
    voiceChannelId:
      discordOpts.createScheduledEvent && discordOpts.entityType === "voice"
        ? (discordOpts.voiceChannelId ?? null)
        : null,
  });

  return { discordError: result.error, event: updated };
}

// Re-renderiza el aviso-embed de un evento publicado (roster al día + estado
// de inscripción: al cerrarse queda rojo y con los botones deshabilitados).
// Se usa al cambiar una inscripción y al pasar el cierre de inscripciones.
// Devuelve true si el aviso quedó al día (false = conviene reintentar).
async function refreshEventAnnouncement(
  guildId: string,
  eventId: string,
): Promise<boolean> {
  try {
    const event = await getEvent(guildId, eventId);
    if (!event || !event.publishChannelId) {
      return false;
    }
    const messageId = (event.discordMessageIds ?? [])[0];
    if (!messageId) {
      // Publicado sin mensaje-aviso (p. ej. solo scheduled event): nada que
      // refrescar.
      return true;
    }
    const specs = await listRaidSpecs(guildId);
    const embeds = buildEventAnnouncementEmbeds({
      description: event.description,
      discordEventId: event.discordEventId,
      durationMinutes: event.durationMinutes,
      eventId: event.id,
      guildId,
      imageUrl: event.imageUrl,
      location:
        event.discordEventConfig?.entityType === "external"
          ? event.discordEventConfig.location
          : undefined,
      paused: event.paused,
      recurrence: (event.discordEventConfig?.recurrence ??
        "none") as EventRecurrence,
      signupDeadline: event.signupDeadline,
      signups: event.signups,
      specs,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
    });
    const signupsClosed = event.signupDeadline
      ? event.signupDeadline.getTime() <= Date.now()
      : false;
    return await updateEventAnnouncement({
      channelId: event.publishChannelId,
      components: buildEventSignupActionRows(event.id, {
        disableSignup: event.paused || signupsClosed,
      }),
      embeds,
      messageId,
    });
  } catch (error) {
    console.warn(
      `[eventos] no se pudo refrescar el aviso del evento ${eventId} en Discord`,
      error,
    );
    return false;
  }
}

// Horas de recordatorio válidas (p. ej. 48, 24, 2). Normaliza: números
// finitos entre 1 y 720 (30 días), sin duplicados y ordenados.
function normalizeReminderHours(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hours = new Set<number>();
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      continue;
    }
    if (item >= 1 && item <= 720) {
      hours.add(Math.round(item));
    }
  }
  return Array.from(hours).sort((a, b) => a - b);
}

// Días de recurrencia válidos (1 a 365). null = sin recurrencia.
function normalizeRecurrenceDays(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const days = Math.round(value);
  return days >= 1 && days <= 365 ? days : null;
}

export function buildApp() {
  const app = Fastify({
    logger: true,
    // Permite subir imágenes como data URL (hasta ~5MB de body).
    bodyLimit: 5 * 1024 * 1024,
  });

  const allowedOrigins = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isSecureCookie = env.NODE_ENV === "production";
  const cookieSameSite = env.COOKIE_SAME_SITE;

  void app.register(cors, {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"), false);
    },
  });

  function resolveCallbackUrl(request: FastifyRequest): string {
    const referer = request.headers.referer;
    const originHeader = request.headers.origin;
    const candidateSource = (referer ?? originHeader) as string | undefined;

    if (candidateSource) {
      try {
        const candidateUrl = new URL(candidateSource);
        const candidateOrigin = candidateUrl.origin;
        if (allowedOrigins.includes(candidateOrigin)) {
          return `${candidateOrigin}/api/auth/discord/callback`;
        }
      } catch {
        // URL inválida; ignorar y usar el valor por defecto.
      }
    }

    return env.DISCORD_REDIRECT_URI;
  }

  async function getSessionFromRequest(cookieHeader: string | undefined) {
    const cookies = parseCookieHeader(cookieHeader);
    const signedSessionId = cookies[getSessionCookieName()];
    const sessionId = verifySignedSessionId(
      signedSessionId,
      env.SESSION_SECRET,
    );

    return getDiscordSession(sessionId ?? undefined);
  }

  async function requireSession(request: FastifyRequest) {
    return getSessionFromRequest(request.headers.cookie);
  }

  function canManageGuild(
    session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>,
    guildId: string,
  ): boolean {
    // Exclusividad: solo se administra el servidor permitido (Bonafide).
    if (env.BONAFIDE_GUILD_ID && guildId !== env.BONAFIDE_GUILD_ID) {
      return false;
    }

    // Solo el dueño de la guild puede administrar, aunque otro miembro
    // tenga permiso de Manage Server en Discord.
    return session.guilds.some(
      (guild) => guild.id === guildId && guild.owner === true,
    );
  }

  function isGuildMember(
    session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>,
    guildId: string,
  ): boolean {
    // Exclusividad: solo el servidor permitido (Bonafide).
    if (env.BONAFIDE_GUILD_ID && guildId !== env.BONAFIDE_GUILD_ID) {
      return false;
    }
    return session.guilds.some((guild) => guild.id === guildId);
  }

  function isGuildOwner(
    session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>,
    guildId: string,
  ): boolean {
    return session.guilds.some(
      (guild) => guild.id === guildId && guild.owner === true,
    );
  }

  async function logAdminAction(
    session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>,
    guildId: string,
    action: string,
    options: {
      details?: string;
      targetId?: string;
      targetType?: string;
    } = {},
  ): Promise<void> {
    const user = (session.user ?? {}) as {
      global_name?: string | null;
      id?: string;
      username?: string | null;
    };

    await createAuditLogEntry({
      action,
      actorName: user.global_name ?? user.username ?? undefined,
      actorUserId: user.id,
      details: options.details,
      guildId,
      targetId: options.targetId,
      targetType: options.targetType,
    });
  }

  function getBotAuthToken(request: FastifyRequest): string | null {
    const rawHeader = request.headers["x-bot-token"];
    if (!rawHeader) {
      return null;
    }

    if (Array.isArray(rawHeader)) {
      return rawHeader[0] ?? null;
    }

    return rawHeader;
  }

  function isAuthorizedBotRequest(request: FastifyRequest): boolean {
    if (!env.BOT_API_TOKEN) {
      return false;
    }

    const token = getBotAuthToken(request);
    if (!token) {
      return false;
    }

    return token === env.BOT_API_TOKEN;
  }

  // ── Permisos de staff (rol de Discord → módulos del panel Admin) ──
  const memberRolesCache = new Map<
    string,
    { at: number; roles: string[] | null }
  >();
  const MEMBER_ROLES_TTL_MS = 60_000;

  // Roles de un miembro en la guild (null si no se pudieron resolver).
  // Se cachean en memoria 60s para no golpear la API de Discord en cada
  // request del panel Admin.
  async function fetchMemberRoles(
    guildId: string,
    userId: string,
  ): Promise<string[] | null> {
    const key = `${guildId}:${userId}`;
    const cached = memberRolesCache.get(key);
    if (cached && Date.now() - cached.at < MEMBER_ROLES_TTL_MS) {
      return cached.roles;
    }
    if (!env.DISCORD_BOT_TOKEN) {
      return null;
    }
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    ).catch(() => null);
    const roles = response?.ok
      ? (((await response.json()) as { roles?: string[] }).roles ?? [])
      : null;
    memberRolesCache.set(key, { at: Date.now(), roles });
    return roles;
  }

  // Un staff puede manejar un módulo del panel Admin si es owner o si
  // alguno de sus roles tiene ese módulo en adminRoleModules.
  async function canManageModule(
    session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>,
    guildId: string,
    module: string,
  ): Promise<boolean> {
    if (canManageGuild(session, guildId)) {
      return true;
    }
    if (env.BONAFIDE_GUILD_ID && guildId !== env.BONAFIDE_GUILD_ID) {
      return false;
    }
    const roles = await fetchMemberRoles(guildId, session.user.id);
    if (!roles) {
      return false;
    }
    const config = await getGuildConfig(guildId);
    return (config.adminRoleModules ?? []).some(
      (rule) => roles.includes(rule.roleId) && rule.modules.includes(module),
    );
  }

  // ¿Tiene acceso a algún módulo del panel Admin? Se usa para recursos
  // compartidos (roles, canales, emojis) que usan varias secciones.
  async function hasAnyStaffAccess(
    session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>,
    guildId: string,
  ): Promise<boolean> {
    if (canManageGuild(session, guildId)) {
      return true;
    }
    if (env.BONAFIDE_GUILD_ID && guildId !== env.BONAFIDE_GUILD_ID) {
      return false;
    }
    const roles = await fetchMemberRoles(guildId, session.user.id);
    if (!roles) {
      return false;
    }
    const config = await getGuildConfig(guildId);
    return (config.adminRoleModules ?? []).some(
      (rule) => roles.includes(rule.roleId) && rule.modules.length > 0,
    );
  }

  app.get("/health", async () => ({
    ok: true,
    service: "api",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  }));

  app.get("/", async () => ({
    name: "Bonafide API",
    version: "0.1.0",
    routes: [
      "/health",
      "/auth/discord/start",
      "/auth/discord/callback",
      "/me",
      "/guilds",
      "/guilds/:guildId/widget",
      "/guilds/:guildId/config",
      "/guilds/:guildId/reminders",
      "/guilds/:guildId/reminders/:reminderId",
      "/internal/guilds/:guildId/config",
    ],
  }));

  app.get("/internal/guilds/:guildId/config", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const config = await getGuildConfig(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      config,
    };
  });

  app.put("/internal/guilds/:guildId/config", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const body = request.body as { config?: Record<string, unknown> };
    if (!body?.config || typeof body.config !== "object") {
      return reply.code(400).send({
        ok: false,
        error: "Missing config object",
      });
    }

    // El bot no conoce todos los campos que administra el Hub (módulos
    // habilitados, destinatarios de sugerencias, permisos de staff, logs de
    // raid, etc.). Un reemplazo total aquí borraría esos ajustes cada vez que
    // el bot guarda su config. Por eso solo se fusionan los campos propios
    // del bot sobre la configuración actual, preservando el resto.
    const BOT_CONFIG_FIELDS = [
      "bannedVoiceRoleIds",
      "dailyMessagesChannelId",
      "dailyMessagesEnabled",
      "dailyMessagesMaxMinutes",
      "dailyMessagesMinMinutes",
      "defaultRoleId",
      "dynamicVoiceCreateChannelId",
      "memberLogChannelId",
      "musicEnabled",
      "musicRoleIds",
      "temporaryVoiceChannelIds",
      "xpSyncRequested",
    ] as const;

    const botConfig: Record<string, unknown> = {};
    for (const key of BOT_CONFIG_FIELDS) {
      const value = body.config[key];
      if (value !== undefined) {
        botConfig[key] = value;
      }
    }

    const config = await upsertGuildConfig(
      params.guildId,
      botConfig as GuildConfig,
    );

    return {
      ok: true,
      guildId: params.guildId,
      config,
    };
  });

  app.get(
    "/internal/guilds/:guildId/daily-messages",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }

      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }

      // Solo las habilitadas: el loro no debe usar frases pausadas.
      const messages = await listEnabledDailyMessages(params.guildId);

      return {
        ok: true,
        guildId: params.guildId,
        messages,
      };
    },
  );

  app.get("/internal/guilds/:guildId/xp-config", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const xpConfig = await getXpConfig(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      xpConfig,
    };
  });

  app.post("/internal/guilds/:guildId/xp/add", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const body = request.body as {
      amount?: number;
      source?: "message" | "voice";
      userId?: string;
    };
    const userId = body.userId?.trim();
    const amount = body.amount;
    const source = body.source === "voice" ? "voice" : "message";

    if (!userId) {
      return reply.code(400).send({ ok: false, error: "Missing userId" });
    }

    if (!Number.isInteger(amount) || (amount as number) < 0) {
      return reply.code(400).send({
        ok: false,
        error: "amount debe ser un entero no negativo",
      });
    }

    const result = await addXp({
      amount: amount as number,
      guildId: params.guildId,
      source,
      userId,
    });

    return {
      ok: true,
      guildId: params.guildId,
      ...result,
    };
  });

  app.post("/internal/guilds/:guildId/xp/level", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const body = request.body as {
      action?: string;
      level?: number;
      userId?: string;
    };
    const userId = body.userId?.trim();
    if (!userId) {
      return reply.code(400).send({ ok: false, error: "Missing userId" });
    }

    const action =
      body.action === "add" ||
      body.action === "remove" ||
      body.action === "set" ||
      body.action === "reset"
        ? body.action
        : "set";

    if (action === "reset") {
      const profile = await resetXpProfile(params.guildId, userId);
      return { ok: true, guildId: params.guildId, profile };
    }

    const requestedLevel = Math.max(1, Math.floor(body.level ?? 0));
    const current = await getXpProfile(params.guildId, userId);
    let targetLevel = requestedLevel;

    if (action === "add") {
      targetLevel = (current?.level ?? 0) + requestedLevel;
    } else if (action === "remove") {
      targetLevel = Math.max(0, (current?.level ?? 0) - requestedLevel);
    }

    const profile = await setXpLevel(params.guildId, userId, targetLevel);

    return {
      ok: true,
      guildId: params.guildId,
      profile,
    };
  });

  app.get("/internal/guilds/:guildId/xp/profiles", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const profiles = await listXpProfiles(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      profiles: profiles.map((profile) => ({
        messageCount: profile.messageCount,
        userId: profile.userId,
        level: profile.level,
        voiceMinutes: profile.voiceMinutes,
        xp: profile.xp,
      })),
    };
  });

  app.get("/auth/discord/start", async (request, reply) => {
    const callbackUrl = resolveCallbackUrl(request);
    const state = await createOAuthState({ callbackUrl });
    const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");

    authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "identify guilds");
    authorizeUrl.searchParams.set("state", state);

    reply.header(
      "Set-Cookie",
      buildCookieHeader(getStateCookieName(), state, {
        httpOnly: true,
        maxAgeSeconds: 600,
        path: "/",
        sameSite: cookieSameSite,
        secure: isSecureCookie,
      }),
    );

    return reply.redirect(authorizeUrl.toString());
  });

  app.get("/auth/discord/callback", async (request, reply) => {
    const query = request.query as {
      code?: string;
      error?: string;
      error_description?: string;
      state?: string;
    };

    if (query.error) {
      return reply.code(400).send({
        ok: false,
        error: query.error,
        error_description: query.error_description ?? null,
      });
    }

    if (!query.code || !query.state) {
      return reply.code(400).send({
        ok: false,
        error: "Missing OAuth code/state",
      });
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const stateCookie = cookies[getStateCookieName()];
    const consumedState = await consumeOAuthState(query.state);
    if (stateCookie !== query.state || !consumedState.valid) {
      return reply.code(400).send({
        ok: false,
        error: "Invalid OAuth state",
      });
    }

    const tokenBody = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      code: query.code,
      grant_type: "authorization_code",
      redirect_uri: consumedState.callbackUrl ?? env.DISCORD_REDIRECT_URI,
    });

    const tokenResponse = await fetchWithDiscordRetry(
      "https://discord.com/api/oauth2/token",
      {
        body: tokenBody,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    );

    if (!tokenResponse.ok) {
      const raw = await tokenResponse.text().catch(() => "");
      let errorBody: unknown = null;
      try {
        errorBody = raw ? JSON.parse(raw) : null;
      } catch {
        errorBody = raw.slice(0, 300);
      }

      const message =
        tokenResponse.status === 429
          ? "Demasiados intentos de login (Discord está limitando). Esperá unos segundos y volvé a intentar."
          : "Failed to exchange Discord code";

      return reply.code(400).send({
        ok: false,
        error: message,
        details: {
          status: tokenResponse.status,
          body: errorBody,
        },
      });
    }

    const token = (await tokenResponse.json()) as DiscordTokenResponse;
    const [user, guilds] = await Promise.all([
      fetchDiscordJson<{
        avatar: string | null;
        discriminator: string;
        global_name: string | null;
        id: string;
        username: string;
      }>("/users/@me", token.access_token),
      fetchDiscordJson<
        Array<{
          features: string[];
          icon: string | null;
          id: string;
          name: string;
          owner: boolean;
          permissions: string;
        }>
      >("/users/@me/guilds", token.access_token),
    ]);

    const session = await createDiscordSession({
      accessTokenExpiresInSeconds: token.expires_in,
      guilds,
      user,
    });

    reply.header("Set-Cookie", [
      buildClearCookie(getStateCookieName()),
      buildCookieHeader(
        getSessionCookieName(),
        buildSessionCookie(session.id, env.SESSION_SECRET),
        {
          httpOnly: true,
          maxAgeSeconds: token.expires_in,
          path: "/",
          sameSite: cookieSameSite,
          secure: isSecureCookie,
        },
      ),
    ]);

    return reply.redirect(env.FRONTEND_APP_URL);
  });

  app.get("/me", async (request, reply) => {
    const session = await getSessionFromRequest(request.headers.cookie);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    return {
      ok: true,
      user: session.user,
      expiresAt: session.expiresAt,
    };
  });

  app.get("/guilds", async (request, reply) => {
    const session = await getSessionFromRequest(request.headers.cookie);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    // Exclusividad: si BONAFIDE_GUILD_ID está configurado, la web solo
    // muestra ese servidor, y para CUALQUIER miembro (no solo quienes lo
    // administran). El panel de admin sigue siendo solo del dueño.
    const guilds = env.BONAFIDE_GUILD_ID
      ? session.guilds.filter((guild) => guild.id === env.BONAFIDE_GUILD_ID)
      : getManageGuildFilter(session.guilds);

    return {
      ok: true,
      guilds,
    };
  });

  app.get("/guilds/:guildId/widget", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const previewResponse = env.DISCORD_BOT_TOKEN
      ? await fetch(
          `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}/preview`,
          {
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            },
          },
        ).catch(() => null)
      : null;

    const preview = previewResponse?.ok
      ? ((await previewResponse.json()) as {
          approximate_member_count?: number;
          approximate_presence_count?: number;
        })
      : null;
    const memberCount = preview?.approximate_member_count ?? null;
    const previewPresenceCount = preview?.approximate_presence_count ?? null;

    const guildResponse = env.DISCORD_BOT_TOKEN
      ? await fetch(
          `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}`,
          {
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            },
          },
        ).catch(() => null)
      : null;
    const guildData = guildResponse?.ok
      ? ((await guildResponse.json()) as {
          premium_subscription_count?: number;
        })
      : null;
    const boostCount = guildData?.premium_subscription_count ?? null;

    const widgetResponse = await fetch(
      `https://discord.com/api/guilds/${params.guildId}/widget.json`,
    );

    if (!widgetResponse.ok) {
      return reply.code(200).send({
        ok: true,
        guildId: params.guildId,
        available: false,
        boostCount,
        memberCount,
        presenceCount: previewPresenceCount,
        inviteUrl: null,
      });
    }

    const widget = (await widgetResponse.json()) as DiscordGuildWidgetResponse;

    return {
      ok: true,
      guildId: params.guildId,
      available: true,
      boostCount,
      memberCount,
      presenceCount: previewPresenceCount ?? widget.presence_count ?? null,
      inviteUrl: widget.instant_invite ?? null,
      name: widget.name,
    };
  });

  app.get("/guilds/:guildId/boosters", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const boosters = await fetchGuildBoosters(params.guildId).catch(() => []);

    return {
      ok: true,
      guildId: params.guildId,
      boosters,
    };
  });

  app.get("/guilds/:guildId/channels", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await hasAnyStaffAccess(session, params.guildId))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const channelsResponse = await fetchWithDiscordRetry(
      `https://discord.com/api/v10/guilds/${params.guildId}/channels`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );

    if (!channelsResponse.ok) {
      return reply.code(502).send({
        ok: false,
        error: `Discord API returned ${channelsResponse.status}`,
      });
    }

    const channels = (await channelsResponse.json()) as Array<{
      id: string;
      name: string;
      type: number;
    }>;

    const voiceChannels = channels
      .filter((channel) => channel.type === 2)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    const textChannels = channels
      .filter((channel) => channel.type === 0 || channel.type === 5)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      ok: true,
      guildId: params.guildId,
      textChannels,
      voiceChannels,
    };
  });

  // Lista de miembros (id + nombre) para pickers del panel Admin.
  app.get("/guilds/:guildId/members", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await hasAnyStaffAccess(session, params.guildId))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const membersResponse = await fetchWithDiscordRetry(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}/members?limit=1000`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );
    if (!membersResponse.ok) {
      return reply.code(502).send({
        ok: false,
        error: `Discord API returned ${membersResponse.status}`,
      });
    }

    const members = (await membersResponse.json()) as Array<{
      nick?: string | null;
      user?: {
        global_name?: string | null;
        id?: string;
        username?: string;
      } | null;
    }>;

    const list = members
      .map((member) => {
        const user = member.user ?? {};
        const id = user.id;
        if (!id) {
          return null;
        }
        return {
          displayName: member.nick ?? user.global_name ?? user.username ?? "—",
          id,
          username: user.username ?? "",
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    return {
      ok: true,
      guildId: params.guildId,
      members: list,
    };
  });

  app.get("/guilds/:guildId/emojis", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await hasAnyStaffAccess(session, params.guildId))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const emojisResponse = await fetchWithDiscordRetry(
      `https://discord.com/api/v10/guilds/${params.guildId}/emojis`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );

    if (!emojisResponse.ok) {
      return reply.code(502).send({
        ok: false,
        error: `Discord API returned ${emojisResponse.status}`,
      });
    }

    const emojis = (await emojisResponse.json()) as Array<{
      animated?: boolean;
      id: string;
      name: string;
    }>;

    return {
      ok: true,
      guildId: params.guildId,
      emojis: emojis
        .map((emoji) => ({
          animated: Boolean(emoji.animated),
          id: emoji.id,
          name: emoji.name,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  });

  app.get("/guilds/:guildId/roles", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await hasAnyStaffAccess(session, params.guildId))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const rolesResponse = await fetchWithDiscordRetry(
      `https://discord.com/api/v10/guilds/${params.guildId}/roles`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );

    if (!rolesResponse.ok) {
      return reply.code(502).send({
        ok: false,
        error: `Discord API returned ${rolesResponse.status}`,
      });
    }

    const roles = (await rolesResponse.json()) as Array<{
      color: number;
      id: string;
      managed: boolean;
      name: string;
      position: number;
    }>;

    const normalRoles = roles
      .filter((role) => role.id !== params.guildId)
      .map((role) => ({
        color: role.color,
        id: role.id,
        managed: role.managed,
        name: role.name,
        position: role.position,
      }))
      .sort((left, right) => right.position - left.position);

    return {
      ok: true,
      guildId: params.guildId,
      roles: normalRoles,
    };
  });

  // Perfil de un miembro de la guild: datos públicos del user (avatar,
  // banner, acento) + membrecía (nick, roles, booster, fecha de ingreso).
  app.get("/guilds/:guildId/members/:userId", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as {
      guildId?: string;
      userId?: string;
    };
    if (!params.guildId || !params.userId) {
      return reply.code(400).send({ ok: false, error: "Missing params" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const [memberResponse, rolesResponse] = await Promise.all([
      fetchWithDiscordRetry(
        `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}/members/${encodeURIComponent(params.userId)}`,
        {
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
        },
      ),
      fetchWithDiscordRetry(
        `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}/roles`,
        {
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
        },
      ),
    ]);

    if (!memberResponse.ok) {
      return reply.code(404).send({ ok: false, error: "Member not found" });
    }

    const roles = rolesResponse.ok
      ? ((await rolesResponse.json()) as Array<{
          color: number;
          id: string;
          name: string;
          position: number;
        }>)
      : [];

    const member = (await memberResponse.json()) as {
      avatar?: string | null;
      joined_at?: string | null;
      nick?: string | null;
      premium_since?: string | null;
      roles?: string[];
      user?: {
        accent_color?: number | null;
        avatar?: string | null;
        banner?: string | null;
        global_name?: string | null;
        id?: string;
        username?: string;
      } | null;
    };

    const user = member.user ?? {};
    const userId = user.id ?? params.userId;
    const avatarUrl = user.avatar ? buildAvatarUrl(userId, user.avatar) : null;
    const serverAvatarUrl = member.avatar
      ? buildServerAvatarUrl(params.guildId, userId, member.avatar)
      : null;
    const bannerUrl = user.banner
      ? buildUserBannerUrl(userId, user.banner)
      : null;
    const accentColor =
      typeof user.accent_color === "number" ? user.accent_color : null;

    const memberRoleIds = member.roles ?? [];
    const memberRoles = roles
      .filter(
        (role) => memberRoleIds.includes(role.id) && role.id !== params.guildId,
      )
      .sort((left, right) => right.position - left.position)
      .map((role) => ({
        color: role.color,
        id: role.id,
        name: role.name,
      }));

    return {
      ok: true,
      guildId: params.guildId,
      profile: {
        accentColor,
        avatarUrl,
        bannerUrl,
        displayName: member.nick ?? user.global_name ?? user.username ?? "—",
        globalName: user.global_name ?? null,
        isBooster: Boolean(member.premium_since),
        joinedAt: member.joined_at ?? null,
        roles: memberRoles,
        serverAvatarUrl,
        userId,
        username: user.username ?? "—",
      },
    };
  });

  app.get("/guilds/:guildId/xp-config", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const xpConfig = await getXpConfig(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      xpConfig,
    };
  });

  app.patch("/guilds/:guildId/xp-config", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "xp"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = request.body as Partial<XpConfig>;
    const xpConfig = await upsertXpConfig({
      guildId: params.guildId,
      cooldownSeconds: body.cooldownSeconds,
      levelBaseXp: body.levelBaseXp,
      levelRoles: body.levelRoles as XpRoleRule[] | undefined,
      maxLevel: body.maxLevel,
      messageXp: body.messageXp,
      roleMultipliers: body.roleMultipliers,
      roleStacking: body.roleStacking,
      voiceXpPerMinute: body.voiceXpPerMinute,
    });

    await logAdminAction(session, params.guildId, "update:xp-config", {
      details: "Se guardó la configuración de XP.",
    });

    return {
      ok: true,
      guildId: params.guildId,
      xpConfig,
    };
  });

  app.get("/guilds/:guildId/xp/leaderboard", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const leaderboard = await getLeaderboard(params.guildId);

    const memberInfo = await fetchGuildMembersForLeaderboard(
      params.guildId,
    ).catch(() => new Map<string, LeaderboardUserInfo>());

    const enrichedLeaderboard = leaderboard.map((entry) => {
      const info = memberInfo.get(entry.userId);

      return {
        ...entry,
        avatarUrl: info?.avatarUrl ?? null,
        isBooster: info?.isBooster ?? false,
        nickname: info?.nickname ?? null,
        username: info?.username ?? null,
      };
    });

    return {
      ok: true,
      guildId: params.guildId,
      leaderboard: enrichedLeaderboard,
    };
  });

  // Leaderboard público para la landing (solo la guild de Bonafide).
  // Devuelve top 30 con nombre, avatar y si es booster, sin sesión.
  app.get("/public/leaderboard", async (_request, reply) => {
    const guildId = env.BONAFIDE_GUILD_ID;
    if (!guildId) {
      return { ok: true, leaderboard: [] };
    }

    const leaderboard = await getLeaderboard(guildId);
    const memberInfo = await fetchGuildMembersForLeaderboard(guildId).catch(
      () => new Map<string, LeaderboardUserInfo>(),
    );

    const preview = leaderboard.slice(0, 30).map((entry) => {
      const info = memberInfo.get(entry.userId);
      return {
        avatarUrl: info?.avatarUrl ?? null,
        isBooster: info?.isBooster ?? false,
        nickname: info?.nickname ?? null,
        username: info?.username ?? null,
      };
    });

    return { ok: true, leaderboard: preview };
  });

  app.get("/guilds/:guildId/xp/export", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "xp"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const profiles = await listXpProfiles(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: profiles.map((profile) => ({
        messageCount: profile.messageCount,
        userId: profile.userId,
        voiceMinutes: profile.voiceMinutes,
        xp: profile.xp,
      })),
    };
  });

  app.post("/guilds/:guildId/xp/import", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "xp"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as {
      entries?: XpImportEntry[];
    };
    const entries = Array.isArray(body.entries) ? body.entries : [];

    if (entries.length === 0) {
      return reply.code(400).send({
        ok: false,
        error: "No se encontraron entradas de XP para importar",
      });
    }

    const result = await importXpEntries(params.guildId, entries);

    await logAdminAction(session, params.guildId, "xp:import", {
      details: `Importación de XP (${entries.length} perfil/es).`,
    });

    return {
      ok: true,
      guildId: params.guildId,
      ...result,
    };
  });

  app.post("/guilds/:guildId/xp/reset-all", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "xp"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const result = await resetAllXp(params.guildId);

    await logAdminAction(session, params.guildId, "xp:reset-all", {
      details: `Reset total de XP (${result.reset} usuario/s).`,
    });

    return {
      ok: true,
      guildId: params.guildId,
      ...result,
    };
  });

  app.post("/guilds/:guildId/xp/sync", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "xp"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    await upsertGuildConfig(params.guildId, { xpSyncRequested: true });

    await logAdminAction(session, params.guildId, "xp:sync", {
      details: "Re-sincronización de roles por nivel encolada.",
    });

    return {
      ok: true,
      guildId: params.guildId,
    };
  });

  app.get("/guilds/:guildId/daily-messages", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const messages = await listDailyMessages(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      messages,
    };
  });

  app.post("/guilds/:guildId/daily-messages", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "daily"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as { content?: string };
    const content = body.content?.trim();
    if (!content) {
      return reply.code(400).send({
        ok: false,
        error: "La frase no puede estar vacía",
      });
    }

    const message = await createDailyMessage({
      content,
      guildId: params.guildId,
    });

    await logAdminAction(session, params.guildId, "daily-message:create", {
      details: `Frase del loro creada: "${content.slice(0, 60)}"`,
      targetType: "daily-message",
      targetId: message.id,
    });

    return {
      ok: true,
      guildId: params.guildId,
      message,
    };
  });

  app.patch(
    "/guilds/:guildId/daily-messages/:messageId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        guildId?: string;
        messageId?: string;
      };
      if (!params.guildId || !params.messageId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!canManageGuild(session, params.guildId)) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const body = (request.body ?? {}) as {
        content?: string;
        enabled?: boolean;
      };
      const content = body.content?.trim();
      if (content === "") {
        return reply.code(400).send({
          ok: false,
          error: "La frase no puede estar vacía",
        });
      }

      const message = await updateDailyMessage({
        ...(content ? { content } : {}),
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        guildId: params.guildId,
        id: params.messageId,
      });

      if (!message) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      await logAdminAction(session, params.guildId, "daily-message:update", {
        details: `Frase del loro actualizada${message.content ? `: "${message.content.slice(0, 60)}"` : ""}.`,
        targetType: "daily-message",
        targetId: message.id,
      });

      return {
        ok: true,
        guildId: params.guildId,
        message,
      };
    },
  );

  app.delete(
    "/guilds/:guildId/daily-messages/:messageId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        guildId?: string;
        messageId?: string;
      };
      if (!params.guildId || !params.messageId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "daily"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteDailyMessage(
        params.guildId,
        params.messageId,
      );

      await logAdminAction(session, params.guildId, "daily-message:delete", {
        details: "Frase del loro eliminada.",
        targetType: "daily-message",
        targetId: params.messageId,
      });

      return {
        ok: true,
        guildId: params.guildId,
        deleted,
      };
    },
  );

  app.post("/guilds/:guildId/raid-logs", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "raids"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as { url?: string };
    const code = extractReportCode(body.url ?? "");
    if (!code) {
      return reply.code(400).send({
        ok: false,
        error:
          "El link no parece ser de Warcraft Logs (falta el código del report)",
      });
    }

    const rawUrl = body.url?.trim() ?? "";
    const reportUrl = /^https?:\/\//.test(rawUrl)
      ? rawUrl
      : `https://www.warcraftlogs.com/reports/${code}`;

    const created = await createRaidLog({
      guildId: params.guildId,
      reportCode: code,
      reportUrl,
    });

    const result = await refreshRaidLog(created.id);
    let posted = false;
    if (result.changed && result.log) {
      const config = await getGuildConfig(params.guildId);
      const token = env.DISCORD_BOT_TOKEN;
      if (config.logsChannelId && token) {
        const chunks = splitForDiscord(buildRaidLogMessage(result.log));
        const ids = await postMessages(token, config.logsChannelId, chunks);
        if (ids.length > 0) {
          await markRaidLogPosted(created.id);
          posted = true;
        }
      }
    }

    await logAdminAction(session, params.guildId, "raid-log:create", {
      details: `Log de raid agregado: ${code}${posted ? " (publicado en Discord)" : ""}`,
      targetType: "raid-log",
      targetId: created.id,
    });

    return {
      ok: true,
      guildId: params.guildId,
      log: result.log ?? created,
      error: result.error,
      posted,
    };
  });

  app.get("/guilds/:guildId/raid-logs", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const logs = await listRaidLogs(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      logs,
    };
  });

  // Logs ocultos: para restaurarlos o borrarlos definitivamente (staff).
  app.get("/guilds/:guildId/raid-logs/hidden", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "raids"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const logs = await listHiddenRaidLogs(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      logs,
    };
  });

  // DELETE ahora OCULTA el log (soft-delete): desaparece de la lista y el
  // watcher no lo vuelve a crear. Para borrarlo para siempre existe
  // DELETE /raid-logs/:logId/permanent.
  app.delete("/guilds/:guildId/raid-logs/:logId", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as {
      guildId?: string;
      logId?: string;
    };
    if (!params.guildId || !params.logId) {
      return reply.code(400).send({ ok: false, error: "Missing params" });
    }

    if (!(await canManageModule(session, params.guildId, "raids"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const hidden = await hideRaidLog(params.guildId, params.logId);

    await logAdminAction(session, params.guildId, "raid-log:hide", {
      details: "Log de raid ocultado (no se vuelve a capturar).",
      targetType: "raid-log",
      targetId: params.logId,
    });

    return {
      ok: true,
      guildId: params.guildId,
      hidden,
    };
  });

  // Restaurar un log oculto para que vuelva a aparecer.
  app.post(
    "/guilds/:guildId/raid-logs/:logId/restore",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        guildId?: string;
        logId?: string;
      };
      if (!params.guildId || !params.logId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "raids"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const shown = await showRaidLog(params.guildId, params.logId);

      await logAdminAction(session, params.guildId, "raid-log:restore", {
        details: "Log de raid restaurado.",
        targetType: "raid-log",
        targetId: params.logId,
      });

      return {
        ok: true,
        guildId: params.guildId,
        shown,
      };
    },
  );

  // Borrar definitivamente (no se puede recuperar; el watcher lo vuelve a
  // crear si el raid sigue en Warcraft Logs).
  app.delete(
    "/guilds/:guildId/raid-logs/:logId/permanent",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        guildId?: string;
        logId?: string;
      };
      if (!params.guildId || !params.logId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "raids"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteRaidLog(params.guildId, params.logId);

      await logAdminAction(session, params.guildId, "raid-log:delete", {
        details: "Log de raid borrado definitivamente.",
        targetType: "raid-log",
        targetId: params.logId,
      });

      return {
        ok: true,
        guildId: params.guildId,
        deleted,
      };
    },
  );

  // ── Módulo X: eventos estilo Raid Helper ──────────────────────────
  app.get("/guilds/:guildId/events", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const events = await listEvents(params.guildId);
    return { ok: true, guildId: params.guildId, events };
  });

  app.post("/guilds/:guildId/events", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "eventos"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as {
      description?: string;
      discord?: {
        createScheduledEvent?: boolean;
        entityType?: string;
        location?: string;
        publishChannelId?: string;
        publishMessage?: boolean;
        recurrence?: string;
        voiceChannelId?: string;
      };
      durationMinutes?: number;
      discordCleanupOnComplete?: boolean;
      imageUrl?: string;
      paused?: boolean;
      recurrenceEnabled?: boolean;
      recurrenceEveryDays?: number;
      recurrencePublishDaysBefore?: number;
      reminderHours?: number[];
      requiredRoleId?: string;
      signupDeadline?: string;
      startsAt?: string;
      title?: string;
      type?: string;
    };

    const title = body.title?.trim();
    const startsAt = body.startsAt?.trim();
    if (!title || !startsAt || Number.isNaN(new Date(startsAt).getTime())) {
      return reply.code(400).send({
        ok: false,
        error: "Faltan título o fecha/hora válida",
      });
    }
    if (
      body.signupDeadline &&
      Number.isNaN(new Date(body.signupDeadline).getTime())
    ) {
      return reply.code(400).send({
        ok: false,
        error: "Fecha de cierre de inscripciones inválida",
      });
    }

    const type = EVENT_TYPES.includes(body.type as never) ? body.type! : "raid";
    const user = session.user as {
      global_name?: string | null;
      id?: string;
      username?: string | null;
    };

    const event = await createEvent({
      createdByUserId: user.id,
      createdByUsername: user.global_name ?? user.username ?? undefined,
      description: body.description?.trim() || undefined,
      discordCleanupOnComplete: body.discordCleanupOnComplete === true,
      durationMinutes: body.durationMinutes,
      guildId: params.guildId,
      imageUrl: body.imageUrl?.trim() || undefined,
      paused: body.paused === true,
      recurrenceEnabled: body.recurrenceEnabled === true,
      recurrenceEveryDays: normalizeRecurrenceDays(body.recurrenceEveryDays),
      recurrencePublishDaysBefore: normalizeRecurrenceDays(
        body.recurrencePublishDaysBefore,
      ),
      reminderHours: normalizeReminderHours(body.reminderHours),
      requiredRoleId: body.requiredRoleId?.trim() || null,
      signupDeadline: body.signupDeadline?.trim() || undefined,
      startsAt,
      title,
      type,
    });

    // Publicación en Discord (scheduled event y/o aviso en canal).
    const discordOpts = normalizeDiscordOptions(body.discord);
    let discordError: string | undefined;
    let savedEvent = event;
    if (discordOpts) {
      const validationError = validateDiscordOptions(discordOpts);
      if (validationError) {
        return reply.code(400).send({ ok: false, error: validationError });
      }
      const synced = await syncAndStoreEventDiscord({ discordOpts, event });
      discordError = synced.discordError;
      if (synced.event) {
        savedEvent = synced.event;
      }
    }

    await logAdminAction(session, params.guildId, "event:create", {
      details: `Evento creado: ${title}`,
      targetType: "event",
      targetId: event.id,
    });

    return {
      ok: true,
      guildId: params.guildId,
      event: savedEvent,
      discordError,
    };
  });

  app.patch("/guilds/:guildId/events/:eventId", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { eventId?: string; guildId?: string };
    if (!params.guildId || !params.eventId) {
      return reply.code(400).send({ ok: false, error: "Missing params" });
    }

    if (!(await canManageModule(session, params.guildId, "eventos"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as {
      description?: string;
      discord?: {
        createScheduledEvent?: boolean;
        entityType?: string;
        location?: string;
        publishChannelId?: string;
        publishMessage?: boolean;
        recurrence?: string;
        voiceChannelId?: string;
      };
      durationMinutes?: number | null;
      discordCleanupOnComplete?: boolean;
      imageUrl?: string;
      paused?: boolean;
      recurrenceEnabled?: boolean;
      recurrenceEveryDays?: number;
      recurrencePublishDaysBefore?: number;
      reminderHours?: number[];
      requiredRoleId?: string;
      signupDeadline?: string | null;
      startsAt?: string;
      status?: string;
      title?: string;
      type?: string;
    };

    if (body.startsAt && Number.isNaN(new Date(body.startsAt).getTime())) {
      return reply.code(400).send({ ok: false, error: "Fecha inválida" });
    }
    if (
      body.signupDeadline &&
      Number.isNaN(new Date(body.signupDeadline).getTime())
    ) {
      return reply.code(400).send({
        ok: false,
        error: "Fecha de cierre de inscripciones inválida",
      });
    }

    // Publicación en Discord: primero limpiamos lo viejo (si la web mandó
    // el bloque discord) y después sincronizamos según la nueva config.
    const discordOpts = normalizeDiscordOptions(body.discord);
    const previous = await getEvent(params.guildId, params.eventId);
    if (discordOpts) {
      const validationError = validateDiscordOptions(discordOpts);
      if (validationError) {
        return reply.code(400).send({ ok: false, error: validationError });
      }
      if (previous) {
        await cleanupEventDiscord({
          discordEventId: previous.discordEventId,
          discordMessageIds: previous.discordMessageIds,
          guildId: params.guildId,
          publishChannelId: previous.publishChannelId,
        });
      }
    }

    const event = await updateEvent(params.guildId, params.eventId, {
      description: body.description?.trim() || undefined,
      discordCleanupOnComplete:
        body.discordCleanupOnComplete === undefined
          ? undefined
          : body.discordCleanupOnComplete === true,
      durationMinutes: body.durationMinutes ?? null,
      imageUrl: body.imageUrl?.trim() || undefined,
      paused: body.paused === undefined ? undefined : body.paused === true,
      recurrenceEnabled:
        body.recurrenceEnabled === undefined
          ? undefined
          : body.recurrenceEnabled === true,
      recurrenceEveryDays:
        body.recurrenceEveryDays === undefined
          ? undefined
          : normalizeRecurrenceDays(body.recurrenceEveryDays),
      recurrencePublishDaysBefore:
        body.recurrencePublishDaysBefore === undefined
          ? undefined
          : normalizeRecurrenceDays(body.recurrencePublishDaysBefore),
      reminderHours:
        body.reminderHours === undefined
          ? undefined
          : normalizeReminderHours(body.reminderHours),
      requiredRoleId:
        body.requiredRoleId === undefined
          ? undefined
          : body.requiredRoleId.trim() || null,
      signupDeadline: body.signupDeadline ?? null,
      startsAt: body.startsAt,
      status: body.status,
      title: body.title?.trim() || undefined,
      type: body.type
        ? EVENT_TYPES.includes(body.type as never)
          ? body.type
          : undefined
        : undefined,
    });

    if (!event) {
      return reply.code(404).send({ ok: false, error: "Evento no encontrado" });
    }

    let discordError: string | undefined;
    let savedEvent = event;

    // Auto-limpieza en Discord al marcarlo Completado: el registro ya quedó
    // guardado (completedAt + historial), así que si el evento lo tenía
    // activado borramos el evento agendado y el aviso, y limpiamos sus ids.
    const completedNow =
      event.status === "completed" && previous?.status !== "completed";
    if (completedNow && event.discordCleanupOnComplete) {
      await cleanupEventDiscord({
        discordEventId: event.discordEventId,
        discordMessageIds: event.discordMessageIds,
        guildId: params.guildId,
        publishChannelId: event.publishChannelId,
        reminderMessageIds: event.reminderMessageIds,
      });
      const cleared = await setEventDiscordInfo(params.guildId, event.id, {
        discordEventId: null,
        discordMessageIds: [],
        reminderMessageIds: [],
      });
      if (cleared) {
        savedEvent = cleared;
      }
      console.log(
        `[eventos] evento completado: aviso/evento de Discord eliminado (${event.title})`,
      );
    } else if (discordOpts) {
      const synced = await syncAndStoreEventDiscord({ discordOpts, event });
      discordError = synced.discordError;
      if (synced.event) {
        savedEvent = synced.event;
      }
    }

    await logAdminAction(session, params.guildId, "event:update", {
      details: `Evento actualizado: ${event.title}`,
      targetType: "event",
      targetId: event.id,
    });

    return {
      ok: true,
      guildId: params.guildId,
      event: savedEvent,
      discordError,
    };
  });

  app.delete("/guilds/:guildId/events/:eventId", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { eventId?: string; guildId?: string };
    if (!params.guildId || !params.eventId) {
      return reply.code(400).send({ ok: false, error: "Missing params" });
    }

    if (!(await canManageModule(session, params.guildId, "eventos"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    // Limpiamos en Discord (scheduled event + avisos) antes de borrar.
    const existing = await getEvent(params.guildId, params.eventId);
    if (existing) {
      await cleanupEventDiscord({
        discordEventId: existing.discordEventId,
        discordMessageIds: existing.discordMessageIds,
        guildId: params.guildId,
        publishChannelId: existing.publishChannelId,
        reminderMessageIds: existing.reminderMessageIds,
      });
    }

    const deleted = await deleteEvent(params.guildId, params.eventId);

    await logAdminAction(session, params.guildId, "event:delete", {
      details: "Evento eliminado.",
      targetType: "event",
      targetId: params.eventId,
    });

    return { ok: true, guildId: params.guildId, deleted };
  });

  // ── Catálogo de specs de inscripción (RaidSpec, estilo Raid Helper) ──
  // Cualquier miembro puede leerlo (lo usa el selector de inscripción).
  app.get("/guilds/:guildId/events/specs", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const specs = await listRaidSpecs(params.guildId);
    return { ok: true, guildId: params.guildId, specs };
  });

  // Alta de spec del catálogo (staff con acceso al módulo eventos).
  app.post("/guilds/:guildId/events/specs", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "eventos"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as {
      animated?: boolean;
      className?: string;
      emojiId?: string;
      emojiName?: string;
      role?: string;
      specName?: string;
    };
    const role = body.role?.trim().toLowerCase();
    const className = body.className?.trim();
    const specName = body.specName?.trim();

    if (
      !role ||
      !RAID_ROLES.includes(role as never) ||
      !className ||
      !specName
    ) {
      return reply.code(400).send({
        ok: false,
        error: "Faltan rol (tank/healer/melee/ranged), clase o spec válidos",
      });
    }

    const spec = await createRaidSpec({
      animated: Boolean(body.animated),
      className,
      emojiId: body.emojiId?.trim() || undefined,
      emojiName: body.emojiName?.trim() || undefined,
      guildId: params.guildId,
      role,
      specName,
    });
    if (!spec) {
      return reply.code(409).send({
        ok: false,
        error: "Ese rol/clase/spec ya existe en el catálogo",
      });
    }

    return { ok: true, guildId: params.guildId, spec };
  });

  // Baja de spec del catálogo.
  app.delete(
    "/guilds/:guildId/events/specs/:specId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string; specId?: string };
      if (!params.guildId || !params.specId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "eventos"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteRaidSpec(params.guildId, params.specId);
      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  // Edición de una spec del catálogo.
  app.patch("/guilds/:guildId/events/specs/:specId", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string; specId?: string };
    if (!params.guildId || !params.specId) {
      return reply.code(400).send({ ok: false, error: "Missing params" });
    }

    if (!(await canManageModule(session, params.guildId, "eventos"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as {
      animated?: boolean;
      className?: string;
      emojiId?: string;
      emojiName?: string;
      role?: string;
      specName?: string;
    };
    const role = body.role?.trim().toLowerCase();
    const className = body.className?.trim();
    const specName = body.specName?.trim();
    if (role && !RAID_ROLES.includes(role as never)) {
      return reply.code(400).send({
        ok: false,
        error: "Rol inválido (tank/healer/melee/ranged)",
      });
    }
    if (className !== undefined && !className) {
      return reply.code(400).send({ ok: false, error: "Falta la clase" });
    }
    if (specName !== undefined && !specName) {
      return reply.code(400).send({ ok: false, error: "Falta la spec" });
    }

    const spec = await updateRaidSpec(params.guildId, params.specId, {
      animated: body.animated,
      className: className || undefined,
      emojiId: body.emojiId?.trim() || null,
      emojiName: body.emojiName?.trim() || null,
      role: role || undefined,
      specName: specName || undefined,
    });
    if (!spec) {
      return reply.code(409).send({
        ok: false,
        error: "No se pudo actualizar: puede que esa rol/clase/spec ya exista",
      });
    }
    return { ok: true, guildId: params.guildId, spec };
  });

  // Imagen de un evento por URL pública (sin sesión): Discord la necesita
  // para renderizar la imagen subida a la web (data URL) dentro del embed.
  // El id del evento ya es un identificador difícil de adivinar (cuid).
  app.get(
    "/public/guilds/:guildId/events/:eventId/image",
    async (request, reply) => {
      const params = request.params as {
        eventId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const event = await getEvent(params.guildId, params.eventId);
      const imageUrl = event?.imageUrl;
      if (!imageUrl?.startsWith("data:image/")) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }
      const match = imageUrl.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) {
        return reply.code(400).send({ ok: false, error: "Imagen inválida" });
      }
      const buffer = Buffer.from(match[2], "base64");
      return reply
        .header("Content-Type", match[1])
        .header("Cache-Control", "public, max-age=86400")
        .send(buffer);
    },
  );

  // ── Biblioteca de imágenes de eventos ─────────────────────────────
  app.get("/guilds/:guildId/events/images", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const images = await listEventImages(params.guildId);
    return { ok: true, guildId: params.guildId, images };
  });

  app.post("/guilds/:guildId/events/images", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "eventos"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as {
      dataUrl?: string;
      name?: string;
    };
    const dataUrl = body.dataUrl?.trim();
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      return reply.code(400).send({
        ok: false,
        error: "La imagen debe ser un data URL de imagen válido",
      });
    }
    // Límite de ~4MB en base64 (≈3MB de archivo real).
    if (dataUrl.length > 4_000_000) {
      return reply.code(400).send({
        ok: false,
        error: "La imagen es demasiado grande (máx. ~3MB)",
      });
    }

    const image = await createEventImage({
      dataUrl,
      guildId: params.guildId,
      name: body.name?.trim() || undefined,
    });

    return { ok: true, guildId: params.guildId, image };
  });

  app.delete(
    "/guilds/:guildId/events/images/:imageId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string; imageId?: string };
      if (!params.guildId || !params.imageId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "eventos"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteEventImage(params.guildId, params.imageId);
      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  // Inscripción del usuario logueado a un evento (upsert).
  app.put(
    "/guilds/:guildId/events/:eventId/signups",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!isGuildMember(session, params.guildId)) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const event = await getEvent(params.guildId, params.eventId);
      if (!event) {
        return reply
          .code(404)
          .send({ ok: false, error: "Evento no encontrado" });
      }

      if (event.paused) {
        return reply.code(400).send({
          ok: false,
          error: "El evento está pausado.",
        });
      }
      if (event.status !== "scheduled") {
        return reply.code(400).send({
          ok: false,
          error: "El evento no está abierto a inscripciones.",
        });
      }
      if (
        event.signupDeadline &&
        new Date(event.signupDeadline).getTime() < Date.now()
      ) {
        return reply.code(400).send({
          ok: false,
          error: "Las inscripciones están cerradas.",
        });
      }

      const user = session.user as {
        global_name?: string | null;
        id?: string;
        username?: string | null;
      };
      if (!user.id) {
        return reply.code(400).send({ ok: false, error: "Falta el usuario" });
      }

      const body = (request.body ?? {}) as {
        character?: string;
        note?: string;
        role?: string;
        spec?: string;
        status?: string;
        wowClass?: string;
      };

      const status = body.status ?? "tentative";
      if (!SIGNUP_STATUSES.includes(status as never)) {
        return reply.code(400).send({ ok: false, error: "Estado inválido" });
      }
      if (body.role && !SIGNUP_ROLES.includes(body.role as never)) {
        return reply.code(400).send({ ok: false, error: "Rol inválido" });
      }

      // Guardamos el nick de servidor (o global_name/username como fallback)
      // para que el roster muestre cómo se llama la persona en Discord. De
      // paso usamos sus roles para aplicar el rol mínimo requerido (yes→bench).
      const member = await fetchGuildMemberRecord(params.guildId, user.id);
      const displayName =
        memberDisplayName(member) ??
        user.global_name ??
        user.username ??
        "Miembro";
      const effectiveStatus = applyRequiredRoleStatus(
        status,
        member,
        event.requiredRoleId,
      );
      const signup = await upsertSignup({
        character: body.character?.trim() || undefined,
        eventId: params.eventId,
        guildId: params.guildId,
        note: body.note?.trim() || undefined,
        role: body.role?.trim() || undefined,
        spec: body.spec?.trim() || undefined,
        status: effectiveStatus,
        userId: user.id,
        username: displayName,
        wowClass: body.wowClass?.trim() || undefined,
      });

      // Si el evento está publicado en Discord, actualiza su embed (roster).
      await refreshEventAnnouncement(params.guildId, params.eventId);

      return { ok: true, guildId: params.guildId, signup };
    },
  );

  // Quita la propia inscripción.
  app.delete(
    "/guilds/:guildId/events/:eventId/signups/me",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      const user = session.user as { id?: string };
      if (!user.id) {
        return reply.code(400).send({ ok: false, error: "Falta el usuario" });
      }

      const deleted = await deleteSignup(
        params.guildId,
        params.eventId,
        user.id,
      );

      // Si el evento está publicado en Discord, actualiza su embed (roster).
      await refreshEventAnnouncement(params.guildId, params.eventId);

      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  // ── Inscripciones desde Discord (bot) ──────────────────────────────
  // El bot llama estos endpoints internos (x-bot-token) cuando un miembro
  // toca los botones del embed del evento. Reutilizan la misma lógica que
  // la web y refrescan el aviso publicado en Discord.

  app.get("/internal/guilds/:guildId/events/specs", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }
    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }
    const specs = await listRaidSpecs(params.guildId);
    return { ok: true, guildId: params.guildId, specs };
  });

  // El bot necesita el evento (con sus signups) para decidir si abre el
  // asistente de rol/spec o aplica el estado directo.
  app.get(
    "/internal/guilds/:guildId/events/:eventId",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }
      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const event = await getEvent(params.guildId, params.eventId);
      if (!event) {
        return reply
          .code(404)
          .send({ ok: false, error: "Evento no encontrado" });
      }
      return { ok: true, guildId: params.guildId, event };
    },
  );

  // Control de asistencia (lo consume el bot periódicamente): eventos que ya
  // tienen un recordatorio por enviar (con las horas vencidas) y eventos
  // completados con informe de "no se anotaron" pendiente.
  app.get(
    "/internal/guilds/:guildId/events/control",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }
      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }
      const [reminders, reports] = await Promise.all([
        listReminderDueEvents(params.guildId),
        listReportPendingEvents(params.guildId),
      ]);
      return {
        ok: true,
        guildId: params.guildId,
        reports,
        reminders,
      };
    },
  );

  // El bot avisa que ya envió los recordatorios indicados (horas) del evento.
  app.post(
    "/internal/guilds/:guildId/events/:eventId/reminders-sent",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }
      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const body = (request.body ?? {}) as {
        hours?: number[];
        messageIds?: string[];
      };
      const messageIds = Array.isArray(body.messageIds)
        ? body.messageIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          )
        : [];
      const event = await markEventRemindersSent(
        params.guildId,
        params.eventId,
        normalizeReminderHours(body.hours),
        messageIds,
      );
      if (!event) {
        return reply
          .code(404)
          .send({ ok: false, error: "Evento no encontrado" });
      }
      return { ok: true, guildId: params.guildId, event };
    },
  );

  // El bot avisa que ya envió el informe de asistencia del evento completado.
  app.post(
    "/internal/guilds/:guildId/events/:eventId/report-sent",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }
      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const event = await markEventReportSent(params.guildId, params.eventId);
      if (!event) {
        return reply
          .code(404)
          .send({ ok: false, error: "Evento no encontrado" });
      }
      return { ok: true, guildId: params.guildId, event };
    },
  );

  app.put(
    "/internal/guilds/:guildId/events/:eventId/signups",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }
      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const body = (request.body ?? {}) as {
        character?: string;
        role?: string;
        spec?: string;
        status?: string;
        userId?: string;
        username?: string;
        wowClass?: string;
      };
      if (!body.userId || !body.username?.trim()) {
        return reply.code(400).send({ ok: false, error: "Falta el usuario" });
      }

      const event = await getEvent(params.guildId, params.eventId);
      if (!event) {
        return reply
          .code(404)
          .send({ ok: false, error: "Evento no encontrado" });
      }
      if (event.paused) {
        return reply.code(400).send({
          ok: false,
          error: "El evento está pausado.",
        });
      }
      if (event.status !== "scheduled") {
        return reply.code(400).send({
          ok: false,
          error: "El evento no está abierto a inscripciones.",
        });
      }
      if (
        event.signupDeadline &&
        new Date(event.signupDeadline).getTime() < Date.now()
      ) {
        return reply.code(400).send({
          ok: false,
          error: "Las inscripciones están cerradas.",
        });
      }

      const status = body.status ?? "yes";
      if (!SIGNUP_STATUSES.includes(status as never)) {
        return reply.code(400).send({ ok: false, error: "Estado inválido" });
      }
      if (body.role && !SIGNUP_ROLES.includes(body.role as never)) {
        return reply.code(400).send({ ok: false, error: "Rol inválido" });
      }

      // Aplicamos el rol mínimo requerido del evento (yes sin rol → bench).
      const member = await fetchGuildMemberRecord(params.guildId, body.userId);
      const effectiveStatus = applyRequiredRoleStatus(
        status,
        member,
        event.requiredRoleId,
      );

      const signup = await upsertSignup({
        character: body.character?.trim() || undefined,
        eventId: params.eventId,
        guildId: params.guildId,
        role: body.role?.trim() || undefined,
        spec: body.spec?.trim() || undefined,
        status: effectiveStatus,
        userId: body.userId,
        username: body.username.trim(),
        wowClass: body.wowClass?.trim() || undefined,
      });

      await refreshEventAnnouncement(params.guildId, params.eventId);
      return { ok: true, guildId: params.guildId, signup };
    },
  );

  app.delete(
    "/internal/guilds/:guildId/events/:eventId/signups",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }
      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
      const params = request.params as { eventId?: string; guildId?: string };
      if (!params.guildId || !params.eventId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const body = (request.body ?? {}) as { userId?: string };
      if (!body.userId) {
        return reply.code(400).send({ ok: false, error: "Falta el usuario" });
      }

      const deleted = await deleteSignup(
        params.guildId,
        params.eventId,
        body.userId,
      );
      await refreshEventAnnouncement(params.guildId, params.eventId);
      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  // Feed de drops raros de Karuta detectados por el bot (lectura pública
  // para cualquier miembro; la config de vigilado vive en /guilds/:id/config).
  app.get("/guilds/:guildId/karuta/drops", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const drops = await listRecentKarutaDrops(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      drops,
    };
  });

  // Borrar un drop de Karuta (admin/owner; la config del módulo vive bajo
  // el módulo "config" del panel Admin). Útil para limpiar falsos positivos
  // (p. ej. una carta vista con `kv` que se registró por error).
  app.delete(
    "/guilds/:guildId/karuta/drops/:dropId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        dropId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.dropId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "config"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteKarutaDrop(params.guildId, params.dropId);

      await logAdminAction(session, params.guildId, "karuta-drop:delete", {
        details: "Drop de Karuta eliminado.",
        targetId: params.dropId,
        targetType: "karuta-drop",
      });

      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  // El bot llama esto cuando detecta un grab raro de Karuta en el canal
  // vigilado. Idempotente por sourceMessageId (evita duplicados si el bot
  // reprocesa el mismo mensaje).
  app.post("/internal/guilds/:guildId/karuta/drops", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const body = (request.body ?? {}) as {
      cardName?: string;
      imageUrl?: string;
      printNumber?: number;
      reasons?: string[];
      series?: string;
      sourceMessageId?: string;
      userId?: string;
      username?: string;
      wishlistCount?: number;
    };

    if (!body.sourceMessageId) {
      return reply.code(400).send({
        ok: false,
        error: "Missing sourceMessageId",
      });
    }

    const result = await createKarutaDrop({
      cardName: body.cardName,
      guildId: params.guildId,
      imageUrl: body.imageUrl,
      printNumber: body.printNumber,
      reasons: body.reasons ?? [],
      series: body.series,
      sourceMessageId: body.sourceMessageId,
      userId: body.userId,
      username: body.username,
      wishlistCount: body.wishlistCount,
    });

    return {
      ok: true,
      guildId: params.guildId,
      created: result.created,
    };
  });

  // Diagnóstico del detector de drops: el bot manda acá cada mensaje que vio
  // en el canal vigilado y qué decidió con él (registrado, ignorado por
  // umbral, formato no reconocido, etc.).
  app.post(
    "/internal/guilds/:guildId/karuta/debug",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }

      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }

      const body = (request.body ?? {}) as {
        authorId?: string;
        authorName?: string;
        channelId?: string;
        decision?: string;
        detail?: string;
        kind?: string;
      };

      if (!body.kind || !body.decision) {
        return reply
          .code(400)
          .send({ ok: false, error: "Missing kind or decision" });
      }

      await createKarutaDebugEvent({
        authorId: body.authorId,
        authorName: body.authorName,
        channelId: body.channelId,
        decision: body.decision,
        detail: body.detail,
        guildId: params.guildId,
        kind: body.kind,
      });
      void pruneKarutaDebugEvents().catch(() => undefined);

      return { ok: true };
    },
  );

  // Últimos eventos de diagnóstico (solo admin de config): sirve para ver qué
  // está mandando Karuta/Card Companion cuando un drop no se detecta.
  app.get("/guilds/:guildId/karuta/debug", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "config"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const events = await listKarutaDebugEvents(params.guildId);

    return { ok: true, guildId: params.guildId, events };
  });

  // Registro de posesión de cartas raras (alimentado por `kv` del bot).
  // Lectura pública para miembros.
  app.get("/guilds/:guildId/karuta/cards", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const cards = await listOwnedKarutaCards(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      cards,
    };
  });

  // Quitar manualmente una carta del registro (admin/owner). Red de seguridad
  // cuando el bot no puede deducir un burn/trade automáticamente.
  app.delete(
    "/guilds/:guildId/karuta/cards/:cardId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        cardId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.cardId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "config"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteKarutaCard(params.guildId, params.cardId);

      await logAdminAction(session, params.guildId, "karuta-card:delete", {
        details: "Carta de Karuta eliminada del registro de posesión.",
        targetId: params.cardId,
        targetType: "karuta-card",
      });

      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  // Upsert de posesión desde el bot (kv → "Owned by X"). Una carta (code)
  // tiene un único dueño actual.
  app.post("/internal/guilds/:guildId/karuta/cards", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const body = (request.body ?? {}) as {
      cardName?: string;
      code?: string;
      edition?: number;
      imageUrl?: string;
      ownerUserId?: string;
      ownerUsername?: string;
      printNumber?: number;
      series?: string;
      wishlistCount?: number;
    };

    if (!body.code) {
      return reply.code(400).send({ ok: false, error: "Missing code" });
    }

    const card = await upsertKarutaCard({
      cardName: body.cardName,
      code: body.code,
      edition: body.edition,
      guildId: params.guildId,
      imageUrl: body.imageUrl,
      ownerUserId: body.ownerUserId,
      ownerUsername: body.ownerUsername,
      printNumber: body.printNumber,
      series: body.series,
      wishlistCount: body.wishlistCount,
    });

    return {
      ok: true,
      guildId: params.guildId,
      card,
    };
  });

  // Baja por burn desde el bot (kb → "The card has been burned.").
  // Best-effort: kb no muestra el code, se matchea por dueño (+nombre si hay).
  app.post(
    "/internal/guilds/:guildId/karuta/cards/burn",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }

      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }

      const body = (request.body ?? {}) as {
        cardName?: string;
        ownerUsername?: string;
      };

      const card = await burnKarutaCard({
        cardName: body.cardName,
        guildId: params.guildId,
        ownerUsername: body.ownerUsername,
      });

      return {
        ok: true,
        guildId: params.guildId,
        burned: card !== null,
        card,
      };
    },
  );

  // Grab de una carta ya registrada (mensaje "@X took the <name> card `<code>`!").
  // Si el code está en la colección: registra el drop (grabber + dropper =
  // dueño anterior) y transfiere la posesión al grabber. Idempotente por
  // sourceMessageId.
  app.post("/internal/guilds/:guildId/karuta/grabs", async (request, reply) => {
    if (!env.BOT_API_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "BOT_API_TOKEN is not configured",
      });
    }

    if (!isAuthorizedBotRequest(request)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    const body = (request.body ?? {}) as {
      cardName?: string;
      code?: string;
      grabberUsername?: string;
      sourceMessageId?: string;
      wishlistCount?: number;
    };

    if (!body.code) {
      return reply.code(400).send({ ok: false, error: "Missing code" });
    }
    if (!body.sourceMessageId) {
      return reply
        .code(400)
        .send({ ok: false, error: "Missing sourceMessageId" });
    }

    const result = await processKarutaGrab({
      cardName: body.cardName,
      code: body.code,
      grabberUsername: body.grabberUsername,
      guildId: params.guildId,
      sourceMessageId: body.sourceMessageId,
      wishlistCount: body.wishlistCount,
    });

    return {
      ok: true,
      guildId: params.guildId,
      processed: result.processed,
    };
  });

  // Transferencia aceptada (kg): cambia el dueño de una carta registrada.
  app.post(
    "/internal/guilds/:guildId/karuta/transfers",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }

      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }

      const body = (request.body ?? {}) as {
        code?: string;
        toUsername?: string;
      };

      if (!body.code) {
        return reply.code(400).send({ ok: false, error: "Missing code" });
      }

      const result = await processKarutaTransfer({
        code: body.code,
        guildId: params.guildId,
        toUsername: body.toUsername,
      });

      return {
        ok: true,
        guildId: params.guildId,
        processed: result.processed,
      };
    },
  );

  // Álbum de Karuta (ka): el bot lo sube cuando alguien ve su colección.
  app.post(
    "/internal/guilds/:guildId/karuta/albums",
    async (request, reply) => {
      if (!env.BOT_API_TOKEN) {
        return reply.code(503).send({
          ok: false,
          error: "BOT_API_TOKEN is not configured",
        });
      }

      if (!isAuthorizedBotRequest(request)) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }

      const body = (request.body ?? {}) as {
        albumName?: string;
        background?: string;
        channelId?: string;
        imageUrl?: string;
        messageId?: string;
        ownerUserId?: string;
        ownerUsername?: string;
        page?: number;
        totalPages?: number;
      };

      if (!body.albumName) {
        return reply.code(400).send({ ok: false, error: "Missing albumName" });
      }

      const album = await upsertKarutaAlbum({
        albumName: body.albumName,
        background: body.background,
        channelId: body.channelId,
        guildId: params.guildId,
        imageUrl: body.imageUrl,
        messageId: body.messageId,
        ownerUserId: body.ownerUserId,
        ownerUsername: body.ownerUsername,
        page: body.page,
        totalPages: body.totalPages,
      });

      // Cacheamos los bytes de la página en segundo plano: así la imagen deja
      // de depender de la URL firmada de Discord (que vence). Respondemos ya
      // para no hacer esperar al bot (tiene timeout de 4s).
      if (album.imageUrl) {
        void cacheKarutaAlbumPageImage(
          params.guildId,
          album.id,
          album.page ?? 1,
          album.imageUrl,
        );
      }

      return { ok: true, guildId: params.guildId, album };
    },
  );

  // Listado de álbumes (ka) para la sección Colección. Lectura para miembros.
  app.get("/guilds/:guildId/karuta/albums", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const albums = await listKarutaAlbums(params.guildId);
    // Refresco "lazy": cachea/re-firma las páginas que todavía falten. La
    // respuesta ya sale con las URLs propias de las páginas cacheadas.
    void refreshStaleKarutaAlbumImages(albums);
    const cachedPages = await listCachedKarutaAlbumPages(
      albums.map((album) => album.id),
    );

    return {
      ok: true,
      guildId: params.guildId,
      albums: withCachedAlbumImageUrls(albums, cachedPages),
    };
  });

  // Imagen de una página de álbum servida por el API (sin sesión): son los
  // bytes que cacheamos, así el navegador no depende del CDN de Discord.
  app.get(
    "/public/guilds/:guildId/karuta/albums/:albumId/pages/:page/image",
    async (request, reply) => {
      const params = request.params as {
        albumId?: string;
        guildId?: string;
        page?: string;
      };
      const page = Number.parseInt(params.page ?? "", 10);
      if (!params.guildId || !params.albumId || !Number.isFinite(page)) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }
      const image = await getKarutaAlbumPageImage(
        params.guildId,
        params.albumId,
        page,
      );
      if (!image) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }
      // Cache corto: la página puede actualizarse (se agregan cartas) y no
      // queremos que el navegador muestre una versión vieja por mucho tiempo.
      return reply
        .header("Content-Type", image.mimeType)
        .header("Cache-Control", "public, max-age=3600")
        .send(image.data);
    },
  );

  // Borrar un álbum de la Colección (admin/owner). Red para quitar entradas
  // incorrectas.
  app.delete(
    "/guilds/:guildId/karuta/albums/:albumId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        albumId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.albumId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "config"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await deleteKarutaAlbum(params.guildId, params.albumId);

      await logAdminAction(session, params.guildId, "karuta-album:delete", {
        details: "Álbum de Karuta eliminado de la Colección.",
        targetId: params.albumId,
        targetType: "karuta-album",
      });

      return { ok: true, guildId: params.guildId, deleted };
    },
  );

  app.get("/guilds/:guildId/config", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const config = await getGuildConfig(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      config,
    };
  });

  // Qué módulos del panel Admin puede usar el usuario logueado: el owner
  // tiene acceso total; el staff solo los módulos de sus roles.
  app.get("/guilds/:guildId/admin-access", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (canManageGuild(session, params.guildId)) {
      return {
        ok: true,
        guildId: params.guildId,
        owner: true,
        modules: [],
      };
    }

    const roles = await fetchMemberRoles(params.guildId, session.user.id);
    if (!roles) {
      return {
        ok: true,
        guildId: params.guildId,
        owner: false,
        modules: [],
      };
    }

    const config = await getGuildConfig(params.guildId);
    const modules = new Set<string>();
    for (const rule of config.adminRoleModules ?? []) {
      if (roles.includes(rule.roleId)) {
        for (const module of rule.modules) {
          modules.add(module);
        }
      }
    }

    return {
      ok: true,
      guildId: params.guildId,
      owner: false,
      modules: [...modules],
    };
  });

  app.get("/guilds/:guildId/audit-logs", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    // El registro es readonly y solo lo puede ver el owner de la guild.
    if (!isGuildOwner(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const logs = await listAuditLogEntries(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      logs,
    };
  });

  app.patch("/guilds/:guildId/config", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "config"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    // Campos reservados al owner: el staff no puede tocar módulos,
    // destinatario de sugerencias ni los permisos de staff.
    const isOwner = isGuildOwner(session, params.guildId);
    const body = request.body as Partial<GuildConfig>;
    const allowedBody: GuildConfig = {};

    if (body.logsWatchGuild !== undefined) {
      allowedBody.logsWatchGuild = body.logsWatchGuild;
    }

    if (body.logsWatchEnabled !== undefined) {
      allowedBody.logsWatchEnabled = body.logsWatchEnabled;
    }

    if (body.logsWatchRegion !== undefined) {
      allowedBody.logsWatchRegion = body.logsWatchRegion;
    }

    if (body.logsWatchServer !== undefined) {
      allowedBody.logsWatchServer = body.logsWatchServer;
    }

    if (body.logsChannelId !== undefined) {
      allowedBody.logsChannelId = body.logsChannelId;
    }

    if (body.karutaChannelId !== undefined) {
      allowedBody.karutaChannelId = body.karutaChannelId;
    }

    if (body.karutaWatchEnabled !== undefined) {
      allowedBody.karutaWatchEnabled = body.karutaWatchEnabled;
    }

    if (body.karutaRarePrintMax !== undefined) {
      allowedBody.karutaRarePrintMax = body.karutaRarePrintMax;
    }

    if (body.karutaRareWishlistMin !== undefined) {
      allowedBody.karutaRareWishlistMin = body.karutaRareWishlistMin;
    }

    if (body.dailyMessagesChannelId !== undefined) {
      allowedBody.dailyMessagesChannelId = body.dailyMessagesChannelId;
    }

    if (body.dailyMessagesEnabled !== undefined) {
      allowedBody.dailyMessagesEnabled = body.dailyMessagesEnabled;
    }

    if (body.dailyMessagesMinMinutes !== undefined) {
      allowedBody.dailyMessagesMinMinutes = body.dailyMessagesMinMinutes;
    }

    if (body.dailyMessagesMaxMinutes !== undefined) {
      allowedBody.dailyMessagesMaxMinutes = body.dailyMessagesMaxMinutes;
    }

    if (body.memberLogChannelId !== undefined) {
      allowedBody.memberLogChannelId = body.memberLogChannelId;
    }

    if (body.dynamicVoiceCreateChannelId !== undefined) {
      allowedBody.dynamicVoiceCreateChannelId =
        body.dynamicVoiceCreateChannelId;
    }

    if (body.defaultRoleId !== undefined) {
      allowedBody.defaultRoleId = body.defaultRoleId;
    }

    if (isOwner && body.enabledModules !== undefined) {
      allowedBody.enabledModules = body.enabledModules;
    }

    if (body.musicEnabled !== undefined) {
      allowedBody.musicEnabled = body.musicEnabled;
    }

    if (body.musicRoleIds !== undefined) {
      allowedBody.musicRoleIds = body.musicRoleIds;
    }

    if (body.bannedVoiceRoleIds !== undefined) {
      allowedBody.bannedVoiceRoleIds = body.bannedVoiceRoleIds;
    }

    if (isOwner && body.suggestionsDmTiers !== undefined) {
      allowedBody.suggestionsDmTiers = body.suggestionsDmTiers;
    }

    if (isOwner && body.adminRoleModules !== undefined) {
      allowedBody.adminRoleModules = body.adminRoleModules;
    }

    const config = await upsertGuildConfig(params.guildId, allowedBody);

    await logAdminAction(session, params.guildId, "update:guild-config", {
      details: "Se guardó la configuración general del servidor.",
    });

    return {
      ok: true,
      guildId: params.guildId,
      config,
    };
  });

  // Sugerencias del hub: llegan como DM al staff según los rangos configurados.
  app.post("/guilds/:guildId/suggestions", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!isGuildMember(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = (request.body ?? {}) as { text?: unknown; title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!title || !text) {
      return reply.code(400).send({
        ok: false,
        error: "Título y texto son obligatorios.",
      });
    }
    if (title.length > 120 || text.length > 2000) {
      return reply.code(400).send({
        ok: false,
        error:
          "El título no puede pasar de 120 caracteres ni el texto de 2000.",
      });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const config = await getGuildConfig(params.guildId);

    // Destinatarios: únicamente los rangos tildados.
    const recipients = new Set<string>();
    const tiers = config.suggestionsDmTiers ?? [];
    if (tiers.length > 0) {
      const needOwner = tiers.includes("owner");
      const staffTiers = tiers.filter(
        (tier): tier is "admin" | "officer" =>
          tier === "admin" || tier === "officer",
      );

      let ownerId: string | null = null;
      if (needOwner || staffTiers.length > 0) {
        const guildResponse = await fetch(
          `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}`,
          {
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            },
          },
        ).catch(() => null);
        const guildData = guildResponse?.ok
          ? ((await guildResponse.json()) as { owner_id?: string })
          : null;
        ownerId = guildData?.owner_id?.trim() ?? null;
      }

      if (needOwner && ownerId) {
        recipients.add(ownerId);
      }

      if (staffTiers.length > 0) {
        // Roles que tienen cada rango (según adminRoleModules).
        const roleIdsByTier: Record<string, string[]> = {};
        for (const rule of config.adminRoleModules ?? []) {
          const modules = [...rule.modules].sort().join(",");
          for (const tier of staffTiers) {
            const expected = [...STAFF_TIER_MODULES[tier]].sort().join(",");
            if (modules === expected) {
              (roleIdsByTier[tier] ??= []).push(rule.roleId);
            }
          }
        }
        const wantedRoleIds = new Set(
          staffTiers.flatMap((tier) => roleIdsByTier[tier] ?? []),
        );

        if (wantedRoleIds.size > 0) {
          // Una página de 1000 miembros cubre guilds chicas/medianas.
          const membersResponse = await fetchWithDiscordRetry(
            `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}/members?limit=1000`,
            {
              headers: {
                Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              },
            },
          );
          if (membersResponse.ok) {
            const members = (await membersResponse.json()) as Array<{
              roles?: string[];
              user?: { id?: string };
            }>;
            for (const member of members) {
              if (
                member.user?.id &&
                (member.roles ?? []).some((roleId) => wantedRoleIds.has(roleId))
              ) {
                recipients.add(member.user.id);
              }
            }
          }
        }
      }
    }

    if (recipients.size === 0) {
      // Fallback: dueño del server.
      const guildResponse = await fetch(
        `https://discord.com/api/v10/guilds/${encodeURIComponent(params.guildId)}`,
        {
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
        },
      ).catch(() => null);
      const guildData = guildResponse?.ok
        ? ((await guildResponse.json()) as { owner_id?: string })
        : null;
      const ownerId = guildData?.owner_id?.trim();
      if (ownerId) {
        recipients.add(ownerId);
      }
    }

    if (recipients.size === 0) {
      return reply.code(502).send({
        ok: false,
        error: "No se pudo resolver el destinatario de la sugerencia.",
      });
    }

    const senderName = session.user.username || "Alguien";
    const embed = {
      color: 0x6aa8ff,
      author: {
        name: `💡 Sugerencia de ${senderName}`,
        url: `https://discord.com/users/${session.user.id}`,
      },
      title,
      description: text,
      timestamp: new Date().toISOString(),
      footer: { text: "Bonafide Hub · Sugerencias" },
    };

    let sentCount = 0;
    for (const recipientId of recipients) {
      const dmChannelResponse = await fetchWithDiscordRetry(
        "https://discord.com/api/v10/users/@me/channels",
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recipient_id: recipientId }),
        },
      );
      if (!dmChannelResponse.ok) {
        continue;
      }
      const dmChannel = (await dmChannelResponse.json()) as { id: string };

      const messageResponse = await fetchWithDiscordRetry(
        `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ embeds: [embed] }),
        },
      );
      if (messageResponse.ok) {
        sentCount += 1;
      }
    }

    if (sentCount === 0) {
      return reply.code(502).send({
        ok: false,
        error: "No se pudo enviar el DM a ningún destinatario.",
      });
    }

    return {
      ok: true,
      guildId: params.guildId,
      sent: true,
      recipients: sentCount,
    };
  });

  app.get(
    "/guilds/:guildId/communications/published",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string };
      if (!params.guildId) {
        return reply.code(400).send({ ok: false, error: "Missing guildId" });
      }

      if (!isGuildMember(session, params.guildId)) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const communications = await listPublishedInstances(params.guildId);

      return {
        ok: true,
        guildId: params.guildId,
        communications,
      };
    },
  );

  app.get("/guilds/:guildId/communications", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "comunicados"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const communications = await listCommunications(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      communications,
    };
  });

  app.post("/guilds/:guildId/communications", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!(await canManageModule(session, params.guildId, "comunicados"))) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = request.body as {
      authorName?: string;
      channelId?: string;
      content?: string;
      tagColor?: string;
      tagLabel?: string;
      title?: string;
    };

    const title = body.title?.trim();
    const content = body.content?.trim();
    if (!title || !content) {
      return reply
        .code(400)
        .send({ ok: false, error: "Faltan title o content" });
    }

    const communication = await createCommunication({
      authorName: body.authorName ?? session.user?.global_name ?? undefined,
      channelId: body.channelId,
      content,
      guildId: params.guildId,
      tagColor: body.tagColor,
      tagLabel: body.tagLabel,
      title,
    });

    await logAdminAction(session, params.guildId, "create:communication", {
      details: `Comunicado creado: ${title}`,
      targetType: "communication",
      targetId: communication.id,
    });

    return { ok: true, communication };
  });

  app.patch(
    "/guilds/:guildId/communications/:communicationId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        communicationId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.communicationId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "comunicados"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const existing = await getCommunication(params.communicationId);
      if (!existing || existing.guildId !== params.guildId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      const body = request.body as {
        authorName?: string;
        channelId?: string;
        content?: string;
        tagColor?: string;
        tagLabel?: string;
        title?: string;
      };

      const communication = await updateCommunication({
        authorName: body.authorName,
        channelId: body.channelId,
        content: body.content?.trim(),
        id: params.communicationId,
        tagColor: body.tagColor,
        tagLabel: body.tagLabel,
        title: body.title?.trim(),
      });

      if (!communication) {
        return reply
          .code(500)
          .send({ ok: false, error: "No se pudo actualizar" });
      }

      // Editar solo guarda la plantilla; no toca los mensajes ya
      // publicados en Discord. Para cambiar lo publicado se re-publica.
      return { ok: true, communication };
    },
  );

  app.delete(
    "/guilds/:guildId/communications/:communicationId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        communicationId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.communicationId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "comunicados"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const existing = await getCommunication(params.communicationId);
      if (!existing || existing.guildId !== params.guildId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      // Borrar la plantilla también borra todos sus mensajes de Discord.
      const token = env.DISCORD_BOT_TOKEN;
      if (token) {
        for (const instance of existing.instances) {
          await deleteMessages(
            token,
            instance.channelId,
            instance.discordMessageIds,
          );
        }
      }

      const deleted = await deleteCommunication(params.communicationId);

      return { ok: true, deleted };
    },
  );

  app.delete(
    "/guilds/:guildId/communications/:communicationId/instances/:instanceId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        communicationId?: string;
        guildId?: string;
        instanceId?: string;
      };
      if (!params.guildId || !params.communicationId || !params.instanceId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "comunicados"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const existing = await getCommunication(params.communicationId);
      if (!existing || existing.guildId !== params.guildId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      const instance = await getCommunicationInstance(params.instanceId);
      if (!instance || instance.communicationId !== params.communicationId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      // Eliminar el mensaje también lo borra de Discord.
      const token = env.DISCORD_BOT_TOKEN;
      if (token) {
        await deleteMessages(
          token,
          instance.channelId,
          instance.discordMessageIds,
        );
      }

      const deleted = await deleteCommunicationInstance(params.instanceId);

      return { ok: true, deleted };
    },
  );

  // Edita un mensaje ya publicado (instancia): actualiza el contenido en
  // Discord (editando el mensaje en su lugar) y en el hub, sin republicar.
  app.patch(
    "/guilds/:guildId/communications/:communicationId/instances/:instanceId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        communicationId?: string;
        guildId?: string;
        instanceId?: string;
      };
      if (!params.guildId || !params.communicationId || !params.instanceId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "comunicados"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const existing = await getCommunication(params.communicationId);
      if (!existing || existing.guildId !== params.guildId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      const instance = await getCommunicationInstance(params.instanceId);
      if (!instance || instance.communicationId !== params.communicationId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      const body = request.body as {
        content?: string;
        tagColor?: string;
        tagLabel?: string;
        title?: string;
      };

      const title = body.title?.trim();
      const content = body.content?.trim();
      if (!title || !content) {
        return reply
          .code(400)
          .send({ ok: false, error: "Faltan title o content" });
      }

      const token = env.DISCORD_BOT_TOKEN;
      let discordMessageIds = instance.discordMessageIds;

      // Si tiene mensajes en Discord, los editamos en su lugar (sin crear
      // mensajes nuevos). Si es solo web, actualizamos únicamente el hub.
      if (discordMessageIds.length > 0) {
        if (!token) {
          return reply.code(502).send({
            ok: false,
            error: "DISCORD_BOT_TOKEN no está configurado",
          });
        }

        const chunks = splitForDiscord(
          await resolveMentions(content, params.guildId),
        );
        discordMessageIds = await editMessages(
          token,
          instance.channelId,
          instance.discordMessageIds,
          chunks,
        );

        if (discordMessageIds.length === 0) {
          return reply.code(502).send({
            ok: false,
            error: "No se pudo editar el mensaje en Discord.",
          });
        }
      }

      const updated = await updateCommunicationInstance({
        authorName: instance.authorName,
        content,
        discordMessageIds,
        id: instance.id,
        tagColor: body.tagColor,
        tagLabel: body.tagLabel,
        title,
      });

      if (!updated) {
        return reply
          .code(500)
          .send({ ok: false, error: "No se pudo actualizar" });
      }

      await logAdminAction(session, params.guildId, "update:communication", {
        details: `Mensaje editado: ${title}`,
        targetType: "communication",
        targetId: params.communicationId,
      });

      return { ok: true, instance: updated };
    },
  );

  app.post(
    "/guilds/:guildId/communications/:communicationId/publish",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        communicationId?: string;
        guildId?: string;
      };
      if (!params.guildId || !params.communicationId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!(await canManageModule(session, params.guildId, "comunicados"))) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const existing = await getCommunication(params.communicationId);
      if (!existing || existing.guildId !== params.guildId) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      const token = env.DISCORD_BOT_TOKEN;
      const channelId = existing.channelId?.trim();

      // Sin canal → publicación solo web: el comunicado aparece únicamente
      // en el hub, sin mensaje en Discord.
      let messageIds: string[] = [];
      if (channelId) {
        if (!token) {
          return reply.code(502).send({
            ok: false,
            error: "DISCORD_BOT_TOKEN no está configurado",
          });
        }

        const chunks = splitForDiscord(
          await resolveMentions(existing.content, existing.guildId),
        );
        messageIds = await postMessages(token, channelId, chunks);

        if (messageIds.length === 0) {
          return reply.code(502).send({
            ok: false,
            error: "No se pudo publicar el comunicado en Discord.",
          });
        }
      }

      // Cada publicación crea una instancia nueva (un mensaje nuevo en
      // Discord, o una entrada solo web si no hay canal). Republicar NO
      // edita lo anterior: genera otra instancia.
      const instance = await createCommunicationInstance({
        authorName: existing.authorName,
        channelId: channelId ?? "",
        communicationId: existing.id,
        content: existing.content,
        discordMessageIds: messageIds,
        guildId: existing.guildId,
        tagColor: existing.tagColor,
        tagLabel: existing.tagLabel,
        title: existing.title,
      });

      await markCommunicationPublished(existing.id);

      await logAdminAction(session, params.guildId, "publish:communication", {
        details: `Comunicado publicado: ${existing.title}`,
        targetType: "communication",
        targetId: existing.id,
      });

      return { ok: true, instance };
    },
  );

  app.get("/guilds/:guildId/reminders", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!canManageGuild(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const reminders = await listGuildReminders(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      reminders,
    };
  });

  app.post("/guilds/:guildId/reminders", async (request, reply) => {
    const session = await requireSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    const params = request.params as { guildId?: string };
    if (!params.guildId) {
      return reply.code(400).send({ ok: false, error: "Missing guildId" });
    }

    if (!canManageGuild(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = request.body as {
      channelId?: string;
      message?: string;
      minutesFromCreation?: number;
      roleId?: string;
    };

    const channelId = body.channelId?.trim();
    const message = body.message?.trim();
    const minutesFromCreation = body.minutesFromCreation;
    const roleId = body.roleId?.trim() || undefined;

    if (!channelId || !message || !minutesFromCreation) {
      return reply.code(400).send({
        ok: false,
        error: "channelId, message y minutesFromCreation son requeridos",
      });
    }

    if (!Number.isInteger(minutesFromCreation) || minutesFromCreation < 1) {
      return reply.code(400).send({
        ok: false,
        error: "minutesFromCreation debe ser entero positivo",
      });
    }

    const reminder = await createReminder({
      channelId,
      createdByUserId: session.user.id,
      guildId: params.guildId,
      message,
      minutesFromCreation,
      roleId,
    });

    return reply.code(201).send({
      ok: true,
      guildId: params.guildId,
      reminderScheduledFor: reminder.dueAt,
    });
  });

  app.delete(
    "/guilds/:guildId/reminders/:reminderId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as {
        guildId?: string;
        reminderId?: string;
      };
      if (!params.guildId || !params.reminderId) {
        return reply
          .code(400)
          .send({ ok: false, error: "Missing guildId/reminderId" });
      }

      if (!canManageGuild(session, params.guildId)) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      const deleted = await cancelReminder(params.guildId, params.reminderId);
      if (!deleted) {
        return reply.code(404).send({
          ok: false,
          error: "Reminder not found",
        });
      }

      return {
        ok: true,
        guildId: params.guildId,
        reminderId: params.reminderId,
      };
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const signedSessionId = cookies[getSessionCookieName()];
    const sessionId = verifySignedSessionId(
      signedSessionId,
      env.SESSION_SECRET,
    );

    if (sessionId) {
      await clearDiscordSession(sessionId);
    }

    reply.header("Set-Cookie", [
      buildClearCookie(getSessionCookieName()),
      buildClearCookie(getStateCookieName()),
    ]);

    return { ok: true };
  });

  startRaidLogSync();
  startEventCloseSync();
  startEventRecurrenceSync();
  startKarutaAlbumImageSync();

  return app;
}
