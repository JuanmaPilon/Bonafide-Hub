import { env } from "../config/env.js";

// Operaciones sobre los ROLES de Discord (Admin → Roles del hub).
//
// Por qué existe: en Discord crear un rol es tedioso (no se puede duplicar ni
// guardar plantillas) y por API sí se puede. Lo verificado contra la API real
// (2026-09-30):
//   · POST /guilds/:id/roles acepta name, color, hoist, mentionable y
//     permissions (el bitfield va como STRING). El rol nuevo nace al fondo
//     (position 1, justo arriba de @everyone).
//   · Duplicar = leer el rol y crear otro con los mismos campos. Funciona.
//   · Discord PERMITE nombres repetidos (igual le agregamos " (copia)").
//   · PATCH /guilds/:id/roles/:roleId con `position` devuelve 200 pero NO
//     mueve el rol: hay que usar el endpoint EN LOTE PATCH /guilds/:id/roles
//     con [{id, position}]. Ahí sí mueve.
//   · Emoji/ícono de rol requiere el feature ROLE_ICONS (boosts del server):
//     sin eso Discord responde 403 "This server needs more boosts" (50101).
//   · El bot solo puede tocar roles por DEBAJO de su rol más alto.

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordRole = {
  color: number;
  colors?: { primary_color?: number; secondary_color?: number };
  hoist: boolean;
  icon?: string | null;
  id: string;
  managed: boolean;
  mentionable: boolean;
  name: string;
  permissions: string;
  position: number;
  unicode_emoji?: string | null;
};

export type RoleWriteInput = {
  color?: number;
  // Degradado (requiere boosts del servidor). Si no viene, se manda el color
  // plano y Discord limpia el degradado anterior.
  colorSecondary?: number;
  hoist?: boolean;
  mentionable?: boolean;
  name?: string;
  permissions?: string;
};

function botHeaders(): Record<string, string> | null {
  if (!env.DISCORD_BOT_TOKEN) {
    return null;
  }
  return {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
    // Sin user-agent de bot, Discord contesta 40333 con IPs de datacenter.
    "User-Agent": "DiscordBot (https://bonafide-cum.com, 1.0)",
  };
}

// Mensaje legible a partir del error de Discord: los códigos que importan
// traducidos, el resto con el mensaje crudo (queda en el detalle del toast).
async function discordError(response: Response): Promise<string> {
  let body: { code?: number; message?: string } = {};
  try {
    body = (await response.json()) as { code?: number; message?: string };
  } catch {
    body = {};
  }

  if (response.status === 403 && body.code === 50101) {
    return "Discord pide más boosts del servidor para eso (emoji o ícono de rol).";
  }
  if (response.status === 403) {
    return "Discord rechazó la operación: el bot necesita el permiso Gestionar roles y su rol tiene que estar por encima del rol que querés tocar.";
  }
  if (response.status === 400 && body.code === 50035) {
    return "Discord rechazó los datos del rol (nombre o permisos inválidos).";
  }
  return `Discord respondió ${response.status}${body.message ? `: ${body.message}` : ""}`;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ error?: string; response?: Response }> {
  const headers = botHeaders();
  if (!headers) {
    return { error: "DISCORD_BOT_TOKEN is not configured" };
  }
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    return { error: await discordError(response) };
  }
  return { response };
}

export async function listGuildRoles(
  guildId: string,
): Promise<{ error?: string; roles?: DiscordRole[] }> {
  const { error, response } = await request(
    `/guilds/${encodeURIComponent(guildId)}/roles`,
  );
  if (error || !response) {
    return { error };
  }
  return { roles: (await response.json()) as DiscordRole[] };
}

export async function createGuildRole(
  guildId: string,
  input: RoleWriteInput,
): Promise<{ error?: string; role?: DiscordRole }> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) {
    body.name = input.name;
  }
  if (input.permissions !== undefined) {
    body.permissions = input.permissions;
  }
  if (input.hoist !== undefined) {
    body.hoist = input.hoist;
  }
  if (input.mentionable !== undefined) {
    body.mentionable = input.mentionable;
  }
  if (input.colorSecondary !== undefined) {
    body.colors = {
      primary_color: input.color ?? 0,
      secondary_color: input.colorSecondary,
    };
  } else if (input.color !== undefined) {
    body.color = input.color;
  }

  const { error, response } = await request(
    `/guilds/${encodeURIComponent(guildId)}/roles`,
    { body: JSON.stringify(body), method: "POST" },
  );
  if (error || !response) {
    return { error };
  }
  return { role: (await response.json()) as DiscordRole };
}

