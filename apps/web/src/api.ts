export type ApiGuild = {
  features: string[];
  icon: string | null;
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
};

export type AdminRoleRule = {
  modules: string[];
  roleId: string;
};

export type GuildConfig = {
  adminRoleModules?: AdminRoleRule[];
  bannedVoiceRoleIds?: string[];
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  karutaChannelId?: string;
  karutaRarePrintMax?: number;
  karutaRareWishlistMin?: number;
  karutaSuperRarePrintMax?: number;
  karutaSuperRareWishlistMin?: number;
  karutaUltraRarePrintMax?: number;
  karutaUltraRareWishlistMin?: number;
  karutaWatchEnabled?: boolean;
  logsChannelId?: string;
  logsWatchEnabled?: boolean;
  logsWatchGuild?: string;
  logsWatchRegion?: string;
  logsWatchServer?: string;
  memberLogChannelId?: string;
  musicEnabled?: boolean;
  musicRoleIds?: string[];
  suggestionsDmTiers?: string[];
};

export type DailyMessage = {
  content: string;
  createdAt: string;
  enabled: boolean;
  guildId: string;
  id: string;
  updatedAt: string;
};

export type RaidFightSummary = {
  difficulty?: number;
  fightPercentage?: number;
  kill?: boolean;
  name?: string;
};

export type RaidLog = {
  createdAt: string;
  discordPosted: boolean;
  error?: string;
  fightCount: number;
  firstFightAt?: string;
  guildId: string;
  hidden?: boolean;
  id: string;
  kills: number;
  lastSyncedAt?: string;
  reportCode: string;
  reportUrl: string;
  status: string;
  summary?: {
    fights: RaidFightSummary[];
    title?: string;
    zone?: number | null;
  };
  title?: string;
  updatedAt: string;
  zone?: number | null;
};

export type KarutaCard = {
  cardName?: string;
  code: string;
  createdAt: string;
  edition?: number;
  firstSeenAt: string;
  guildId: string;
  id: string;
  imageUrl?: string;
  lastSeenAt: string;
  ownerUserId?: string;
  ownerUsername?: string;
  printNumber?: number;
  series?: string;
  status: string;
  wishlistCount?: number;
};

export async function getKarutaCards(guildId: string): Promise<KarutaCard[]> {
  const data = await requestJson<{ cards: KarutaCard[] }>(
    `/guilds/${guildId}/karuta/cards`,
    { method: "GET" },
  );
  return data.cards;
}

export async function deleteKarutaCard(
  guildId: string,
  cardId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/karuta/cards/${encodeURIComponent(cardId)}`,
    { method: "DELETE" },
  );
}

export type KarutaAlbum = {
  albumName?: string;
  background?: string;
  createdAt: string;
  guildId: string;
  id: string;
  imageUrl?: string;
  images: Array<{ page: number; url: string }>;
  ownerUserId?: string;
  ownerUsername?: string;
  page?: number;
  totalPages?: number;
  updatedAt: string;
};

export async function getKarutaAlbums(guildId: string): Promise<KarutaAlbum[]> {
  const data = await requestJson<{ albums: KarutaAlbum[] }>(
    `/guilds/${guildId}/karuta/albums`,
    { method: "GET" },
  );
  return data.albums;
}

export async function deleteKarutaAlbum(
  guildId: string,
  albumId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/karuta/albums/${encodeURIComponent(albumId)}`,
    { method: "DELETE" },
  );
}

export type CommunicationInstance = {
  authorName?: string;
  channelId: string;
  communicationId: string;
  content: string;
  discordMessageIds: string[];
  id: string;
  publishedAt: string;
  tagColor?: string;
  tagLabel?: string;
  title: string;
};

export type Communication = {
  authorName?: string;
  channelId?: string;
  content: string;
  createdAt: string;
  guildId: string;
  id: string;
  instances: CommunicationInstance[];
  status: "draft" | "published";
  tagColor?: string;
  tagLabel?: string;
  title: string;
  updatedAt: string;
};

export type CommunicationInput = {
  authorName?: string;
  channelId?: string;
  content?: string;
  tagColor?: string;
  tagLabel?: string;
  title?: string;
};

