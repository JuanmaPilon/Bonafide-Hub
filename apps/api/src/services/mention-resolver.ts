import { env } from "../config/env.js";

// Resolvedor de menciones para comunicados.
// Convierte "@nombre" (usuario o rol) en la mención con ID que Discord
// sí interpreta: <@USER_ID> para usuarios y <@&ROLE_ID> para roles.
// Best-effort: si un nombre no se encuentra, se deja el texto igual.

type DiscordMember = {
  nick: string | null;
  user?: { id: string; username: string } | null;
};

type DiscordRole = {
  id: string;
  name: string;
};

async function discordFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Discord fetch failed (${response.status})`);
  }
  return (await response.json()) as T;
}

// username -> userId (en minúsculas para matchear sin importar mayúsculas).
async function fetchMembersForMentions(
  guildId: string,
  token: string,
): Promise<Map<string, string>> {
  const byUsername = new Map<string, string>();
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) {
      query.set("after", after);
    }

    const members = await discordFetch<DiscordMember[]>(
      `/guilds/${encodeURIComponent(guildId)}/members?${query.toString()}`,
      token,
    );

    for (const member of members) {
      if (member.user?.username) {
        byUsername.set(member.user.username.toLowerCase(), member.user.id);
      }
    }

    if (members.length < 1000) {
      break;
    }
    after = members[members.length - 1]?.user?.id;
    if (!after) {
      break;
    }
  }

  return byUsername;
}

// role name -> roleId (en minúsculas).
async function fetchRolesForMentions(
  guildId: string,
  token: string,
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const roles = await discordFetch<DiscordRole[]>(
    `/guilds/${encodeURIComponent(guildId)}/roles`,
    token,
  );
  for (const role of roles) {
    byName.set(role.name.toLowerCase(), role.id);
  }
  return byName;
}

// Busca @algo (que no sea una mención ya armada <@...>) y lo reemplaza.
// Prioriza roles (no tienen otra forma de mencionarse por nombre).
export async function resolveMentions(
  content: string,
  guildId: string,
): Promise<string> {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token || !content.includes("@")) {
    return content;
  }

  let users = new Map<string, string>();
  let roles = new Map<string, string>();
  try {
    [users, roles] = await Promise.all([
      fetchMembersForMentions(guildId, token),
      fetchRolesForMentions(guildId, token),
    ]);
  } catch {
    // Si falla la consulta a Discord, publicamos sin resolver.
    return content;
  }

  // (?<!<) evita tocar menciones ya armadas como <@123> o <@&123>.
  return content.replace(
    /(?<!<)@([^\s@<>]+)/g,
    (match, name: string) => {
      const lower = name.toLowerCase();
      const roleId = roles.get(lower);
      if (roleId) {
        return `<@&${roleId}>`;
      }
      const userId = users.get(lower);
      if (userId) {
        return `<@${userId}>`;
      }
      return match;
    },
  );
}