export async function modifyGuildRole(
  guildId: string,
  roleId: string,
  input: RoleWriteInput,
): Promise<{ error?: string; role?: DiscordRole }> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) {
    body.name = input.name;
  }
  if (input.permissions !== undefined) {
    body.permissions = input.permissions;
  }
  if (input.hoist !== undefined) {
    body.hoist = input.hoist;
  }
  if (input.mentionable !== undefined) {
    body.mentionable = input.mentionable;
  }
  if (input.colorSecondary !== undefined) {
    body.colors = {
      primary_color: input.color ?? 0,
      secondary_color: input.colorSecondary,
    };
  } else if (input.color !== undefined) {
    body.color = input.color;
  }

  const { error, response } = await request(
    `/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`,
    { body: JSON.stringify(body), method: "PATCH" },
  );
  if (error || !response) {
    return { error };
  }
  return { role: (await response.json()) as DiscordRole };
}

export async function deleteGuildRole(
  guildId: string,
  roleId: string,
): Promise<{ error?: string }> {
  const { error } = await request(
    `/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`,
    { method: "DELETE" },
  );
  return { error };
}

// Mueve uno o más roles de posición. Va por el endpoint EN LOTE porque el
// PATCH de un rol ignora `position` (devuelve 200 y no mueve nada).
export async function setRolePositions(
  guildId: string,
  positions: Array<{ id: string; position: number }>,
): Promise<{ error?: string }> {
  if (positions.length === 0) {
    return {};
  }
  const { error } = await request(
    `/guilds/${encodeURIComponent(guildId)}/roles`,
    { body: JSON.stringify(positions), method: "PATCH" },
  );
  return { error };
}

// Posición del rol más alto del bot: solo puede crear/editar/mover roles por
// debajo de esa posición. Se cachea un rato: es un dato que casi no cambia y
// lo pide cada vez que se abre la tarjeta Roles.
const botTopCache = new Map<string, { at: number; position: number }>();
const BOT_TOP_TTL_MS = 5 * 60 * 1000;

export async function botTopRolePosition(guildId: string): Promise<number> {
  const cached = botTopCache.get(guildId);
  if (cached && Date.now() - cached.at < BOT_TOP_TTL_MS) {
    return cached.position;
  }

  const headers = botHeaders();
  if (!headers) {
    return 0;
  }

  let position = 0;
  try {
    const me = await fetch(`${DISCORD_API}/users/@me`, { headers });
    const botId = ((await me.json()) as { id?: string }).id;
    if (botId) {
      const [memberResponse, roles] = await Promise.all([
        fetch(
          `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(botId)}`,
          { headers },
        ),
        listGuildRoles(guildId),
      ]);
      const botRoles =
        ((await memberResponse.json()) as { roles?: string[] }).roles ?? [];
      for (const role of roles.roles ?? []) {
        if (botRoles.includes(role.id)) {
          position = Math.max(position, role.position);
        }
      }
    }
  } catch {
    // Sin dato: devolvemos 0 (la web no bloquea nada por esto).
  }

  botTopCache.set(guildId, { at: Date.now(), position });
  return position;
}

// Escala de colores entre dos tonos: para crear varios roles con una gama
// (ej. los tiers de LoL, de Bronce a Challenger). Devuelve `count` colores en
// int 0xRRGGBB, del primero al último.
export function colorRamp(from: number, to: number, count: number): number[] {
  if (count <= 1) {
    return [from];
  }
  const channels = (value: number): number[] => [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
  const [r1, g1, b1] = channels(from);
  const [r2, g2, b2] = channels(to);
  const colors: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);
    colors.push((r << 16) | (g << 8) | b);
  }
  return colors;
}

// Nombre libre para una copia: "Raid (copia)", "Raid (copia 2)"… Discord
// permite repetir nombres, pero dos roles iguales en la lista son un lío.
export function uniqueRoleName(existingNames: string[], base: string): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  const clean = base.trim().slice(0, 100) || "Rol";
  const first = `${clean} (copia)`.slice(0, 100);
  if (!taken.has(first.toLowerCase())) {
    return first;
  }
  for (let index = 2; index <= 50; index += 1) {
    const candidate = `${clean} (copia ${index})`.slice(0, 100);
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${clean} (copia nueva)`.slice(0, 100);
}