export type GuildWidgetStatus = {
  available: boolean;
  boostCount: number | null;
  guildId: string;
  inviteUrl: string | null;
  memberCount: number | null;
  name?: string;
  presenceCount: number | null;
};

export type GuildBooster = {
  avatarUrl: string | null;
  nickname: string | null;
  premiumSince: string;
  userId: string;
  username: string;
};

export async function getGuildBoosters(
  guildId: string,
): Promise<GuildBooster[]> {
  const data = await requestJson<{ boosters: GuildBooster[] }>(
    `/guilds/${guildId}/boosters`,
    {
      method: "GET",
    },
  );

  return data.boosters;
}

export type GuildRole = {
  color: number;
  id: string;
  managed: boolean;
  name: string;
  position: number;
};

export type XpRoleMultiplier = {
  multiplier: number;
  roleId: string;
};

export type XpRoleRule = {
  addRoleIds: string[];
  color?: string;
  level: number;
  nicknamePrefix?: string;
  removeRoleIds: string[];
  roleId: string;
  stacking: "stack" | "replace";
};

export type XpConfig = {
  cooldownSeconds: number;
  guildId: string;
  levelBaseXp: number;
  levelRoles: XpRoleRule[];
  maxLevel: number;
  messageXp: number;
  roleMultipliers: XpRoleMultiplier[];
  roleStacking: "stack" | "replace";
  voiceXpPerMinute: number;
};

export type SessionResponse = {
  expiresAt: number;
  ok: true;
  user: {
    avatar: string | null;
    discriminator: string;
    global_name: string | null;
    id: string;
    username: string;
  };
};

export type MemberProfile = {
  accentColor: number | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  displayName: string;
  globalName: string | null;
  isBooster: boolean;
  joinedAt: string | null;
  roles: Array<{ color: number; id: string; name: string }>;
  serverAvatarUrl: string | null;
  userId: string;
  username: string;
};

export async function getMemberProfile(
  guildId: string,
  userId: string,
): Promise<MemberProfile | null> {
  const data = await requestJson<{ profile: MemberProfile }>(
    `/guilds/${guildId}/members/${encodeURIComponent(userId)}`,
    { method: "GET" },
  );
  return data.profile;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  // Solo mandamos Content-Type: application/json cuando hay body.
  // Fastify 5 responde 400 "Bad Request" a un POST/DELETE sin body pero
  // con ese content-type (FST_ERR_CTP_EMPTY_JSON_BODY).
  const hasBody =
    init?.body != null &&
    (typeof init.body === "string" ? init.body.length > 0 : true);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(
      typeof errorBody === "object" && errorBody && "error" in errorBody
        ? String((errorBody as { error?: unknown }).error)
        : `Request failed (${response.status})`,
    );
  }

  return (await response.json()) as T;
}

export function loginUrl(): string {
  return `${API_BASE_URL}/auth/discord/start`;
}

