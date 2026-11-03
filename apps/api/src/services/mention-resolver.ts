import { env } from "../config/env.js";

// Resolvedor de menciones para comunicados.
// Convierte "@nombre" (usuario o rol) en la mención con ID que Discord
// sí interpreta: <@USER_ID> para usuarios y <@&ROLE_ID> para roles, y
// "#canal" en el enlace <#CHANNEL_ID>.
// Best-effort: si un nombre no se encuentra, se deja el texto igual.

type DiscordMember = {
  nick: string | null;
  user?: { id: string; username: string } | null;
};

type DiscordRole = {
  id: string;
  name: string;
};

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
};

// Texto, anuncios y foro: los que se pueden enlazar con <#id>.
const MENTIONABLE_CHANNEL_TYPES = new Set([0, 5, 15]);

// Un "#" o "@" que no venga pegado a una palabra, a otra mención o a la barra
// de una URL (`pagina#ancla`, `contacto@dominio`), que no esté escapado con "\"
// y que tenga algo detrás: "# Título" es un heading de markdown, no un canal.
const CHANNEL_REFERENCE = /(?<![\w/#<\\])#[^\s#<>]/;
const CHANNEL_REFERENCE_ALL = /(?<![\w/#<\\])#([^\s#<>]+)/g;
const USER_REFERENCE = /(?<![\w<])@([^\s@<>]+)/g;
const USER_REFERENCE_TEST = /(?<![\w<])@[^\s@<>]/;

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

// channel name -> channelId (en minúsculas). Los nombres de canal no llevan
// espacios, así que "#general" es un token limpio.
async function fetchChannelsForMentions(
  guildId: string,
  token: string,
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const channels = await discordFetch<DiscordChannel[]>(
    `/guilds/${encodeURIComponent(guildId)}/channels`,
    token,
  );
  for (const channel of channels) {
    if (MENTIONABLE_CHANNEL_TYPES.has(channel.type)) {
      byName.set(channel.name.toLowerCase(), channel.id);
    }
  }
  return byName;
}

// Best-effort: si una consulta falla, esa lista queda vacía y el texto se
// publica igual (sin arruinar la resolución de las otras).
async function safeLoad(load: () => Promise<Map<string, string>>) {
  try {
    return await load();
  } catch {
    return new Map<string, string>();
  }
}

// El nombre escrito no incluye la puntuación que lo sigue ("#general.", "…"),
// así que se prueba tal cual y después sin la cola, devolviéndola aparte.
function lookupName(
  names: Map<string, string>,
  raw: string,
): { id: string; tail: string } | null {
  const direct = names.get(raw.toLowerCase());
  if (direct) {
    return { id: direct, tail: "" };
  }
  const parts = /^(.+?)([.,;:!?)\]]+)$/.exec(raw);
  if (parts) {
    const id = names.get(parts[1].toLowerCase());
    if (id) {
      return { id, tail: parts[2] };
    }
  }
  return null;
}

// Busca @algo / #algo (que no sea una mención ya armada <@...> / <#...>) y lo
// reemplaza. Para @ prioriza roles (no tienen otra forma de mencionarse por
// nombre).
export async function resolveMentions(
  content: string,
  guildId: string,
): Promise<string> {
  const token = env.DISCORD_BOT_TOKEN;
  const wantsUsers = USER_REFERENCE_TEST.test(content);
  const wantsChannels = CHANNEL_REFERENCE.test(content);
  if (!token || (!wantsUsers && !wantsChannels)) {
    return content;
  }

  const [users, roles, channels] = await Promise.all([
    wantsUsers
      ? safeLoad(() => fetchMembersForMentions(guildId, token))
      : Promise.resolve(new Map<string, string>()),
    wantsUsers
      ? safeLoad(() => fetchRolesForMentions(guildId, token))
      : Promise.resolve(new Map<string, string>()),
    wantsChannels
      ? safeLoad(() => fetchChannelsForMentions(guildId, token))
      : Promise.resolve(new Map<string, string>()),
  ]);

  let resolved = content;

  // Los canales van primero: así el "<#id>" que queda ya no lo toca el
  // reemplazo de usuarios.
  if (channels.size > 0) {
    resolved = resolved.replace(
      CHANNEL_REFERENCE_ALL,
      (match, name: string) => {
        const found = lookupName(channels, name);
        return found ? `<#${found.id}>${found.tail}` : match;
      },
    );
  }

  if (users.size > 0 || roles.size > 0) {
    // (?<!<) evita tocar menciones ya armadas como <@123> o <@&123>.
    resolved = resolved.replace(USER_REFERENCE, (match, name: string) => {
      const role = lookupName(roles, name);
      if (role) {
        return `<@&${role.id}>${role.tail}`;
      }
      const user = lookupName(users, name);
      if (user) {
        return `<@${user.id}>${user.tail}`;
      }
      return match;
    });
  }

  return resolved;
}
