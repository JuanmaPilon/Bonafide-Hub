export type ApiGuild = {
  features: string[];
  icon: string | null;
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
};

export type GuildConfig = {
  dynamicVoiceCreateChannelId?: string;
  enabledModules?: string[];
  memberLogChannelId?: string;
  reactionRolesChannelId?: string;
};

export type GuildWidgetStatus = {
  available: boolean;
  guildId: string;
  inviteUrl: string | null;
  memberCount: number | null;
  name?: string;
  presenceCount: number | null;
};

export type GuildRole = {
  color: number;
  id: string;
  managed: boolean;
  name: string;
  position: number;
};

export type XpRoleRule = {
  level: number;
  removeRoleIds: string[];
  roleId: string;
  xpMultiplier: number;
};

export type XpConfig = {
  cooldownSeconds: number;
  guildId: string;
  levelBaseXp: number;
  levelRoles: XpRoleRule[];
  maxLevel: number;
  messageXp: number;
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
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

export type GuildVoiceChannel = {
  id: string;
  name: string;
  type: number;
};

export async function getGuildVoiceChannels(
  guildId: string,
): Promise<GuildVoiceChannel[]> {
  const data = await requestJson<{ voiceChannels: GuildVoiceChannel[] }>(
    `/guilds/${guildId}/channels`,
    {
      method: "GET",
    },
  );

  return data.voiceChannels;
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

export async function logout(): Promise<void> {
  await requestJson<{ ok: true }>("/auth/logout", {
    method: "POST",
  });
}