export async function getMe(): Promise<SessionResponse["user"] | null> {
  const response = await fetch(`${API_BASE_URL}/me`, {
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as SessionResponse;
  return data.user;
}

export async function getGuilds(): Promise<ApiGuild[]> {
  const response = await fetch(`${API_BASE_URL}/guilds`, {
    credentials: "include",
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { guilds: ApiGuild[] };
  return data.guilds;
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const data = await requestJson<{ config: GuildConfig }>(
    `/guilds/${guildId}/config`,
    {
      method: "GET",
    },
  );

  return data.config;
}

export async function getGuildWidgetStatus(
  guildId: string,
): Promise<GuildWidgetStatus> {
  const data = await requestJson<GuildWidgetStatus>(
    `/guilds/${guildId}/widget`,
    {
      method: "GET",
    },
  );

  return data;
}

export type GuildChannel = {
  id: string;
  name: string;
  type: number;
};

export async function getGuildVoiceChannels(
  guildId: string,
): Promise<GuildChannel[]> {
  const data = await requestJson<{ voiceChannels: GuildChannel[] }>(
    `/guilds/${guildId}/channels`,
    {
      method: "GET",
    },
  );

  return data.voiceChannels;
}

export async function getGuildTextChannels(
  guildId: string,
): Promise<GuildChannel[]> {
  const data = await requestJson<{ textChannels: GuildChannel[] }>(
    `/guilds/${guildId}/channels`,
    {
      method: "GET",
    },
  );

  return data.textChannels;
}

export async function getGuildRoles(guildId: string): Promise<GuildRole[]> {
  const data = await requestJson<{ roles: GuildRole[] }>(
    `/guilds/${guildId}/roles`,
    {
      method: "GET",
    },
  );

  return data.roles;
}

export type GuildEmoji = {
  animated: boolean;
  id: string;
  name: string;
};

// Emojis custom del servidor (para elegir el emoji de cada spec). Lo usa
// el staff desde el panel de catálogo de inscripciones.
export async function getGuildEmojis(guildId: string): Promise<GuildEmoji[]> {
  const data = await requestJson<{ emojis: GuildEmoji[] }>(
    `/guilds/${guildId}/emojis`,
    {
      method: "GET",
    },
  );

  return data.emojis;
}

export type GuildMember = {
  displayName: string;
  id: string;
  username: string;
};

export async function getGuildMembers(guildId: string): Promise<GuildMember[]> {
  const data = await requestJson<{ members: GuildMember[] }>(
    `/guilds/${guildId}/members`,
    {
      method: "GET",
    },
  );

  return data.members;
}

export async function getXpConfig(guildId: string): Promise<XpConfig> {
  const data = await requestJson<{ xpConfig: XpConfig }>(
    `/guilds/${guildId}/xp-config`,
    {
      method: "GET",
    },
  );

  return data.xpConfig;
}

export async function saveXpConfig(
  guildId: string,
  xpConfig: Partial<XpConfig>,
): Promise<XpConfig> {
  const data = await requestJson<{ xpConfig: XpConfig }>(
    `/guilds/${guildId}/xp-config`,
    {
      body: JSON.stringify(xpConfig),
      method: "PATCH",
    },
  );

  return data.xpConfig;
}

export type LeaderboardEntry = {
  avatarUrl: string | null;
  isBooster: boolean;
  level: number;
  messageCount: number;
  nickname: string | null;
  rank: number;
  userId: string;
  username: string | null;
  voiceMinutes: number;
  xp: number;
};

export async function getLeaderboard(
  guildId: string,
): Promise<LeaderboardEntry[]> {
  const data = await requestJson<{ leaderboard: LeaderboardEntry[] }>(
    `/guilds/${guildId}/xp/leaderboard`,
    {
      method: "GET",
    },
  );

  return data.leaderboard;
}

export type PublicLeaderboardEntry = {
  avatarUrl: string | null;
  isBooster: boolean;
  nickname: string | null;
  username: string | null;
};

// Leaderboard público para la landing (sin sesión).
export async function getPublicLeaderboard(): Promise<
  PublicLeaderboardEntry[]
> {
  const data = await requestJson<{ leaderboard: PublicLeaderboardEntry[] }>(
    "/public/leaderboard",
    { method: "GET" },
  );

  return data.leaderboard;
}

export type AuditLogEntry = {
  action: string;
  actorName: string | null;
  actorUserId: string | null;
  createdAt: string;
  details: string | null;
  guildId: string;
  id: string;
  targetId: string | null;
  targetType: string | null;
};

export async function getAuditLogs(guildId: string): Promise<AuditLogEntry[]> {
  const data = await requestJson<{ logs: AuditLogEntry[] }>(
    `/guilds/${guildId}/audit-logs`,
    {
      method: "GET",
    },
  );

  return data.logs;
}

export type XpProfileExportEntry = {
  messageCount: number;
  userId: string;
  voiceMinutes: number;
  xp: number;
};

export type XpExportPayload = {
  entries: XpProfileExportEntry[];
  exportedAt: string;
  guildId: string;
  ok: boolean;
  version: number;
};

export type XpImportEntry = {
  messageCount?: number;
  userId: string;
  voiceMinutes?: number;
  xp?: number;
  level?: number;
};

export async function exportXpData(guildId: string): Promise<XpExportPayload> {
  const data = await requestJson<XpExportPayload>(
    `/guilds/${guildId}/xp/export`,
    {
      method: "GET",
    },
  );

  return data;
}

export async function importXpData(
  guildId: string,
  entries: XpImportEntry[],
): Promise<{ imported: number }> {
  const data = await requestJson<{ imported: number }>(
    `/guilds/${guildId}/xp/import`,
    {
      method: "POST",
      body: JSON.stringify({ entries }),
    },
  );

  return data;
}

export async function resetAllXp(guildId: string): Promise<{ reset: number }> {
  const data = await requestJson<{ reset: number }>(
    `/guilds/${guildId}/xp/reset-all`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

  return data;
}

export async function requestXpSync(guildId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/guilds/${guildId}/xp/sync`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listDailyMessages(
  guildId: string,
): Promise<DailyMessage[]> {
  const data = await requestJson<{ messages: DailyMessage[] }>(
    `/guilds/${guildId}/daily-messages`,
    { method: "GET" },
  );
  return data.messages;
}

export async function createDailyMessage(
  guildId: string,
  content: string,
): Promise<DailyMessage> {
  const data = await requestJson<{ message: DailyMessage }>(
    `/guilds/${guildId}/daily-messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
  return data.message;
}

export async function updateDailyMessage(
  guildId: string,
  messageId: string,
  input: { content?: string; enabled?: boolean },
): Promise<DailyMessage> {
  const data = await requestJson<{ message: DailyMessage }>(
    `/guilds/${guildId}/daily-messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return data.message;
}

export async function deleteDailyMessage(
  guildId: string,
  messageId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/daily-messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
}

export async function listRaidLogs(guildId: string): Promise<RaidLog[]> {
  const data = await requestJson<{ logs: RaidLog[] }>(
    `/guilds/${guildId}/raid-logs`,
    { method: "GET" },
  );
  return data.logs;
}

export async function createRaidLog(
  guildId: string,
  url: string,
): Promise<{ log: RaidLog; posted?: boolean; error?: string }> {
  return requestJson<{ log: RaidLog; posted?: boolean; error?: string }>(
    `/guilds/${guildId}/raid-logs`,
    {
      method: "POST",
      body: JSON.stringify({ url }),
    },
  );
}

export async function hideRaidLog(
  guildId: string,
  logId: string,
): Promise<{ hidden: boolean }> {
  return requestJson<{ hidden: boolean }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}`,
    { method: "DELETE" },
  );
}

export async function restoreRaidLog(
  guildId: string,
  logId: string,
): Promise<{ shown: boolean }> {
  return requestJson<{ shown: boolean }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}/restore`,
    { method: "POST" },
  );
}

export async function deleteRaidLogPermanent(
  guildId: string,
  logId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}/permanent`,
    { method: "DELETE" },
  );
}

export async function listHiddenRaidLogs(guildId: string): Promise<RaidLog[]> {
  const data = await requestJson<{ logs: RaidLog[] }>(
    `/guilds/${guildId}/raid-logs/hidden`,
    { method: "GET" },
  );
  return data.logs;
}

export async function saveGuildConfig(
  guildId: string,
  config: GuildConfig,
): Promise<GuildConfig> {
  const data = await requestJson<{ config: GuildConfig }>(
    `/guilds/${guildId}/config`,
    {
      body: JSON.stringify(config),
      method: "PATCH",
    },
  );

  return data.config;
}

// ── Módulo X: eventos estilo Raid Helper ───────────────────────────
// Catálogo estático de clases, roles y tipos de evento para los selects.

export const WOW_CLASSES = [
  "Death Knight",
  "Demon Hunter",
  "Druid",
  "Evoker",
  "Hunter",
  "Mage",
  "Monk",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
] as const;

// Roles de combate estilo Raid Helper (4 ejes). Antes era tank/healer/dps;
// "dps" queda como valor legacy en inscripciones viejas.
export const RAID_ROLES = ["tank", "healer", "melee", "ranged"] as const;

export const COMBAT_ROLES = RAID_ROLES;

export const WOW_CLASS_META: Array<{
  color: string;
  emoji: string;
  key: string;
}> = [
  { key: "Death Knight", emoji: "💀", color: "#C41E3A" },
  { key: "Demon Hunter", emoji: "😈", color: "#A330C9" },
  { key: "Druid", emoji: "🌿", color: "#FF7C0A" },
  { key: "Evoker", emoji: "🐉", color: "#33937F" },
  { key: "Hunter", emoji: "🏹", color: "#AAD372" },
  { key: "Mage", emoji: "🔮", color: "#3FC7EB" },
  { key: "Monk", emoji: "🥋", color: "#00FF98" },
  { key: "Paladin", emoji: "⚜️", color: "#F48CBA" },
  { key: "Priest", emoji: "🙏", color: "#FFFFFF" },
  { key: "Rogue", emoji: "🗡️", color: "#FFF468" },
  { key: "Shaman", emoji: "⚡", color: "#0070DD" },
  { key: "Warlock", emoji: "🔥", color: "#8788EE" },
  { key: "Warrior", emoji: "⚔️", color: "#C69B6D" },
];

export const ROLE_META: Array<{
  emoji: string;
  key: string;
  label: string;
}> = [
  { key: "tank", emoji: "🛡️", label: "Tank" },
  { key: "healer", emoji: "💚", label: "Healer" },
  { key: "melee", emoji: "⚔️", label: "Melee" },
  { key: "ranged", emoji: "🏹", label: "Ranged" },
];

export function roleMeta(
  role?: string,
): { emoji: string; key: string; label: string } | undefined {
  if (role === "dps") {
    // Valor legacy previo a los 4 ejes.
    return { emoji: "⚔️", key: "dps", label: "DPS" };
  }
  return ROLE_META.find((entry) => entry.key === role);
}

// URL del CDN de Discord para un emoji custom (por id). Los emojis del
// servidor se sirven desde cdn.discordapp.com sin requerir autenticación.
export function discordEmojiUrl(
  emojiId?: string,
  animated?: boolean,
  size = 40,
): string | undefined {
  if (!emojiId) {
    return undefined;
  }
  return `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? "gif" : "png"}?size=${size}&quality=lossless`;
}

export function classEmoji(wowClass?: string): string {
  return WOW_CLASS_META.find((entry) => entry.key === wowClass)?.emoji ?? "❔";
}

// Las rutas propias del API (ej. las imágenes cacheadas de álbumes) llegan
// como path relativo ("/public/..."); acá les anteponemos la base del API.
export function apiAssetUrl(path: string): string {
  return path.startsWith("/") ? `${API_BASE_URL}${path}` : path;
}

export function classColor(wowClass?: string): string | undefined {
  return WOW_CLASS_META.find((entry) => entry.key === wowClass)?.color;
}

export const EVENT_TYPES: Array<{
  emoji: string;
  key: string;
  label: string;
}> = [
  { emoji: "⚔️", key: "raid", label: "Raid" },
  { emoji: "🗝️", key: "mplus", label: "M+" },
  { emoji: "🏆", key: "pvp", label: "PvP" },
  { emoji: "🎉", key: "social", label: "Social" },
];

// Opciones de publicación en Discord de un evento (Módulo X).
export type EventDiscordOptions = {
  createScheduledEvent: boolean;
  entityType: "voice" | "external";
  location?: string;
  publishChannelId?: string;
  publishMessage: boolean;
  recurrence: "none" | "daily" | "weekly" | "biweekly";
  voiceChannelId?: string;
};

export type HubEvent = {
  createdAt: string;
  createdByUserId?: string;
  createdByUsername?: string;
  description?: string;
  discordEventConfig?: {
    createScheduledEvent?: boolean;
    entityType?: "voice" | "external";
    location?: string;
    publishMessage?: boolean;
    recurrence?: "daily" | "weekly" | "biweekly";
  };
  discordEventId?: string;
  discordMessageIds?: string[];
  // Al marcar Completado, borra el aviso/evento de Discord tras guardar.
  discordCleanupOnComplete?: boolean;
  durationMinutes?: number;
  guildId: string;
  id: string;
  imageUrl?: string;
  // Pausa manual: frena recordatorios, recurrencia y anotaciones sin cancelar.
  paused?: boolean;
  publishChannelId?: string;
  // Recurrencia propia: cada X días se crea y publica una copia del evento.
  recurrenceEnabled?: boolean;
  recurrenceEveryDays?: number;
  recurrencePublishDaysBefore?: number;
  recurrenceNextAt?: string;
  // Rol de Discord mínimo para entrar al roster principal (yes sin rol→bench).
  requiredRoleId?: string;
  // Recordatorios de asistencia (horas antes de startsAt) que eligió el staff
  // para este evento. Vacío = sin recordatorios.
  reminderHours?: number[];
  signupDeadline?: string;
  startsAt: string;
  status: string;
  title: string;
  type: string;
  updatedAt: string;
  voiceChannelId?: string;
  signups: EventSignup[];
};

export type EventSignup = {
  character?: string;
  createdAt: string;
  guildId: string;
  id: string;
  note?: string;
  role?: string;
  spec?: string;
  status: string;
  updatedAt: string;
  userId: string;
  username: string;
  wowClass?: string;
};

export async function getEvents(guildId: string): Promise<HubEvent[]> {
  const data = await requestJson<{ events: HubEvent[] }>(
    `/guilds/${guildId}/events`,
    { method: "GET" },
  );
  return data.events;
}

export async function createEvent(
  guildId: string,
  input: {
    description?: string;
    discord?: EventDiscordOptions;
    discordCleanupOnComplete?: boolean;
    durationMinutes?: number;
    imageUrl?: string;
    paused?: boolean;
    recurrenceEnabled?: boolean;
    recurrenceEveryDays?: number;
    recurrencePublishDaysBefore?: number;
    reminderHours?: number[];
    requiredRoleId?: string;
    signupDeadline?: string;
    startsAt: string;
    title: string;
    type: string;
  },
): Promise<{ discordError?: string; event: HubEvent }> {
  const data = await requestJson<{
    discordError?: string;
    event: HubEvent;
  }>(`/guilds/${guildId}/events`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { discordError: data.discordError, event: data.event };
}

export async function updateEvent(
  guildId: string,
  eventId: string,
  input: {
    description?: string;
    discord?: EventDiscordOptions;
    discordCleanupOnComplete?: boolean;
    durationMinutes?: number | null;
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
  },
): Promise<{ discordError?: string; event: HubEvent }> {
  const data = await requestJson<{
    discordError?: string;
    event: HubEvent;
  }>(`/guilds/${guildId}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return { discordError: data.discordError, event: data.event };
}

export async function deleteEvent(
  guildId: string,
  eventId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

export async function upsertEventSignup(
  guildId: string,
  eventId: string,
  input: {
    character?: string;
    note?: string;
    role?: string;
    spec?: string;
    status: string;
    wowClass?: string;
  },
): Promise<EventSignup> {
  const data = await requestJson<{ signup: EventSignup }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/signups`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return data.signup;
}

export async function deleteMyEventSignup(
  guildId: string,
  eventId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/signups/me`,
    { method: "DELETE" },
  );
}

// ── Catálogo de specs de inscripción (estilo Raid Helper) ───────────

export type RaidSpec = {
  animated: boolean;
  className: string;
  createdAt: string;
  emojiId?: string;
  emojiName?: string;
  guildId: string;
  id: string;
  position: number;
  role: string;
  specName: string;
  updatedAt: string;
};

export async function getEventSpecs(guildId: string): Promise<RaidSpec[]> {
  const data = await requestJson<{ specs: RaidSpec[] }>(
    `/guilds/${guildId}/events/specs`,
    { method: "GET" },
  );
  return data.specs;
}

export async function createEventSpec(
  guildId: string,
  input: {
    animated?: boolean;
    className: string;
    emojiId?: string;
    emojiName?: string;
    role: string;
    specName: string;
  },
): Promise<RaidSpec> {
  const data = await requestJson<{ spec: RaidSpec }>(
    `/guilds/${guildId}/events/specs`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.spec;
}

export async function deleteEventSpec(
  guildId: string,
  specId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/events/specs/${encodeURIComponent(specId)}`,
    { method: "DELETE" },
  );
}

export async function updateEventSpec(
  guildId: string,
  specId: string,
  input: {
    animated?: boolean;
    className?: string;
    emojiId?: string | null;
    emojiName?: string | null;
    role?: string;
    specName?: string;
  },
): Promise<RaidSpec> {
  const data = await requestJson<{ spec: RaidSpec }>(
    `/guilds/${guildId}/events/specs/${encodeURIComponent(specId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return data.spec;
}

export type EventImage = {
  createdAt: string;
  dataUrl: string;
  guildId: string;
  id: string;
  name?: string;
  updatedAt: string;
};

export async function getEventImages(guildId: string): Promise<EventImage[]> {
  const data = await requestJson<{ images: EventImage[] }>(
    `/guilds/${guildId}/events/images`,
    { method: "GET" },
  );
  return data.images;
}

export async function uploadEventImage(
  guildId: string,
  input: { dataUrl: string; name?: string },
): Promise<EventImage> {
  const data = await requestJson<{ image: EventImage }>(
    `/guilds/${guildId}/events/images`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.image;
}

export async function deleteEventImage(
  guildId: string,
  imageId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/events/images/${encodeURIComponent(imageId)}`,
    { method: "DELETE" },
  );
}

export async function submitSuggestion(
  guildId: string,
  title: string,
  text: string,
): Promise<void> {
  await requestJson<{ ok: boolean; sent: boolean }>(
    `/guilds/${guildId}/suggestions`,
    {
      body: JSON.stringify({ title, text }),
      method: "POST",
    },
  );
}

export type AdminAccess = {
  modules: string[];
  owner: boolean;
};

export async function getAdminAccess(guildId: string): Promise<AdminAccess> {
  const data = await requestJson<{ modules: string[]; owner: boolean }>(
    `/guilds/${guildId}/admin-access`,
  );
  return {
    modules: data.modules ?? [],
    owner: data.owner ?? false,
  };
}

export async function listCommunications(
  guildId: string,
): Promise<Communication[]> {
  const data = await requestJson<{ communications: Communication[] }>(
    `/guilds/${guildId}/communications`,
  );
  return data.communications;
}

export async function listPublishedCommunications(
  guildId: string,
): Promise<CommunicationInstance[]> {
  const data = await requestJson<{ communications: CommunicationInstance[] }>(
    `/guilds/${guildId}/communications/published`,
  );
  return data.communications;
}

export async function createCommunication(
  guildId: string,
  input: CommunicationInput,
): Promise<Communication> {
  const data = await requestJson<{ communication: Communication }>(
    `/guilds/${guildId}/communications`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
  return data.communication;
}

export async function updateCommunication(
  guildId: string,
  communicationId: string,
  input: CommunicationInput,
): Promise<Communication> {
  const data = await requestJson<{ communication: Communication }>(
    `/guilds/${guildId}/communications/${communicationId}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
  return data.communication;
}

export async function deleteCommunication(
  guildId: string,
  communicationId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/communications/${communicationId}`,
    { method: "DELETE" },
  );
}

export async function publishCommunication(
  guildId: string,
  communicationId: string,
): Promise<CommunicationInstance> {
  const data = await requestJson<{ instance: CommunicationInstance }>(
    `/guilds/${guildId}/communications/${communicationId}/publish`,
    { method: "POST" },
  );
  return data.instance;
}

export async function deleteCommunicationInstance(
  guildId: string,
  communicationId: string,
  instanceId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/communications/${communicationId}/instances/${instanceId}`,
    { method: "DELETE" },
  );
}

export async function updateCommunicationInstance(
  guildId: string,
  communicationId: string,
  instanceId: string,
  input: {
    content: string;
    tagColor?: string;
    tagLabel?: string;
    title: string;
  },
): Promise<CommunicationInstance> {
  const data = await requestJson<{ instance: CommunicationInstance }>(
    `/guilds/${guildId}/communications/${communicationId}/instances/${instanceId}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
  return data.instance;
}

export async function logout(): Promise<void> {
  await requestJson<{ ok: true }>("/auth/logout", {
    method: "POST",
  });
}
