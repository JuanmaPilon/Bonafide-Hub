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
  completeReactionRoleJob,
  createReactionRoleJob,
  createReactionRoleTemplate,
  deleteReactionRoleJob,
  deleteReactionRolePanel,
  getReactionRolePanel,
  listPendingReactionRoleJobs,
  listReactionRolePanels,
  listRecentReactionRoleJobs,
  updateReactionRoleTemplate,
  type ReactionRolePair,
} from "./services/reaction-roles-store.js";
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
  getCommunicationInstance,
  listCommunications,
  listPublishedInstances,
  markCommunicationPublished,
  postMessages,
  splitForDiscord,
  updateCommunication,
  type Communication,
  type CommunicationInstance,
} from "./services/communications-store.js";
import { resolveMentions } from "./services/mention-resolver.js";
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
  premium_since?: string | null;
  user?: {
    avatar?: string | null;
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

async function fetchAllGuildMembers(
  guildId: string,
): Promise<DiscordGuildMember[]> {
  if (!env.DISCORD_BOT_TOKEN) {
    return [];
  }

  const members: DiscordGuildMember[] = [];
  let after: string | undefined;

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

  return members;
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

  app.get(
    "/internal/guilds/:guildId/reaction-roles/jobs",
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

      const jobs = await listPendingReactionRoleJobs(params.guildId);

      return {
        ok: true,
        guildId: params.guildId,
        jobs,
      };
    },
  );

  app.post(
    "/internal/guilds/:guildId/reaction-roles/jobs/:jobId/complete",
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

      const params = request.params as {
        guildId?: string;
        jobId?: string;
      };
      if (!params.guildId || !params.jobId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      const body = (request.body ?? {}) as {
        deletePanelMessageId?: string;
        error?: string;
        messageId?: string;
        panel?: {
          channelId?: string;
          description?: string;
          mode?: string;
          title?: string;
        };
      };

      if (
        body.deletePanelMessageId &&
        body.deletePanelMessageId !== body.messageId
      ) {
        await deleteReactionRolePanel(
          params.guildId,
          body.deletePanelMessageId,
        );
      }

      await completeReactionRoleJob(params.guildId, params.jobId, {
        error: body.error,
        messageId: body.messageId,
        panel: body.panel,
      });

      return {
        ok: true,
        guildId: params.guildId,
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
        userId: profile.userId,
        level: profile.level,
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

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      body: tokenBody,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    if (!tokenResponse.ok) {
      const raw = await tokenResponse.text().catch(() => "");
      let errorBody: unknown = null;
      try {
        errorBody = raw ? JSON.parse(raw) : null;
      } catch {
        errorBody = raw.slice(0, 300);
      }

      return reply.code(400).send({
        ok: false,
        error: "Failed to exchange Discord code",
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

  app.get("/guilds/:guildId/emojis", async (request, reply) => {
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

    const emojisResponse = await fetch(
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

    if (!canManageGuild(session, params.guildId)) {
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

    if (!canManageGuild(session, params.guildId)) {
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

  // Crea una PLANTILLA (borrador) de reaction roles. No se publica en
  // Discord hasta que se aprieta "Publicar".
  app.post("/guilds/:guildId/reaction-roles/panels", async (request, reply) => {
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
      channelId?: string;
      description?: string;
      mode?: string;
      pairs?: ReactionRolePair[];
      title?: string;
    };
    const channelId = body.channelId?.trim();
    const pairs = Array.isArray(body.pairs)
      ? body.pairs
          .map((pair) => ({
            emoji: String(pair.emoji ?? "").trim(),
            roleId: String(pair.roleId ?? "").trim(),
          }))
          .filter((pair) => pair.emoji && pair.roleId)
      : [];

    const panel = await createReactionRoleTemplate({
      channelId: channelId || undefined,
      description: body.description?.trim() || undefined,
      guildId: params.guildId,
      mode:
        body.mode === "unique" || body.mode === "additive"
          ? body.mode
          : "multiple",
      rules: pairs,
      title: body.title?.trim() || undefined,
    });

    await logAdminAction(session, params.guildId, "reaction-panel:create", {
      details: `Plantilla creada${body.title?.trim() ? `: "${body.title.trim()}"` : ""} (borrador).`,
      targetType: "reaction-panel",
      targetId: panel.messageId,
    });

    return {
      ok: true,
      guildId: params.guildId,
      panel,
    };
  });

  app.get("/guilds/:guildId/reaction-roles/panels", async (request, reply) => {
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

    const panels = await listReactionRolePanels(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      panels,
    };
  });

  app.get("/guilds/:guildId/reaction-roles/jobs", async (request, reply) => {
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

    const jobs = await listRecentReactionRoleJobs(params.guildId);

    return {
      ok: true,
      guildId: params.guildId,
      jobs,
    };
  });

  app.delete(
    "/guilds/:guildId/reaction-roles/jobs/:jobId",
    async (request, reply) => {
      const session = await requireSession(request);
      if (!session) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }

      const params = request.params as { guildId?: string; jobId?: string };
      if (!params.guildId || !params.jobId) {
        return reply.code(400).send({ ok: false, error: "Missing params" });
      }

      if (!canManageGuild(session, params.guildId)) {
        return reply.code(403).send({ ok: false, error: "Forbidden" });
      }

      await deleteReactionRoleJob(params.guildId, params.jobId);

      return {
        ok: true,
        guildId: params.guildId,
      };
    },
  );

  app.delete(
    "/guilds/:guildId/reaction-roles/panels/:messageId",
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

      const panel = await getReactionRolePanel(
        params.guildId,
        params.messageId,
      );
      if (!panel) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      // Si está publicado, el bot borra el mensaje de Discord.
      if (panel.status === "published") {
        await createReactionRoleJob({
          action: "delete",
          guildId: params.guildId,
          messageId: panel.messageId,
        });
      }

      await deleteReactionRolePanel(params.guildId, params.messageId);

      await logAdminAction(session, params.guildId, "reaction-panel:delete", {
        details: "Plantilla de reaction roles eliminada.",
        targetId: params.messageId,
        targetType: "reaction-panel",
      });

      return {
        ok: true,
        guildId: params.guildId,
        deleted: true,
      };
    },
  );

  // Publica una plantilla: crea el mensaje en Discord si es borrador, o lo
  // actualiza (re-publica) si ya estaba publicado.
  app.post(
    "/guilds/:guildId/reaction-roles/panels/:messageId/publish",
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

      const panel = await getReactionRolePanel(
        params.guildId,
        params.messageId,
      );
      if (!panel) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      if (!panel.channelId) {
        return reply.code(400).send({
          ok: false,
          error: "Elegí un canal de texto antes de publicar",
        });
      }
      if (panel.rules.length === 0) {
        return reply.code(400).send({
          ok: false,
          error: "Agregá al menos un par emoji + rol",
        });
      }

      const action = panel.status === "published" ? "update" : "create";
      const result = await createReactionRoleJob({
        action,
        channelId: panel.channelId,
        description: panel.description,
        guildId: params.guildId,
        messageId: panel.messageId,
        mode: panel.mode,
        rules: panel.rules,
        title: panel.title,
      });

      await logAdminAction(session, params.guildId, "reaction-panel:publish", {
        details: `Publicación de plantilla encolada${panel.title ? `: "${panel.title}"` : ""} (${action}).`,
        targetId: params.messageId,
        targetType: "reaction-panel",
      });

      return {
        ok: true,
        guildId: params.guildId,
        ...result,
      };
    },
  );

  app.patch(
    "/guilds/:guildId/reaction-roles/panels/:messageId",
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
        channelId?: string;
        description?: string;
        mode?: string;
        pairs?: ReactionRolePair[];
        title?: string;
      };
      const channelId = body.channelId?.trim();
      const pairs = Array.isArray(body.pairs)
        ? body.pairs
            .map((pair) => ({
              emoji: String(pair.emoji ?? "").trim(),
              roleId: String(pair.roleId ?? "").trim(),
            }))
            .filter((pair) => pair.emoji && pair.roleId)
        : [];

      // Editar guarda la plantilla. Si ya está publicada, encolamos además
      // una actualización para que el bot edite el mensaje existente en
      // Discord sin obligar a republicar manualmente.
      const panel = await updateReactionRoleTemplate({
        channelId: channelId || undefined,
        description: body.description?.trim() || undefined,
        guildId: params.guildId,
        messageId: params.messageId,
        mode:
          body.mode === "unique" || body.mode === "additive"
            ? body.mode
            : "multiple",
        rules: pairs,
        title: body.title?.trim() || undefined,
      });

      if (!panel) {
        return reply.code(404).send({ ok: false, error: "Not found" });
      }

      let jobId: string | null = null;
      if (panel.status === "published") {
        if (!panel.channelId) {
          return reply.code(400).send({
            ok: false,
            error:
              "Elegí un canal de texto para poder actualizar el mensaje en Discord",
          });
        }
        if (panel.rules.length === 0) {
          return reply.code(400).send({
            ok: false,
            error:
              "Agregá al menos un par emoji + rol para actualizar el mensaje en Discord",
          });
        }
        const job = await createReactionRoleJob({
          action: "update",
          channelId: panel.channelId,
          description: panel.description,
          guildId: params.guildId,
          messageId: panel.messageId,
          mode: panel.mode,
          rules: panel.rules,
          title: panel.title,
        });
        jobId = job.jobId;
      }

      await logAdminAction(session, params.guildId, "reaction-panel:update", {
        details: `Plantilla actualizada${body.title?.trim() ? `: "${body.title.trim()}"` : ""}${jobId ? " (mensaje en Discord en actualización)" : ""}.`,
        targetId: params.messageId,
        targetType: "reaction-panel",
      });

      return {
        ok: true,
        guildId: params.guildId,
        panel,
        jobId,
      };
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

    if (body.defaultRoleId !== undefined) {
      allowedBody.defaultRoleId = body.defaultRoleId;
    }

    if (body.enabledModules !== undefined) {
      allowedBody.enabledModules = body.enabledModules;
    }

    if (body.musicEnabled !== undefined) {
      allowedBody.musicEnabled = body.musicEnabled;
    }

    if (body.musicRoleIds !== undefined) {
      allowedBody.musicRoleIds = body.musicRoleIds;
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

    if (!canManageGuild(session, params.guildId)) {
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

    if (!canManageGuild(session, params.guildId)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const body = request.body as {
      authorName?: string;
      channelId?: string;
      content?: string;
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

      if (!canManageGuild(session, params.guildId)) {
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
        title?: string;
      };

      const communication = await updateCommunication({
        authorName: body.authorName,
        channelId: body.channelId,
        content: body.content?.trim(),
        id: params.communicationId,
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

      if (!canManageGuild(session, params.guildId)) {
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

      if (!canManageGuild(session, params.guildId)) {
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

      if (!canManageGuild(session, params.guildId)) {
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

  return app;
}
