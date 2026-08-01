import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type DiscordUser = {
  avatar: string | null;
  discriminator: string;
  global_name: string | null;
  id: string;
  username: string;
};

export type DiscordGuild = {
  features: string[];
  icon: string | null;
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
};

export type DiscordSession = {
  createdAt: number;
  expiresAt: number;
  guilds: DiscordGuild[];
  id: string;
  user: DiscordUser;
};

export type OAuthState = {
  createdAt: number;
};

const SESSION_COOKIE_NAME = "bonafide_session";
const OAUTH_STATE_COOKIE_NAME = "bonafide_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

const sessions = new Map<string, DiscordSession>();
const oauthStates = new Map<string, OAuthState>();

type CookieOptions = {
  httpOnly?: boolean;
  maxAgeSeconds?: number;
  path?: string;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export function parseCookieHeader(
  cookieHeader: string | undefined,
): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(";")
    .reduce<Record<string, string>>((accumulator, pair) => {
      const [rawKey, ...rawValueParts] = pair.trim().split("=");
      if (!rawKey) {
        return accumulator;
      }

      const key = decodeURIComponent(rawKey.trim());
      const value = decodeURIComponent(rawValueParts.join("=").trim());
      accumulator[key] = value;
      return accumulator;
    }, {});
}

export function buildCookieHeader(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const segments = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  segments.push(`Path=${options.path ?? "/"}`);

  if (options.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  }

  if (options.httpOnly ?? true) {
    segments.push("HttpOnly");
  }

  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

export function createOAuthState(): string {
  const state = randomUUID();
  oauthStates.set(state, { createdAt: Date.now() });
  return state;
}

export function consumeOAuthState(state: string): boolean {
  const entry = oauthStates.get(state);
  if (!entry) {
    return false;
  }

  const isExpired = Date.now() - entry.createdAt > STATE_TTL_MS;
  oauthStates.delete(state);
  return !isExpired;
}

export function createDiscordSession(input: {
  guilds: DiscordGuild[];
  user: DiscordUser;
  accessTokenExpiresInSeconds: number;
}): DiscordSession {
  const session: DiscordSession = {
    createdAt: Date.now(),
    expiresAt: Date.now() + input.accessTokenExpiresInSeconds * 1000,
    guilds: input.guilds,
    id: randomUUID(),
    user: input.user,
  };

  sessions.set(session.id, session);
  return session;
}

export function clearDiscordSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getDiscordSession(
  sessionId: string | undefined,
): DiscordSession | null {
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export function signSessionId(sessionId: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(sessionId)
    .digest("hex");
  return `${sessionId}.${signature}`;
}

export function verifySignedSessionId(
  signedValue: string | undefined,
  secret: string,
): string | null {
  if (!signedValue) {
    return null;
  }

  const [sessionId, signature] = signedValue.split(".");
  if (!sessionId || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(sessionId)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  return sessionId;
}

export function buildSessionCookie(sessionId: string, secret: string): string {
  return signSessionId(sessionId, secret);
}

export function buildClearCookie(name: string): string {
  return buildCookieHeader(name, "", {
    maxAgeSeconds: 0,
    path: "/",
  });
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function getStateCookieName(): string {
  return OAUTH_STATE_COOKIE_NAME;
}

export function getManageGuildFilter(guilds: DiscordGuild[]): DiscordGuild[] {
  const manageGuildPermissionBit = 1n << 5n;

  return guilds.filter((guild) => {
    if (guild.owner) {
      return true;
    }

    try {
      const permissions = BigInt(guild.permissions);
      return (
        (permissions & manageGuildPermissionBit) === manageGuildPermissionBit
      );
    } catch {
      return false;
    }
  });
}
