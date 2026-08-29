export type ApiGuild = {
  features: string[];
  icon: string | null;
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
};

export type GuildConfig = {
  bannedVoiceRoleIds?: string[];
  dailyMessagesChannelId?: string;
  dailyMessagesEnabled?: boolean;
  dailyMessagesMaxMinutes?: number;
  dailyMessagesMinMinutes?: number;
  defaultRoleId?: string;
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  logsChannelId?: string;
  logsWatchEnabled?: boolean;
  logsWatchGuild?: string;
  logsWatchRegion?: string;
  logsWatchServer?: string;
  memberLogChannelId?: string;
  musicEnabled?: boolean;
  musicRoleIds?: string[];
  reactionRolesChannelId?: string;
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

export type CommunicationInstance = {
  authorName?: string;
  channelId: string;
  communicationId: string;
  content: string;
  discordMessageIds: string[];
  id: string;
  publishedAt: string;
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
  title: string;
  updatedAt: string;
};

export type CommunicationInput = {
  authorName?: string;
  channelId?: string;
  content?: string;
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

export type ReactionRolePairInput = {
  emoji: string;
  roleId: string;
};

export type ReactionRoleRuleData = {
  emoji: string;
  roleId: string;
};

export type ReactionRolePanel = {
  channelId: string | null;
  createdAt: string;
  description?: string;
  messageId: string;
  mode: string;
  rules: ReactionRoleRuleData[];
  status: "draft" | "published";
  title?: string;
  updatedAt: string;
};

export async function createReactionRolePanel(
  guildId: string,
  input: {
    channelId?: string;
    description?: string;
    mode?: string;
    pairs: ReactionRolePairInput[];
    title?: string;
  },
): Promise<ReactionRolePanel> {
  const data = await requestJson<{ panel: ReactionRolePanel }>(
    `/guilds/${guildId}/reaction-roles/panels`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  return data.panel;
}

export async function listReactionRolePanels(
  guildId: string,
): Promise<ReactionRolePanel[]> {
  const data = await requestJson<{ panels: ReactionRolePanel[] }>(
    `/guilds/${guildId}/reaction-roles/panels`,
    {
      method: "GET",
    },
  );

  return data.panels;
}

export type ReactionRoleJob = {
  action: string;
  channelId: string | null;
  createdAt: string;
  error: string | null;
  id: string;
  messageId: string | null;
  mode: string;
  status: string;
  title: string | null;
};

export async function listReactionRoleJobs(
  guildId: string,
): Promise<ReactionRoleJob[]> {
  const data = await requestJson<{ jobs: ReactionRoleJob[] }>(
    `/guilds/${guildId}/reaction-roles/jobs`,
    {
      method: "GET",
    },
  );

  return data.jobs;
}

export async function deleteReactionRoleJob(
  guildId: string,
  jobId: string,
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/guilds/${guildId}/reaction-roles/jobs/${encodeURIComponent(jobId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
  );
}

export async function deleteReactionRolePanel(
  guildId: string,
  messageId: string,
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/guilds/${guildId}/reaction-roles/panels/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
  );
}

export type GuildEmoji = {
  animated: boolean;
  id: string;
  name: string;
};

export async function getGuildEmojis(guildId: string): Promise<GuildEmoji[]> {
  const data = await requestJson<{ emojis: GuildEmoji[] }>(
    `/guilds/${guildId}/emojis`,
    {
      method: "GET",
    },
  );

  return data.emojis;
}

export async function updateReactionRolePanel(
  guildId: string,
  messageId: string,
  input: {
    channelId?: string;
    description?: string;
    mode?: string;
    pairs: ReactionRolePairInput[];
    title?: string;
  },
): Promise<{ panel: ReactionRolePanel; jobId: string | null }> {
  const data = await requestJson<{
    panel: ReactionRolePanel;
    jobId: string | null;
  }>(
    `/guilds/${guildId}/reaction-roles/panels/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

  return data;
}

export async function publishReactionRolePanel(
  guildId: string,
  messageId: string,
): Promise<{ jobId: string }> {
  return requestJson<{ jobId: string }>(
    `/guilds/${guildId}/reaction-roles/panels/${encodeURIComponent(messageId)}/publish`,
    { method: "POST" },
  );
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

export async function deleteRaidLog(
  guildId: string,
  logId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/guilds/${guildId}/raid-logs/${encodeURIComponent(logId)}`,
    { method: "DELETE" },
  );
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

export async function logout(): Promise<void> {
  await requestJson<{ ok: true }>("/auth/logout", {
    method: "POST",
  });
}
