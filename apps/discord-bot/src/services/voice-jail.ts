import {
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";

// Rol "cárcel": no ve, no entra ni habla en NINGUNA sala dinámica; sólo puede
// usar la que crea él mismo. Es distinto de los roles vetados (ban perú), que
// /desperuanizar aplica sala por sala y a mano: esto es global y automático.
//
// La excepción del dueño se marca con un overwrite de MIEMBRO que permite, y
// ese overwrite gana sobre el de rol en la resolución de permisos de Discord.
// Por eso "tiene un overwrite propio que le permite ver" es lo que distingue
// su sala de las demás, sin guardar estado aparte.

const JAIL_DENY = {
  Connect: false,
  SendMessages: false,
  Speak: false,
  ViewChannel: false,
} as const;

const JAIL_ALLOW = {
  Connect: true,
  SendMessages: true,
  Speak: true,
  ViewChannel: true,
} as const;

// Discord limita los overwrites por canal (2 por segundo), así que se espera
// entre edits igual que en /desperuanizar.
const OVERWRITE_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Estructural a propósito: se llama tanto con un GuildMember real como con el
// shape angosto que maneja el handler de voz.
type MemberWithRoles = {
  roles: { cache: { has: (roleId: string) => boolean } };
};

export function memberHasJailRole(
  member: MemberWithRoles | null | undefined,
  roleIds: string[],
): boolean {
  if (!member || roleIds.length === 0) {
    return false;
  }
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

// ¿Este miembro tiene permiso propio (overwrite de miembro) para ver la sala?
// Es la marca de "es su sala".
export function hasOwnerAllow(
  channel: VoiceBasedChannel,
  memberId: string,
): boolean {
  const overwrite = channel.permissionOverwrites.cache.get(memberId);
  return Boolean(overwrite?.allow.has(PermissionFlagsBits.ViewChannel));
}

// Niega ver/entrar/hablar/chatear a cada rol cárcel. Devuelve los ids que no se
// pudieron aplicar (rol borrado, jerarquía del bot, rate limit…).
export async function applyJailToChannel(
  channel: VoiceBasedChannel,
  roleIds: string[],
  options: { ownerId?: string | null; reason: string },
): Promise<{ failed: string[] }> {
  const failed: string[] = [];

  for (const roleId of roleIds) {
    if (!channel.guild.roles.cache.has(roleId)) {
      failed.push(roleId);
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(roleId, JAIL_DENY, {
        reason: options.reason,
        // `type` explícito: sin él, si el rol no está en cache discord.js
        // intenta resolverlo como usuario y tira "User nor a Role".
        type: OverwriteType.Role,
      });
    } catch {
      failed.push(roleId);
    }
    await sleep(OVERWRITE_DELAY_MS);
  }

  // El dueño va después del rol para que su allow quede por encima.
  const ownerId = options.ownerId?.trim();
  if (ownerId) {
    try {
      await channel.permissionOverwrites.edit(ownerId, JAIL_ALLOW, {
        reason: `${options.reason} (dueño de la sala)`,
        type: OverwriteType.Member,
      });
    } catch {
      failed.push(ownerId);
    }
  }

  return { failed };
}

function isVoiceChannel(
  channel: GuildBasedChannel | null,
): channel is VoiceBasedChannel {
  return Boolean(channel && channel.isVoiceBased());
}

// Barrido de arranque: aplica el bloqueo a las salas dinámicas que ya existen.
//
// A quién NO se saca: a un miembro cárcel que está solo en una sala se le
// reconoce como dueño (es la suya) y se le deja el allow, para no expulsarlo de
// su propia sala al prender la función. Si está acompañado, se lo saca: no
// debería estar ahí.
export async function sweepJailedRooms(
  guild: Guild,
  roleIds: string[],
  temporaryChannelIds: string[],
): Promise<{ blocked: number; kicked: number; failed: string[] }> {
  if (roleIds.length === 0 || temporaryChannelIds.length === 0) {
    return { blocked: 0, kicked: 0, failed: [] };
  }

  // Sin la lista completa, el barrido no puede saber quién está adentro.
  if (guild.members.cache.size < guild.memberCount) {
    await guild.members.fetch().catch(() => undefined);
  }

  let blocked = 0;
  let kicked = 0;
  const failed: string[] = [];

  for (const channelId of temporaryChannelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!isVoiceChannel(channel)) {
      continue;
    }

    const jailMembers = [...channel.members.values()].filter((member) =>
      memberHasJailRole(member, roleIds),
    );
    const ownerId =
      jailMembers.length === 1 && channel.members.size === 1
        ? jailMembers[0].id
        : null;

    const result = await applyJailToChannel(channel, roleIds, {
      ownerId,
      reason: "Rol cárcel (barrido automático)",
    });
    failed.push(...result.failed);
    blocked += 1;

    // Con más gente en la sala, el cárcel no tiene por qué estar: se lo saca.
    for (const member of jailMembers) {
      if (member.id === ownerId) {
        continue;
      }
      const ok = await member.voice
        .disconnect("Rol cárcel: no puede entrar a salas dinámicas de otros")
        .then(() => true)
        .catch(() => false);
      if (ok) {
        kicked += 1;
      }
    }
  }

  return { blocked, kicked, failed };
}

// Se llama cuando un miembro entra a una sala dinámica que no es la suya.
// Devuelve true si hubo que sacarlo.
export async function enforceJailOnJoin(
  channel: VoiceBasedChannel,
  member: GuildMember,
  roleIds: string[],
): Promise<boolean> {
  if (!memberHasJailRole(member, roleIds)) {
    return false;
  }
  // Su propia sala: el allow de miembro que se puso al crearla.
  if (hasOwnerAllow(channel, member.id)) {
    return false;
  }
  return member.voice
    .disconnect("Rol cárcel: sólo puede usar la sala que creó")
    .then(() => true)
    .catch(() => false);
}
