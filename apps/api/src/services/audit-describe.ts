/**
 * Detalle humano de los cambios que se guardan en el registro de auditoría.
 *
 * Cada acción del panel Admin llama a uno de estos describers, que devuelve
 * una línea del estilo "canal de logs: #general → #auditoría · watcher de
 * raids: sí → no". Si devuelve null, no cambió nada y la acción no se
 * registra (evita entradas vacías cuando el panel manda la config completa).
 *
 * Los ids de Discord (canales y roles) se traducen a nombres con los mapas
 * que se le pasan: un id crudo no le dice nada a quien lee el registro.
 */

import {
  auditNoteChange,
  auditTextChange,
  describeAuditChanges,
  describeListDelta,
  formatAuditMoment,
  orEmpty,
  snippetText,
  type AuditChange,
} from "./audit-change.js";
import type { Communication } from "./communications-store.js";
import type { DailyMessage } from "./daily-messages-store.js";
import type { AdminRoleRule, GuildConfig } from "./guild-config-store.js";
import type { HubEvent } from "./events-store.js";
import type {
  XpConfig,
  XpRoleMultiplier,
  XpRoleRule,
} from "./xp-config-store.js";

/** Nombres legibles para los ids que aparecen en el registro. */
export type AuditNames = {
  channels?: Map<string, string>;
  roles?: Map<string, string>;
  users?: Map<string, string>;
};

// Módulos del panel Admin (los mismos de la web) para el detalle de cambios.
const MODULE_LABELS: Record<string, string> = {
  comunicados: "Comunicados",
  config: "Configuración",
  daily: "Mensajes diarios",
  eventos: "Eventos",
  karuta: "Karuta",
  raids: "Logs de raid",
  xp: "XP",
};

const TIER_LABELS: Record<string, string> = {
  admin: "Admin",
  officer: "Officer",
  subofficer: "Sub Officer",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  mplus: "Mítica+",
  pvp: "PvP",
  raid: "Raid",
  social: "Social",
};

const EVENT_STATUS_LABELS: Record<string, string> = {
  cancelled: "cancelado",
  completed: "completado",
  scheduled: "programado",
};

const STACKING_LABELS: Record<string, string> = {
  replace: "el rol más alto reemplaza a los demás",
  stack: "se acumulan",
};

function channelText(names: AuditNames, value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return `#${names.channels?.get(value) ?? value}`;
}

function roleText(names: AuditNames, value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return `@${names.roles?.get(value) ?? value}`;
}

function userText(names: AuditNames, value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return `@${names.users?.get(value) ?? value}`;
}

function moduleListText(modules: readonly string[]): string | null {
  if (modules.length === 0) {
    return null;
  }
  return modules
    .map((module) => MODULE_LABELS[module] ?? module)
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

function tierListText(tiers: unknown): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return null;
  }
  return tiers
    .map((tier) => TIER_LABELS[String(tier)] ?? String(tier))
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

/** Rango de staff equivalente a un set de módulos (mismo criterio que la web). */
function tierOfModules(
  modules: string[],
  tiers: Record<string, string[]>,
): string | null {
  const key = [...modules].sort().join(",");
  for (const [tier, tierModules] of Object.entries(tiers)) {
    if ([...tierModules].sort().join(",") === key) {
      return TIER_LABELS[tier] ?? tier;
    }
  }
  return null;
}

function hoursText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "(ninguno)";
  }
  return value
    .map(Number)
    .sort((left, right) => right - left)
    .map((hours) => `${hours} h antes`)
    .join(", ");
}

