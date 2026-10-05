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
  eventGames?: EventGameConfig[];
  eventReportChannelId?: string;
  eventReportRoleId?: string;
  eventRoles?: EventRoleOption[];
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
  discordChannelId?: string;
  discordMessageId?: string;
  discordPosted: boolean;
  error?: string;
  fightCount: number;
  firstFightAt?: string;
  // Entrada a la que pertenece: los reports de la misma noche y título salen
  // juntos en un solo mensaje.
  groupKey: string;
  guildId: string;
  hidden?: boolean;
  id: string;
  kills: number;
  lastSyncedAt?: string;
  // La entrada está publicada pero el mensaje quedó viejo (el log creció
  // después): el API lo corrige solo en el próximo ciclo del scheduler.
  needsUpdate?: boolean;
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

export type RaidRole = "dps" | "healer" | "tank";

export type RaidLogAttendancePlayer = {
  class?: string;
  name: string;
  pulls: number;
  role?: RaidRole;
};

export type RaidLogAttendance = {
  event?: { id: string; startsAt: string; title: string };
  partial: boolean;
  players: RaidLogAttendancePlayer[];
  signedAbsent: Array<{ name: string; status: string }>;
  signedPresent: number;
  signedTotal: number;
  totalPulls: number;
  unmatchedSignups: Array<{ name: string; status: string }>;
  unsignedPresent: Array<{ name: string; pulls: number; status?: string }>;
};

export type RaidConsumableKey =
  | "flask"
  | "food"
  | "healthPotions"
  | "healthstones"
  | "potions"
  | "prepot"
  | "runes";

export type RaidLogConsumables = {
  categories: RaidConsumableKey[];
  players: Array<{
    class?: string;
    counts: Partial<Record<RaidConsumableKey, number>>;
    name: string;
    pulls: number;
    role?: RaidRole;
  }>;
  pulls: Array<{
    missing: Partial<Record<RaidConsumableKey, string[]>>;
    name: string;
    participants: number;
    used: Partial<Record<RaidConsumableKey, number>>;
  }>;
};

