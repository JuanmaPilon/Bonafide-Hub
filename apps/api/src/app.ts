import Fastify from "fastify";
import { env } from "./config/env.js";
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

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  const isSecureCookie = env.NODE_ENV === "production";

  function getSessionFromRequest(cookieHeader: string | undefined) {
    const cookies = parseCookieHeader(cookieHeader);
    const signedSessionId = cookies[getSessionCookieName()];
    const sessionId = verifySignedSessionId(
      signedSessionId,
      env.SESSION_SECRET,
    );

    return getDiscordSession(sessionId ?? undefined);
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
    ],
  }));

  app.get("/auth/discord/start", async (_request, reply) => {
    const state = createOAuthState();
    const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");

    authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", env.DISCORD_REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "identify guilds");
    authorizeUrl.searchParams.set("state", state);

    reply.header(
      "Set-Cookie",
      buildCookieHeader(getStateCookieName(), state, {
        httpOnly: true,
        maxAgeSeconds: 600,
        path: "/",
        sameSite: "Lax",
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
    if (stateCookie !== query.state || !consumeOAuthState(query.state)) {
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
      redirect_uri: env.DISCORD_REDIRECT_URI,
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

    const session = createDiscordSession({
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
          sameSite: "Lax",
          secure: isSecureCookie,
        },
      ),
    ]);

    return reply.send({
      ok: true,
      user: session.user,
      guilds: getManageGuildFilter(session.guilds),
      expiresAt: session.expiresAt,
    });
  });

  app.get("/me", async (request, reply) => {
    const session = getSessionFromRequest(request.headers.cookie);
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
    const session = getSessionFromRequest(request.headers.cookie);
    if (!session) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }

    return {
      ok: true,
      guilds: getManageGuildFilter(session.guilds),
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const signedSessionId = cookies[getSessionCookieName()];
    const sessionId = verifySignedSessionId(
      signedSessionId,
      env.SESSION_SECRET,
    );

    if (sessionId) {
      clearDiscordSession(sessionId);
    }

    reply.header("Set-Cookie", [
      buildClearCookie(getSessionCookieName()),
      buildClearCookie(getStateCookieName()),
    ]);

    return { ok: true };
  });

  return app;
}