function recurrenceText(event: HubEvent): string | null {
  if (!event.recurrenceEnabled || !event.recurrenceEveryDays) {
    return null;
  }
  const days = event.recurrenceEveryDays;
  const publishBefore = event.recurrencePublishDaysBefore;
  return [
    `cada ${days} día${days === 1 ? "" : "s"}`,
    publishBefore
      ? `publica ${publishBefore} día${publishBefore === 1 ? "" : "s"} antes`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Cómo está publicado un evento en Discord (canal, evento agendado, sala). */
function eventDiscordText(
  event: HubEvent | null,
  names: AuditNames,
): string | null {
  if (!event) {
    return null;
  }
  const parts: string[] = [];
  if (event.publishChannelId) {
    parts.push(`aviso en ${channelText(names, event.publishChannelId)}`);
  }
  const config = event.discordEventConfig;
  if (config?.createScheduledEvent) {
    const where =
      config.entityType === "external"
        ? config.location
        : channelText(names, event.voiceChannelId);
    parts.push(`evento agendado${where ? ` (${where})` : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function communicationPublicationText(
  communication: Communication,
): string | null {
  if (communication.discordMessageIds.length === 0) {
    return null;
  }
  return `publicado (${communication.discordMessageIds.length} mensaje${communication.discordMessageIds.length === 1 ? "" : "s"} en Discord)`;
}

/**
 * Configuración general: canal por canal, umbrales y listas (módulos, roles
 * de música, permisos de staff). El panel manda la config completa, así que
 * solo quedan los campos que de verdad cambiaron.
 */
export function describeGuildConfigChanges(
  previous: GuildConfig,
  next: GuildConfig,
  names: AuditNames,
  staffTiers: Record<string, string[]>,
): string | null {
  const channels = orEmpty((value) => channelText(names, value));
  const roles = orEmpty((value) => roleText(names, value));

  return describeAuditChanges([
    {
      after: next.logsChannelId,
      before: previous.logsChannelId,
      format: channels,
      label: "canal de logs",
    },
    {
      after: next.logsWatchEnabled,
      before: previous.logsWatchEnabled,
      label: "watcher de raids",
    },
    {
      after: next.logsWatchGuild,
      before: previous.logsWatchGuild,
      label: "watcher: guild (Warcraft Logs)",
    },
    {
      after: next.logsWatchRegion,
      before: previous.logsWatchRegion,
      label: "watcher: región (Warcraft Logs)",
    },
    {
      after: next.logsWatchServer,
      before: previous.logsWatchServer,
      label: "watcher: realm (Warcraft Logs)",
    },
    {
      after: next.karutaChannelId,
      before: previous.karutaChannelId,
      format: channels,
      label: "canal de Karuta",
    },
    {
      after: next.karutaWatchEnabled,
      before: previous.karutaWatchEnabled,
      label: "aviso de cartas raras",
    },
    {
      after: next.karutaRarePrintMax,
      before: previous.karutaRarePrintMax,
      label: "impresiones máx. (rara)",
    },
    {
      after: next.karutaRareWishlistMin,
      before: previous.karutaRareWishlistMin,
      label: "wishlist mín. (rara)",
    },
    {
      after: next.karutaSuperRarePrintMax,
      before: previous.karutaSuperRarePrintMax,
      label: "impresiones máx. (súper rara)",
    },
    {
      after: next.karutaSuperRareWishlistMin,
      before: previous.karutaSuperRareWishlistMin,
      label: "wishlist mín. (súper rara)",
    },
    {
      after: next.karutaUltraRarePrintMax,
      before: previous.karutaUltraRarePrintMax,
      label: "impresiones máx. (ultra rara)",
    },
    {
      after: next.karutaUltraRareWishlistMin,
      before: previous.karutaUltraRareWishlistMin,
      label: "wishlist mín. (ultra rara)",
    },
    {
      after: next.dailyMessagesChannelId,
      before: previous.dailyMessagesChannelId,
      format: channels,
      label: "canal de mensajes diarios",
    },
    {
      after: next.dailyMessagesEnabled,
      before: previous.dailyMessagesEnabled,
      label: "mensajes diarios",
    },
    {
      after: next.dailyMessagesMinMinutes,
      before: previous.dailyMessagesMinMinutes,
      label: "mensajes diarios cada X min (mín.)",
    },
    {
      after: next.dailyMessagesMaxMinutes,
      before: previous.dailyMessagesMaxMinutes,
      label: "mensajes diarios cada X min (máx.)",
    },
    {
      after: next.memberLogChannelId,
      before: previous.memberLogChannelId,
      format: channels,
      label: "canal de registro de miembros",
    },
    {
      after: next.dynamicVoiceCreateChannelId,
      before: previous.dynamicVoiceCreateChannelId,
      format: channels,
      label: "canal que crea salas de voz",
    },
    {
      after: next.defaultRoleId,
      before: previous.defaultRoleId,
      format: roles,
      label: "rol por defecto",
    },
    {
      after: next.eventReportChannelId,
      before: previous.eventReportChannelId,
      format: channels,
      label: "canal del informe de asistencia",
    },
    {
      after: next.eventReportDmCreator,
      before: previous.eventReportDmCreator,
      label: "informe por MD al creador",
    },
    {
      after: next.eventReportRoleId,
      before: previous.eventReportRoleId,
      format: roles,
      label: "rol que recibe el mensaje",
    },
    auditNoteChange(
      "personas aparte del informe",
      describeListDelta(
        previous.eventReportUserIds,
        next.eventReportUserIds,
        (userId) => userText(names, userId) ?? userId,
      ),
    ),
    {
      after: next.musicEnabled,
      before: previous.musicEnabled,
      label: "música",
    },
    auditNoteChange(
      "roles con acceso a música",
      describeListDelta(
        previous.musicRoleIds,
        next.musicRoleIds,
        (roleId) => roleText(names, roleId) ?? roleId,
      ),
    ),
    auditNoteChange(
      "roles vetados en voz",
      describeListDelta(
        previous.bannedVoiceRoleIds,
        next.bannedVoiceRoleIds,
        (roleId) => roleText(names, roleId) ?? roleId,
      ),
    ),
    {
      after: next.suggestionsDmTiers,
      before: previous.suggestionsDmTiers,
      format: (value) => tierListText(value) ?? "(ninguno)",
      label: "rangos que reciben sugerencias",
    },
    auditNoteChange(
      "módulos activos",
      describeListDelta(
        previous.enabledModules,
        next.enabledModules,
        (module) => MODULE_LABELS[module] ?? module,
      ),
    ),
    auditNoteChange(
      "juegos de eventos",
      describeListDelta(
        (previous.eventGames ?? []).map((game) => game.key),
        (next.eventGames ?? []).map((game) => game.key),
      ),
    ),
    auditNoteChange(
      "roles de inscripción",
      describeListDelta(
        (previous.eventRoles ?? []).map((role) => role.label),
        (next.eventRoles ?? []).map((role) => role.label),
      ),
    ),
    ...describeStaffPermissionChanges(
      previous.adminRoleModules,
      next.adminRoleModules,
      names,
      staffTiers,
    ),
  ]);
}

/**
 * Permisos de staff: un cambio por rol que entró, salió o cambió de rango.
 * Un rol cuyo set de módulos no coincide con ningún rango se muestra con sus
 * módulos, porque es un acceso armado a mano.
 */
export function describeStaffPermissionChanges(
  previous: AdminRoleRule[] | undefined,
  next: AdminRoleRule[] | undefined,
  names: AuditNames,
  staffTiers: Record<string, string[]>,
): (AuditChange | null)[] {
  const before = new Map((previous ?? []).map((rule) => [rule.roleId, rule]));
  const after = new Map((next ?? []).map((rule) => [rule.roleId, rule]));
  const roleIds = [...new Set([...before.keys(), ...after.keys()])];

  const describe = (rule: AdminRoleRule | undefined): string => {
    if (!rule) {
      return "sin acceso";
    }
    const tier = tierOfModules(rule.modules, staffTiers);
    if (tier) {
      return tier;
    }
    const modules = moduleListText(rule.modules);
    return modules ? `acceso a ${modules}` : "sin módulos";
  };

  return roleIds.map((roleId) => ({
    after: describe(after.get(roleId)),
    before: describe(before.get(roleId)),
    label: `permisos de staff de ${roleText(names, roleId) ?? roleId}`,
  }));
}

/** Configuración de XP: valores, multiplicadores y roles por nivel. */
export function describeXpConfigChanges(
  previous: XpConfig,
  next: XpConfig,
  names: AuditNames,
): string | null {
  const roleName = (roleId: string) => roleText(names, roleId) ?? roleId;

  const multipliersText = (
    list: XpRoleMultiplier[] | undefined,
  ): string | null =>
    list && list.length > 0
      ? [...list]
          .sort((left, right) => left.roleId.localeCompare(right.roleId))
          .map((entry) => `${roleName(entry.roleId)} x${entry.multiplier}`)
          .join(", ")
      : null;

  const levelRolesText = (list: XpRoleRule[] | undefined): string | null =>
    list && list.length > 0
      ? [...list]
          .sort((left, right) => left.level - right.level)
          .map(
            (rule) =>
              `nivel ${rule.level} → ${roleName(rule.roleId)} (${STACKING_LABELS[rule.stacking] ?? rule.stacking})`,
          )
          .join(", ")
      : null;

  return describeAuditChanges([
    {
      after: next.messageXp,
      before: previous.messageXp,
      label: "XP por mensaje",
    },
    {
      after: next.voiceXpPerMinute,
      before: previous.voiceXpPerMinute,
      label: "XP por minuto en voz",
    },
    {
      after: next.cooldownSeconds,
      before: previous.cooldownSeconds,
      label: "enfriamiento entre mensajes (seg)",
    },
    {
      after: next.levelBaseXp,
      before: previous.levelBaseXp,
      label: "XP base por nivel",
    },
    {
      after: next.maxLevel,
      before: previous.maxLevel,
      format: (value) => (Number(value) > 0 ? String(value) : "sin límite"),
      label: "nivel máximo",
    },
    {
      after: next.roleStacking,
      before: previous.roleStacking,
      format: (value) => STACKING_LABELS[String(value)] ?? String(value),
      label: "acumulación de multiplicadores",
    },
    auditTextChange(
      "multiplicadores por rol",
      multipliersText(previous.roleMultipliers),
      multipliersText(next.roleMultipliers),
    ),
    auditTextChange(
      "roles por nivel",
      levelRolesText(previous.levelRoles),
      levelRolesText(next.levelRoles),
    ),
  ]);
}

/** Cambios de un evento, campo por campo (incluida su publicación en Discord). */
export function describeEventChanges(
  previous: HubEvent | null,
  next: HubEvent,
  names: AuditNames,
): string | null {
  const roles = orEmpty((value) => roleText(names, value));
  const tagsText = (tags: { label: string }[] | undefined): string | null =>
    tags && tags.length > 0
      ? [...tags]
          .map((tag) => tag.label)
          .sort((left, right) => left.localeCompare(right))
          .join(", ")
      : null;
  const imageText = (value: string | undefined): string | null =>
    value ? "con imagen" : null;

  return describeAuditChanges([
    {
      after: next.title,
      before: previous?.title,
      label: "título",
    },
    {
      after: next.type,
      before: previous?.type,
      format: (value) => EVENT_TYPE_LABELS[String(value)] ?? String(value),
      label: "tipo",
    },
    {
      after: next.game,
      before: previous?.game,
      label: "juego",
    },
    {
      after: next.description,
      before: previous?.description,
      format: (value) => snippetText(String(value ?? "")),
      label: "descripción",
    },
    {
      after: next.startsAt,
      before: previous?.startsAt,
      format: (value) => formatAuditMoment(value as Date | null),
      label: "fecha y hora",
    },
    {
      after: next.durationMinutes,
      before: previous?.durationMinutes,
      label: "duración (min)",
    },
    {
      after: next.signupDeadline,
      before: previous?.signupDeadline,
      format: (value) => formatAuditMoment(value as Date | null),
      label: "cierre de inscripciones",
    },
    {
      after: next.requiredRoleId,
      before: previous?.requiredRoleId,
      format: roles,
      label: "rol mínimo",
    },
    {
      after: next.characterEnabled,
      before: previous?.characterEnabled,
      label: "personaje obligatorio",
    },
    {
      after: next.reminderHours,
      before: previous?.reminderHours,
      format: hoursText,
      label: "recordatorios",
    },
    {
      after: next.paused,
      before: previous?.paused,
      label: "evento pausado",
    },
    {
      after: next.status,
      before: previous?.status,
      format: (value) => EVENT_STATUS_LABELS[String(value)] ?? String(value),
      label: "estado",
    },
    auditTextChange(
      "recurrencia",
      previous ? recurrenceText(previous) : null,
      recurrenceText(next),
    ),
    auditTextChange(
      "publicación en Discord",
      eventDiscordText(previous, names),
      eventDiscordText(next, names),
    ),
    {
      after: next.discordCleanupOnComplete,
      before: previous?.discordCleanupOnComplete,
      label: "borrar de Discord al completar",
    },
    {
      after: next.imageUrl,
      before: previous?.imageUrl,
      format: (value) =>
        imageText(value as string | undefined) ?? "(sin imagen)",
      label: "imagen",
    },
    auditTextChange("etiquetas", tagsText(previous?.tags), tagsText(next.tags)),
  ]);
}

/** Cambios de un comunicado (título, etiqueta, canal y texto). */
export function describeCommunicationChanges(
  previous: Communication,
  next: Communication,
  names: AuditNames,
): string | null {
  return describeAuditChanges([
    {
      after: next.title,
      before: previous.title,
      label: "título",
    },
    {
      after: next.content,
      before: previous.content,
      format: (value) => snippetText(String(value ?? "")),
      label: "texto",
    },
    {
      after: next.tagLabel,
      before: previous.tagLabel,
      label: "etiqueta",
    },
    {
      after: next.tagColor,
      before: previous.tagColor,
      label: "color de etiqueta",
    },
    {
      after: next.channelId,
      before: previous.channelId,
      format: orEmpty((value) => channelText(names, value)),
      label: "canal",
    },
    {
      after: next.authorName,
      before: previous.authorName,
      label: "autor",
    },
    auditTextChange(
      "publicación en Discord",
      communicationPublicationText(previous),
      communicationPublicationText(next),
    ),
  ]);
}

/** Cambios de una frase del loro (texto y si está activa). */
export function describeDailyMessageChanges(
  previous: DailyMessage | undefined,
  next: DailyMessage,
): string | null {
  return describeAuditChanges([
    {
      after: next.content,
      before: previous?.content,
      format: (value) => snippetText(String(value ?? "")),
      label: "frase",
    },
    {
      after: next.enabled,
      before: previous?.enabled,
      label: "activa",
    },
  ]);
}
