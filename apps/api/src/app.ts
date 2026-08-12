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
  importXpEntries,
  listXpProfiles,
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

async function fetchDiscordJson<T>(
  path: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

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
  user?: {
    avatar?: string | null;
    id: string;
    username: string;
  } | null;
};

type LeaderboardUserInfo = {
  avatarUrl: string | null;
  nickname: string | null;
  username: string;
};

async function fetchGuildMembersForLeaderboard(
  guildId: string,
): Promise<Map<string, LeaderboardUserInfo>> {
  const result = new Map<string, LeaderboardUserInfo>();
  if (!env.DISCORD_BOT_TOKEN) {
    return result;
  }

  let after: string | undefined;
  const members: DiscordGuildMember[] = [];

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) {
      query.set("after", after);
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members?${query.toString()}`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
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

  for (const member of members) {
    if (!member.user) {
      continue;
    }

    const avatarHash = member.user.avatar ?? member.avatar;
    const avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${member.user.id}/${avatarHash}.png?size=64`
      : null;

    result.set(member.user.id, {
      avatarUrl,
      nickname: member.nick ?? null,
      username: member.user.username,
    });
  }

  return result;
}

export function buildApp() {
  const app = Fastify({
    logger: true,
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
    return session.guilds.some((guild) => {
      if (guild.id !== guildId) {
        return false;
      }

      if (guild.owner) {
        return true;
      }

      try {
        const permissions = BigInt(guild.permissions);
        const manageGuildBit = 1n << 5n;
        return (permissions & manageGuildBit) === manageGuildBit;
      } catch {
        return false;
      }
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

    const body = request.body as { config?: GuildConfig };
    if (!body?.config || typeof body.config !== "object") {
      return reply.code(400).send({
        ok: false,
        error: "Missing config object",
      });
    }

    const config = await replaceGuildConfig(params.guildId, body.config);

    return {
      ok: true,
      guildId: params.guildId,
      config,
    };
  });

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

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      body: tokenBody,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    if (!tokenResponse.ok) {
      const errorBody = (await tokenResponse
        .json()
        .catch(() => null)) as Record<string, unknown> | null;

      return reply.code(400).send({
        ok: false,
        error: "Failed to exchange Discord code",
        details: errorBody,
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

    return {
      ok: true,
      guilds: getManageGuildFilter(session.guilds),
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

    if (!canManageGuild(session, params.guildId)) {
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

    const widgetResponse = await fetch(
      `https://discord.com/api/guilds/${params.guildId}/widget.json`,
    );

    if (!widgetResponse.ok) {
      return reply.code(200).send({
        ok: true,
        guildId: params.guildId,
        available: false,
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
      memberCount,
      presenceCount: previewPresenceCount ?? widget.presence_count ?? null,
      inviteUrl: widget.instant_invite ?? null,
      name: widget.name,
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

    if (!canManageGuild(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const channelsResponse = await fetch(
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

  app.get("/guilds/:guildId/roles", async (request, reply) => {
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

    if (!env.DISCORD_BOT_TOKEN) {
      return reply.code(503).send({
        ok: false,
        error: "DISCORD_BOT_TOKEN is not configured",
      });
    }

    const rolesResponse = await fetch(
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

  app.get("/guilds/:guildId/xp-config", async (request, reply) => {
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

    if (!canManageGuild(session, params.guildId)) {
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

    if (!canManageGuild(session, params.guildId)) {
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

  app.get("/guilds/:guildId/xp/export", async (request, reply) => {
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

    if (!canManageGuild(session, params.guildId)) {
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

    return {
      ok: true,
      guildId: params.guildId,
      ...result,
    };
  });

  app.get("/guilds/:guildId/config", async (request, reply) => {
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

    const config = await getGuildConfig(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      config,
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

    if (!canManageGuild(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = request.body as Partial<GuildConfig>;
    const allowedBody: GuildConfig = {};

    if (body.memberLogChannelId !== undefined) {
      allowedBody.memberLogChannelId = body.memberLogChannelId;
    }

    if (body.dynamicVoiceCreateChannelId !== undefined) {
      allowedBody.dynamicVoiceCreateChannelId =
        body.dynamicVoiceCreateChannelId;
    }

    if (body.reactionRolesChannelId !== undefined) {
      allowedBody.reactionRolesChannelId = body.reactionRolesChannelId;
    }

    if (body.enabledModules !== undefined) {
      allowedBody.enabledModules = body.enabledModules;
    }

    const config = await upsertGuildConfig(params.guildId, allowedBody);

    return {
      ok: true,
      guildId: params.guildId,
      config,
    };
  });

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

  return app;
}