export type RaidLogAnalysis = {
  attendance?: RaidLogAttendance;
  averageDps: Array<{
    averageDps: number;
    class?: string;
    encounters: number;
    name: string;
    role?: RaidRole;
    totalDamage: number;
  }>;
  consumables?: RaidLogConsumables;
  deathsByAbility: Array<{ ability: string; deaths: number }>;
  deathsByPlayer: Array<{ deaths: number; name: string }>;
  encounters: Array<{
    deaths: number;
    durationSeconds: number;
    kill: boolean;
    name: string;
    topDps?: { dps: number; name: string };
  }>;
  generatedAt: string;
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

export type Communication = {
  authorName?: string;
  channelId?: string;
  content: string;
  createdAt: string;
  // IDs de los mensajes en Discord (varios si el texto se partió).
  discordMessageIds: string[];
  guildId: string;
  id: string;
  // Lugar que ocupa la tarjeta en el tablero del hub (0 = primera).
  position: number;
  // Última publicación (vacío = borrador).
  publishedAt?: string;
  status: "draft" | "published";
  // Etiquetas visibles en la web (puede tener varias, igual que los eventos).
  tags?: EventTag[];
  title: string;
  updatedAt: string;
};

export type CommunicationInput = {
  authorName?: string;
  channelId?: string;
  content?: string;
  tags?: EventTag[];
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

export type GuildGameActivity = {
  applicationId?: string;
  coverUrl?: string;
  days: number;
  name: string;
  players: number;
};

export type GuildGameActivityResponse = {
  days: number;
  games: GuildGameActivity[];
  // "activity" = medido por el bot; "configured" = juegos configurados del
  // módulo de eventos, para cuando todavía no hay actividad registrada.
  source: "activity" | "configured";
};

export async function getGuildGameActivity(
  guildId: string,
  days = 30,
): Promise<GuildGameActivityResponse> {
  return requestJson<GuildGameActivityResponse>(
    `/guilds/${guildId}/games/activity?days=${days}`,
    { method: "GET" },
  );
}

export type GuildRole = {
  color: number;
  id: string;
  managed: boolean;
  name: string;
  position: number;
  // Segundo color del degradado del rol (si lo tiene).
  secondaryColor?: number;
};

export type XpRoleMultiplier = {
  multiplier: number;
  roleId: string;
};

export type XpRoleRule = {
  addRoleIds: string[];
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
  roles: Array<{
    color: number;
    id: string;
    name: string;
    // Segundo color del degradado (roles "Nitro" de Discord); sin él el rol
    // se pinta de un solo color.
    secondaryColor?: number;
  }>;
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

// Sin timeout, una petición que queda colgada (p. ej. la API reiniciándose
// detrás de Cloudflare) nunca se resuelve: la UI se queda cargando para
// siempre y no hay forma de reintentar. Las operaciones que de verdad pueden
// tardar pasan `0` para esperar sin límite.
const DEFAULT_TIMEOUT_MS = 30_000;

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  // Solo mandamos Content-Type: application/json cuando hay body.
  // Fastify 5 responde 400 "Bad Request" a un POST/DELETE sin body pero
  // con ese content-type (FST_ERR_CTP_EMPTY_JSON_BODY).
  const hasBody =
    init?.body != null &&
    (typeof init.body === "string" ? init.body.length > 0 : true);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
    ...(timeoutMs > 0 && !init?.signal
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let errorBody: unknown = null;
    try {
      errorBody = raw ? JSON.parse(raw) : null;
    } catch {
      errorBody = null;
    }
    // Sin JSON (p. ej. la página 502 de un proxy) el status solo no dice
    // nada: mostramos qué devolvió realmente la petición.
    const contentType = response.headers.get("content-type") ?? "";
    const fallback = contentType.includes("text/html")
      ? `Request failed (${response.status}): el proxy devolvió HTML, no JSON del API.`
      : raw.trim()
        ? `Request failed (${response.status}): ${raw.trim().slice(0, 180)}`
        : `Request failed (${response.status})`;
    throw new Error(
      typeof errorBody === "object" && errorBody && "error" in errorBody
        ? String((errorBody as { error?: unknown }).error)
        : fallback,
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
    signal: AbortSignal.timeout(15_000),
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
    signal: AbortSignal.timeout(15_000),
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

// ── Roles del servidor (Admin → Roles) ─────────────────────────────
// Discord no tiene "duplicar rol" ni plantillas: el hub lo hace por API.

export type GuildRoleDetail = GuildRole & {
  hoist: boolean;
  mentionable: boolean;
  // Bitfield de permisos como texto, igual que lo manda Discord.
  permissions: string;
  unicodeEmoji?: string;
};

export type GuildRolesResponse = {
  // Posición del rol más alto del bot: arriba de eso Discord rechaza mover.
  botTopPosition: number;
  roles: GuildRoleDetail[];
};

export async function getGuildRolesDetailed(
  guildId: string,
): Promise<GuildRolesResponse> {
  const data = await requestJson<{
    botTopPosition?: number;
    roles: GuildRoleDetail[];
  }>(`/guilds/${guildId}/roles`, { method: "GET" });

  return { botTopPosition: data.botTopPosition ?? 0, roles: data.roles };
}

export type RoleWritePayload = {
  color?: string;
  colorSecondary?: string;
  // Duplica un rol existente (copia color, permisos, hoist y mentionable).
  duplicateOf?: string;
  hoist?: boolean;
  mentionable?: boolean;
  name?: string;
  permissions?: string;
  // Ubica el rol nuevo justo debajo de ese rol.
  positionBelowRoleId?: string;
};

export type RoleMutationResult = {
  positionError?: string;
  positionMoved: boolean;
  role: GuildRoleDetail;
};

export async function createGuildRole(
  guildId: string,
  input: RoleWritePayload,
): Promise<RoleMutationResult> {
  return requestJson<RoleMutationResult>(`/guilds/${guildId}/roles`, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export async function createGuildRolesBulk(
  guildId: string,
  input: {
    color?: string;
    colorTo?: string;
    hoist?: boolean;
    mentionable?: boolean;
    names: string[];
    permissions?: string;
  },
): Promise<{
  created: Array<{ color: number; id: string; name: string }>;
  failed: Array<{ error: string; name: string }>;
}> {
  const data = await requestJson<{
    created: Array<{ color: number; id: string; name: string }>;
    failed: Array<{ error: string; name: string }>;
  }>(`/guilds/${guildId}/roles/bulk`, {
    body: JSON.stringify(input),
    method: "POST",
  });

  return { created: data.created, failed: data.failed };
}

export async function updateGuildRole(
  guildId: string,
  roleId: string,
  input: {
    color?: string;
    colorSecondary?: string;
    hoist?: boolean;
    mentionable?: boolean;
    name?: string;
    permissions?: string;
    position?: number;
  },
): Promise<RoleMutationResult> {
  return requestJson<RoleMutationResult>(
    `/guilds/${guildId}/roles/${encodeURIComponent(roleId)}`,
    { body: JSON.stringify(input), method: "PATCH" },
  );
}

export async function deleteGuildRole(
  guildId: string,
  roleId: string,
): Promise<boolean> {
  const data = await requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/roles/${encodeURIComponent(roleId)}`,
    { method: "DELETE" },
  );

  return data.deleted;
}

// Plantillas de rol: datos de un rol modelo para crearlo con un click.
export type RoleTemplate = {
  color: string;
  // Segundo color cuando la plantilla usa degradado (null = plano).
  colorSecondary: string | null;
  hoist: boolean;
  id: string;
  label: string;
  mentionable: boolean;
  permissions: string;
};

export async function getRoleTemplates(
  guildId: string,
): Promise<RoleTemplate[]> {
  const data = await requestJson<{ templates: RoleTemplate[] }>(
    `/guilds/${guildId}/role-templates`,
    { method: "GET" },
  );

  return data.templates;
}

export async function saveRoleTemplate(
  guildId: string,
  input: {
    color: string;
    colorSecondary?: string | null;
    hoist: boolean;
    label: string;
    mentionable: boolean;
    permissions: string;
  },
): Promise<RoleTemplate> {
  const data = await requestJson<{ template: RoleTemplate }>(
    `/guilds/${guildId}/role-templates`,
    { body: JSON.stringify(input), method: "POST" },
  );

  return data.template;
}

export async function deleteRoleTemplate(
  guildId: string,
  templateId: string,
): Promise<boolean> {
  const data = await requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/role-templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" },
  );

  return data.deleted;
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

// Informe de asistencia en CSV (lo arma el API: los anotados con su estado y
// quiénes tienen el rol mínimo y no se anotaron).
export async function getEventReportCsv(
  guildId: string,
  eventId: string,
): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/guilds/${guildId}/events/${eventId}/report.csv`,
    { credentials: "include" },
  );

  if (!response.ok) {
    throw new Error(`No se pudo generar el informe (${response.status})`);
  }

  return response.text();
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

// Encola la re-sincronización de roles/prefijos (la ejecuta el bot) y limpia
// del ranking a quienes ya no están en el servidor. Devuelve cuántos perfiles
// se quitaron.
export async function requestXpSync(
  guildId: string,
): Promise<{ removed: number }> {
  const data = await requestJson<{ ok: boolean; removed?: number }>(
    `/guilds/${guildId}/xp/sync`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
  return { removed: data.removed ?? 0 };
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

export async function getRaidLogAnalysis(
  guildId: string,
  logId: string,
): Promise<RaidLogAnalysis> {
  const data = await requestJson<{ analysis: RaidLogAnalysis }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}/analysis`,
    { method: "GET" },
    90_000,
  );
  return data.analysis;
}

export async function createRaidLog(
  guildId: string,
  url: string,
): Promise<{ error?: string; log: RaidLog }> {
  return requestJson<{ error?: string; log: RaidLog }>(
    `/guilds/${guildId}/raid-logs`,
    {
      method: "POST",
      body: JSON.stringify({ url }),
    },
  );
}

// Escaneo manual: fuerza la detección en Warcraft Logs y refresca los
// borradores (para ver los números finales cuando ya se subió todo).
export async function scanRaidLogs(
  guildId: string,
): Promise<{ detected: number; logs: RaidLog[] }> {
  // Consulta Warcraft Logs report por report: puede tardar minutos.
  return requestJson<{ detected: number; logs: RaidLog[] }>(
    `/guilds/${guildId}/raid-logs/scan`,
    { method: "POST" },
    0,
  );
}

// Publica la entrada completa (todas las partes de la misma noche).
export async function publishRaidLog(
  guildId: string,
  logId: string,
): Promise<{ logs: RaidLog[] }> {
  return requestJson<{ logs: RaidLog[] }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}/publish`,
    { method: "POST" },
  );
}

// Re-escanea la entrada y edita el mensaje ya publicado si cambió.
export async function updateRaidLogMessage(
  guildId: string,
  logId: string,
): Promise<{ logs: RaidLog[]; updated: boolean }> {
  // Re-escanea la entrada en Warcraft Logs antes de editar: sin límite.
  return requestJson<{ logs: RaidLog[]; updated: boolean }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}/refresh`,
    { method: "POST" },
    0,
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
  { key: "ranged", emoji: "🏹", label: "Range" },
];

// ── Roles de evento configurables ──────────────────────────────────
// Cada JUEGO define sus roles de inscripción (label + emoji, unicode o custom
// de Discord) y cada evento elige juego. Así el módulo sirve para WoW
// (tank/healer/melee/ranged), LoL (Top/Jungle/Mid/ADC/Support) u otro.
export type EventRoleOption = {
  animated: boolean;
  emoji?: string;
  emojiId?: string;
  emojiName?: string;
  key: string;
  label: string;
};

// Juego del módulo de eventos: sus roles de inscripción. El catálogo de
// clases/specs vive en RaidSpec con el mismo `key` en `game`.
export type EventGameConfig = {
  key: string;
  label: string;
  roles: EventRoleOption[];
};

export const DEFAULT_EVENT_ROLES: EventRoleOption[] = ROLE_META.map(
  (entry) => ({
    animated: false,
    emoji: entry.emoji,
    key: entry.key,
    label: entry.label,
  }),
);

// Corrección de etiquetas guardadas: el rol `ranged` se muestra como "Range"
// (la clave se conserva porque está guardada en las inscripciones).
export function normalizeEventRoles(
  roles: EventRoleOption[],
): EventRoleOption[] {
  return roles.map((role) =>
    role.key === "ranged" && /^ranged$/i.test(role.label)
      ? { ...role, label: "Range" }
      : role,
  );
}

// Roles de un juego según la config, sin depender del endpoint de juegos (que
// trae las plantillas del código). Se usa como respaldo cuando los juegos
// todavía no se cargaron: el primero configurado o los 4 clásicos.
export function resolveEventRoles(
  config: GuildConfig,
  game?: string,
): EventRoleOption[] {
  const games = config.eventGames ?? [];
  const entry = game ? games.find((item) => item.key === game) : games[0];
  const roles = entry?.roles;
  if (!roles || roles.length === 0) {
    return DEFAULT_EVENT_ROLES;
  }
  return normalizeEventRoles(roles);
}

// Meta de un rol dentro de la lista de roles de un juego, con fallback a los
// clásicos (y al "dps" legacy de inscripciones viejas).
export function eventRoleMeta(
  role: string | undefined,
  roles: EventRoleOption[],
): EventRoleOption | undefined {
  if (role === "dps") {
    return { animated: false, emoji: "⚔️", key: "dps", label: "DPS" };
  }
  const configured = roles.find((entry) => entry.key === role);
  if (configured) {
    return configured;
  }
  // Rol que ya NO está en el juego (le cambiaron el juego al evento o se borró
  // el rol) pero sigue guardado en inscripciones viejas: mostramos su icono
  // clásico igual, para que el roster no quede con "❔ healer".
  const classic = ROLE_META.find((entry) => entry.key === role);
  return classic
    ? {
        animated: false,
        emoji: classic.emoji,
        key: classic.key,
        label: classic.label,
      }
    : undefined;
}

export function roleMeta(
  role?: string,
): { emoji: string; key: string; label: string } | undefined {
  if (role === "dps") {
    // Valor legacy previo a los 4 ejes.
    return { emoji: "⚔️", key: "dps", label: "DPS" };
  }
  return ROLE_META.find((entry) => entry.key === role);
}

// Discord solo acepta tamaños potencia de 2 (16..4096); cualquier otro valor
// hace que el CDN responda 400 y el navegador muestre el recuadro roto.
const EMOJI_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

function normalizeEmojiSize(size: number): number {
  return EMOJI_SIZES.find((candidate) => candidate >= size) ?? 4096;
}

// URL del CDN de Discord para un emoji custom (por id). Los emojis del
// servidor se sirven desde cdn.discordapp.com sin requerir autenticación.
// Para estáticos usamos .webp (también sirve GIFs animados), así no se rompe
// si el flag `animated` quedó mal guardado.
export function discordEmojiUrl(
  emojiId?: string,
  animated?: boolean,
  size = 40,
): string | undefined {
  if (!emojiId) {
    return undefined;
  }
  const extension = animated ? "gif" : "webp";
  return `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=${normalizeEmojiSize(size)}&quality=lossless`;
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

export type EventTag = {
  color: string;
  label: string;
};

export type EventTagInput = {
  color?: string;
  label?: string;
};

export type HubEvent = {
  // Si el evento pide (y recuerda) el nombre de personaje al anotarse.
  characterEnabled?: boolean;
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
  // Control del roster: cuántos miembros tienen el rol mínimo o el de Bench del
  // roster (el total contra el que se compara la asistencia) y cuántos todavía
  // no respondieron.
  benchExpectedCount?: number;
  expectedCount?: number;
  missingCount?: number;
  // Juego del evento (wow | lol | …): decide qué roles de inscripción y qué
  // catálogo de clases/specs se usan en el selector, el roster y el aviso.
  game?: string;
  guildId: string;
  id: string;
  imageUrl?: string;
  // Pausa manual: frena recordatorios, recurrencia y anotaciones sin cancelar.
  paused?: boolean;
  // Mensaje de la encuesta nativa de Discord (plantilla "encuesta").
  discordPollMessageId?: string;
  publishChannelId?: string;
  // Duración de la encuesta en horas (vacío = sin límite).
  pollHours?: number;
  // Recurrencia propia: cada X días se crea y publica una copia del evento.
  recurrenceEnabled?: boolean;
  recurrenceEveryDays?: number;
  recurrencePublishDaysBefore?: number;
  recurrenceNextAt?: string;
  // Rol de Discord mínimo para entrar al roster principal (yes sin rol→bench).
  requiredRoleId?: string;
  // Nombre del rol mínimo, resuelto por el API (así la tarjeta no muestra
  // primero un placeholder y después el nombre real).
  requiredRoleName?: string;
  // Recordatorios de asistencia (horas antes de startsAt) que eligió el staff
  // para este evento. Vacío = sin recordatorios.
  reminderHours?: number[];
  signupDeadline?: string;
  startsAt: string;
  status: string;
  // Etiquetas libres del evento (texto + color).
  tags?: EventTag[];
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
  // Clase del roster de quien no eligió una al anotarse (en Discord el botón de
  // "no asisto" no abre el asistente). Es para el emoji: la inscripción sigue
  // sin clase y no cambia de columna.
  rosterClass?: { className: string; specName: string };
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

// Detalle del roster esperado de un evento: quiénes tienen el rol mínimo o el
// de Bench del roster, quiénes ya respondieron y quiénes faltan (lo pide el
// contador "N/M" al clickearse).
export type EventRoster = {
  benchCount: number;
  confirmedCount: number;
  expectedCount: number;
  missing: Array<{ bench?: boolean; userId: string; username: string }>;
  requiredRoleId?: string;
  signedCount: number;
};

export async function getEventRoster(
  guildId: string,
  eventId: string,
): Promise<EventRoster> {
  return requestJson<EventRoster>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/roster`,
    { method: "GET" },
  );
}

// ── Roster de raids ─────────────────────────────────────────────────

export type RosterRankKey = "bench" | "guild" | "raid";

// Ficha del roster: clase + spec actual + las off que domina (claves del
// catálogo, que es de donde salen los emojis).
export type RosterAlt = {
  className: string;
  game?: string;
  offSpecs?: string[];
  specName: string;
};

export type RosterProfileInput = {
  active?: boolean;
  alts?: RosterAlt[];
  className: string;
  game?: string;
  offSpecs?: string[];
  specName: string;
  tags?: EventTag[];
};

export type RosterProfile = {
  active: boolean;
  className: string;
  game: string;
  offSpecs: string[];
  specName: string;
  tags: EventTag[];
};

export type RosterMember = {
  // Clases secundarias ("alter"): carta de atrás de la misma persona. Nunca
  // suman a los totales del roster.
  alts?: RosterAlt[];
  displayName: string;
  // Ser Raid Officer va aparte del estado: se puede ser Raid Officer e inactivo.
  isRaidOfficer: boolean;
  profile: RosterProfile | null;
  // null = tiene ficha pero ninguno de los roles de estado.
  rankKey: RosterRankKey | null;
  userId: string;
};

export type RosterRank = {
  key: RosterRankKey;
  label: string;
  roleId?: string;
};

export type GuildRoster = {
  classEmojis?: Record<string, MappingEmoji>;
  games: Array<{ key: string; label: string }>;
  members: RosterMember[];
  ranks: RosterRank[];
  roles: EventRoleOption[];
  specs: RaidSpec[];
};

export async function getGuildRoster(guildId: string): Promise<GuildRoster> {
  return requestJson<GuildRoster>(`/guilds/${guildId}/roster`, {
    method: "GET",
  });
}

// El guardado puede completarse con la ficha persistida y el rol de raid sin
// sincronizar: `roleSyncError` trae el motivo para avisar sin perder el guardado.
export type RosterProfileSave = {
  alts?: RosterAlt[];
  profile: RosterProfile;
  roleSyncError?: string;
};

export async function saveMyRosterProfile(
  guildId: string,
  input: RosterProfileInput,
): Promise<RosterProfileSave> {
  return requestJson<RosterProfileSave>(`/guilds/${guildId}/roster/me`, {
    body: JSON.stringify(input),
    method: "PUT",
  });
}

export async function saveMemberRosterProfile(
  guildId: string,
  userId: string,
  input: RosterProfileInput,
): Promise<RosterProfileSave> {
  return requestJson<RosterProfileSave>(
    `/guilds/${guildId}/roster/${encodeURIComponent(userId)}`,
    { body: JSON.stringify(input), method: "PUT" },
  );
}

export async function deleteMemberRosterProfile(
  guildId: string,
  userId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/roster/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

export async function saveRosterRanks(
  guildId: string,
  ranks: Record<string, string>,
): Promise<RosterRank[]> {
  const data = await requestJson<{ ranks: RosterRank[] }>(
    `/guilds/${guildId}/roster/ranks`,
    { body: JSON.stringify({ ranks }), method: "PUT" },
  );
  return data.ranks;
}

// Estado de una ficha en el roster. Es lo que mueve los roles en Discord:
// `null` lo deja fuera del roster.
export async function setRosterRank(
  guildId: string,
  userId: string,
  rank: RosterRankKey | null,
): Promise<{ rank: RosterRankKey | null; roleSyncError?: string }> {
  return requestJson<{ rank: RosterRankKey | null; roleSyncError?: string }>(
    `/guilds/${guildId}/roster/${encodeURIComponent(userId)}/rank`,
    { body: JSON.stringify({ rank }), method: "PUT" },
  );
}

// ── Registro central de mapeos ──────────────────────────────────────
// Vínculo entre una entidad de la app (un rango del roster, una clase) y su
// rol/emoji de Discord. El catálogo lo arma el API; la guild solo elige.

export type MappingEmoji = {
  animated?: boolean;
  emojiId?: string;
  emojiName?: string;
  unicode?: string;
};

export type MappingRow = {
  emoji?: MappingEmoji;
  key: string;
  label: string;
  roleId?: string;
};

export type MappingGroup = {
  key: string;
  label: string;
  rows: MappingRow[];
};

export async function getGuildMappings(
  guildId: string,
): Promise<MappingGroup[]> {
  const data = await requestJson<{ groups: MappingGroup[] }>(
    `/guilds/${guildId}/mappings`,
    { method: "GET" },
  );
  return data.groups;
}

export async function saveGuildMappings(
  guildId: string,
  mappings: Array<{ emoji?: MappingEmoji; key: string; roleId?: string }>,
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/guilds/${guildId}/mappings`, {
    body: JSON.stringify({ mappings }),
    method: "PUT",
  });
}

export async function createEvent(
  guildId: string,
  input: {
    characterEnabled?: boolean;
    description?: string;
    discord?: EventDiscordOptions;
    discordCleanupOnComplete?: boolean;
    durationMinutes?: number;
    // Juego del evento (wow | lol | …): define roles y catálogo.
    game?: string;
    imageUrl?: string;
    paused?: boolean;
    // Duración de la encuesta de Discord en horas (solo juegos de encuesta).
    pollHours?: number;
    recurrenceEnabled?: boolean;
    recurrenceEveryDays?: number;
    recurrencePublishDaysBefore?: number;
    reminderHours?: number[];
    requiredRoleId?: string;
    signupDeadline?: string;
    startsAt: string;
    tags?: EventTagInput[];
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
    characterEnabled?: boolean;
    description?: string;
    discord?: EventDiscordOptions;
    discordCleanupOnComplete?: boolean;
    durationMinutes?: number | null;
    game?: string;
    imageUrl?: string;
    paused?: boolean;
    // Duración de la encuesta de Discord en horas (null = sin límite).
    pollHours?: number | null;
    recurrenceEnabled?: boolean;
    recurrenceEveryDays?: number;
    recurrencePublishDaysBefore?: number;
    reminderHours?: number[];
    requiredRoleId?: string;
    signupDeadline?: string | null;
    startsAt?: string;
    status?: string;
    tags?: EventTagInput[];
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

// Limpia la ocurrencia de una serie: borra el aviso/recordatorios en Discord y
// las inscripciones, y mueve el molde a la próxima fecha (la serie sigue viva).
export async function resetEventOccurrence(
  guildId: string,
  eventId: string,
): Promise<{
  discordError?: string;
  discordFailed?: string[];
  event: HubEvent;
  removedSignups: number;
}> {
  return requestJson<{
    discordError?: string;
    discordFailed?: string[];
    event: HubEvent;
    removedSignups: number;
  }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/reset-occurrence`,
    {
      method: "POST",
    },
  );
}

export async function deleteEvent(
  guildId: string,
  eventId: string,
): Promise<{ deleted: boolean; discordFailed?: string[] }> {
  return requestJson<{ deleted: boolean; discordFailed?: string[] }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

// ── Edición manual de inscripciones (staff) ────────────────────────
// El staff con acceso a eventos puede corregir la inscripción de cualquier
// miembro: estado, rol, clase/spec, personaje y nota. Con `notify` además le
// avisa por mensaje directo de Discord qué le cambiaron.
export type StaffSignupResult = {
  notified: boolean;
  notifyError?: string;
  signup: EventSignup;
};

export async function upsertMemberEventSignup(
  guildId: string,
  eventId: string,
  userId: string,
  input: {
    character?: string;
    note?: string;
    notify?: boolean;
    role?: string;
    spec?: string;
    status: string;
    wowClass?: string;
  },
): Promise<StaffSignupResult> {
  const data = await requestJson<{
    notified?: boolean;
    notifyError?: string;
    signup: EventSignup;
  }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/signups/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return {
    notified: data.notified ?? false,
    notifyError: data.notifyError,
    signup: data.signup,
  };
}

export async function deleteMemberEventSignup(
  guildId: string,
  eventId: string,
  userId: string,
  notify = false,
): Promise<{ deleted: boolean; notified: boolean; notifyError?: string }> {
  const query = notify ? "?notify=1" : "";
  const data = await requestJson<{
    deleted: boolean;
    notified?: boolean;
    notifyError?: string;
  }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/signups/${encodeURIComponent(userId)}${query}`,
    { method: "DELETE" },
  );
  return {
    deleted: data.deleted,
    notified: data.notified ?? false,
    notifyError: data.notifyError,
  };
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

// Resetear la inscripción: borra la inscripción Y el personaje recordado, así
// la próxima vez se anota desde cero (distinto de quitar la inscripción).
export async function resetMyEventSignup(
  guildId: string,
  eventId: string,
): Promise<{ reset: boolean }> {
  return requestJson<{ reset: boolean }>(
    `/guilds/${guildId}/events/${encodeURIComponent(eventId)}/signups/me/reset`,
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
  // Juego al que pertenece la fila (wow | lol | …).
  game: string;
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

// Juegos del módulo de eventos: los configurados por la guild + las plantillas.
// Cada juego trae sus roles, que es lo que usa el selector y el roster.
export type EventGameOption = EventGameConfig & {
  // true = roles definidos por la guild; false = los de la plantilla.
  configured: boolean;
  // true = además del aviso el evento publica una encuesta nativa de Discord
  // (plantilla "encuesta").
  poll?: boolean;
};

export async function getEventGames(
  guildId: string,
): Promise<EventGameOption[]> {
  const data = await requestJson<{ games: EventGameOption[] }>(
    `/guilds/${guildId}/events/games`,
    { method: "GET" },
  );
  return data.games;
}

export async function createEventSpec(
  guildId: string,
  input: {
    animated?: boolean;
    className: string;
    emojiId?: string;
    emojiName?: string;
    game: string;
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
    game?: string;
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

// ── Plantillas de juego (presets de roles + catálogo) ───────────────
// Una plantilla deja el módulo listo para un juego: roles de inscripción,
// nombres de los ejes y el catálogo de clases/specs precargado.

export type EventTemplateSummary = {
  key: string;
  label: string;
  // Plantilla de encuesta: además del aviso se publica una encuesta de Discord.
  poll: boolean;
  roles: EventRoleOption[];
};

export async function getEventTemplates(
  guildId: string,
): Promise<EventTemplateSummary[]> {
  const data = await requestJson<{ templates: EventTemplateSummary[] }>(
    `/guilds/${guildId}/events/templates`,
    { method: "GET" },
  );
  return data.templates;
}

export async function applyEventTemplate(
  guildId: string,
  templateKey: string,
): Promise<{
  applied: EventTemplateSummary;
  config: GuildConfig;
  created: number;
  specs: RaidSpec[];
}> {
  return requestJson<{
    applied: EventTemplateSummary;
    config: GuildConfig;
    created: number;
    specs: RaidSpec[];
  }>(
    `/guilds/${guildId}/events/templates/${encodeURIComponent(templateKey)}/apply`,
    { method: "POST" },
  );
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
): Promise<Communication[]> {
  const data = await requestJson<{ communications: Communication[] }>(
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

// Guarda el comunicado. Si ya estaba publicado, el API edita el mensaje de
// Discord en el mismo paso y devuelve `discordError` si eso no se pudo hacer
// (el cambio igual queda guardado en la web).
export async function updateCommunication(
  guildId: string,
  communicationId: string,
  input: CommunicationInput,
): Promise<{ communication: Communication; discordError?: string }> {
  return requestJson<{ communication: Communication; discordError?: string }>(
    `/guilds/${guildId}/communications/${communicationId}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
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

// Guarda el orden del tablero: la lista va en el orden en que quedó (el índice
// es el puesto de cada tarjeta).
export async function reorderCommunications(
  guildId: string,
  ids: string[],
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/guilds/${guildId}/communications/order`,
    { body: JSON.stringify({ ids }), method: "PUT" },
  );
}

// Publica el comunicado. Si ya estaba publicado en Discord, actualiza el
// mensaje existente en vez de crear otro (`updated: true`).
export async function publishCommunication(
  guildId: string,
  communicationId: string,
): Promise<{ communication: Communication; updated?: boolean }> {
  return requestJson<{ communication: Communication; updated?: boolean }>(
    `/guilds/${guildId}/communications/${communicationId}/publish`,
    { method: "POST" },
  );
}

export async function logout(): Promise<void> {
  await requestJson<{ ok: true }>("/auth/logout", {
    method: "POST",
  });
}
