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
