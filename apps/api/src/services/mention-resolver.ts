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

type Named = { id: string; name: string };

type DiscordChannel = Named & { type: number };

type MentionNames = {
  // Nombres con espacios ("🔰Raid Officer"), del más largo al más corto.
  multiWord: Array<{ alias: string; mention: string }>;
  names: Map<string, string>;
};

// Texto, anuncios y foro: los que se pueden enlazar con <#id>.
const MENTIONABLE_CHANNEL_TYPES = new Set([0, 5, 15]);

// En Discord los nombres vienen decorados ("🗯️︱general", "🔰Raid Officer"),
// así que además del nombre real se registra la versión limpia: sin emojis ni
// separadores, que es lo que la gente escribe.
const DECORATION =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]/gu;
const NOT_NAME_CHAR = /[^\p{L}\p{N}._-]+/gu;

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
): Promise<Named[]> {
  const members: Named[] = [];
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) {
      query.set("after", after);
    }

    const page_ = await discordFetch<DiscordMember[]>(
      `/guilds/${encodeURIComponent(guildId)}/members?${query.toString()}`,
      token,
    );

    for (const member of page_) {
      if (member.user?.username) {
        members.push({ id: member.user.id, name: member.user.username });
      }
    }

    if (page_.length < 1000) {
      break;
    }
    after = page_[page_.length - 1]?.user?.id;
    if (!after) {
      break;
    }
  }

  return members;
}

async function fetchRolesForMentions(
  guildId: string,
  token: string,
): Promise<Named[]> {
  const roles = await discordFetch<Array<Named & { name: string }>>(
    `/guilds/${encodeURIComponent(guildId)}/roles`,
    token,
  );
  return roles.map((role) => ({ id: role.id, name: role.name }));
}

async function fetchChannelsForMentions(
  guildId: string,
  token: string,
): Promise<Named[]> {
  const channels = await discordFetch<DiscordChannel[]>(
    `/guilds/${encodeURIComponent(guildId)}/channels`,
    token,
  );
  return channels
    .filter((channel) => MENTIONABLE_CHANNEL_TYPES.has(channel.type))
    .map((channel) => ({ id: channel.id, name: channel.name }));
}

// Best-effort: si una consulta falla, esa lista queda vacía y el texto se
// publica igual (sin arruinar la resolución de las otras).
async function safeLoad<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

function cleanName(name: string): string {
  return name
    .toLowerCase()
    .replace(DECORATION, " ")
    .replace(NOT_NAME_CHAR, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Nombre tal cual (en minúsculas) primero, después las variantes limpias.
function aliasesOf(name: string): string[] {
  const lower = name.toLowerCase();
  const cleaned = cleanName(name);
  const aliases = [lower];
  if (cleaned && cleaned !== lower) {
    aliases.push(cleaned, cleaned.replace(/\s+/g, "-"));
  }
  return aliases;
}

function buildNames(
  items: Named[],
  mentionOf: (id: string) => string,
): MentionNames {
  const names = new Map<string, string>();
  // Los nombres exactos se registran primero: si lo escrito coincide con un
  // nombre real, gana sobre el alias limpio de otro.
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (!names.has(key)) {
      names.set(key, item.id);
    }
  }
  for (const item of items) {
    for (const alias of aliasesOf(item.name)) {
      if (!names.has(alias)) {
        names.set(alias, item.id);
      }
    }
  }

  // Un nombre con espacios no entra en el token de "@", así que se resuelve
  // aparte, del más largo al más corto: así "@Grand Master" no se lee como
  // "@Master" y "@Raid Officer" no se lee como el rol "Raid".
  const multiWord: MentionNames["multiWord"] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const alias of aliasesOf(item.name)) {
      if (!alias.includes(" ") || seen.has(alias)) {
        continue;
      }
      seen.add(alias);
      multiWord.push({ alias, mention: mentionOf(item.id) });
    }
  }
  multiWord.sort((a, b) => b.alias.length - a.alias.length);

  return { multiWord, names };
}

function multiWordPattern(alias: string): RegExp {
  const escaped = alias
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\w<])@${escaped}(?![\\p{L}\\p{N}-])`, "giu");
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

  const [members, roles, channels] = await Promise.all([
    wantsUsers
      ? safeLoad(() => fetchMembersForMentions(guildId, token), [] as Named[])
      : Promise.resolve([] as Named[]),
    wantsUsers
      ? safeLoad(() => fetchRolesForMentions(guildId, token), [] as Named[])
      : Promise.resolve([] as Named[]),
    wantsChannels
      ? safeLoad(() => fetchChannelsForMentions(guildId, token), [] as Named[])
      : Promise.resolve([] as Named[]),
  ]);

  const userNames = buildNames(members, (id) => `<@${id}>`);
  const roleNames = buildNames(roles, (id) => `<@&${id}>`);
  const channelNames = buildNames(channels, (id) => `<#${id}>`);

  let resolved = content;

  // Los roles con espacios van primero: si el token de "@" los agarra antes,
  // "@Raid Officer" queda como el rol "Raid" y " Officer" suelto.
  for (const { alias, mention } of roleNames.multiWord) {
    resolved = resolved.replace(multiWordPattern(alias), mention);
  }

  // Los canales van antes que los usuarios: el "<#id>" que queda ya no lo
  // toca el reemplazo de "@".
  if (channelNames.names.size > 0) {
    resolved = resolved.replace(
      CHANNEL_REFERENCE_ALL,
      (match, name: string) => {
        const found = lookupName(channelNames.names, name);
        return found ? `<#${found.id}>${found.tail}` : match;
      },
    );
  }

  if (userNames.names.size > 0 || roleNames.names.size > 0) {
    // (?<![\w<]) evita tocar menciones ya armadas como <@123> o <@&123>.
    resolved = resolved.replace(USER_REFERENCE, (match, name: string) => {
      const role = lookupName(roleNames.names, name);
      if (role) {
        return `<@&${role.id}>${role.tail}`;
      }
      const user = lookupName(userNames.names, name);
      if (user) {
        return `<@${user.id}>${user.tail}`;
      }
      return match;
    });
  }

  return resolved;
}
