import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  createCommunication,
  createDailyMessage,
  createRaidLog,
  deleteCommunication,
  deleteCommunicationInstance,
  deleteDailyMessage,
  deleteRaidLogPermanent,
  exportXpData,
  getAuditLogs,
  getGuildBoosters,
  getGuildConfig,
  getGuildRoles,
  getGuilds,
  getGuildTextChannels,
  getGuildVoiceChannels,
  getGuildWidgetStatus,
  getLeaderboard,
  getMe,
  getMemberProfile,
  getPublicLeaderboard,
  getXpConfig,
  deleteKarutaDrop,
  getKarutaDrops,
  deleteKarutaCard,
  getKarutaCards,
  getKarutaAlbums,
  deleteKarutaAlbum,
  hideRaidLog,
  importXpData,
  listCommunications,
  listDailyMessages,
  listHiddenRaidLogs,
  listPublishedCommunications,
  listRaidLogs,
  restoreRaidLog,
  loginUrl,
  logout,
  getAdminAccess,
  publishCommunication,
  requestXpSync,
  resetAllXp,
  saveGuildConfig,
  saveXpConfig,
  submitSuggestion,
  updateCommunication,
  updateCommunicationInstance,
  updateDailyMessage,
  COMBAT_ROLES,
  EVENT_TYPES,
  WOW_CLASSES,
  classColor,
  classEmoji,
  createEvent,
  deleteEvent,
  deleteEventImage,
  deleteMyEventSignup,
  getEventImages,
  getEvents,
  roleMeta,
  updateEvent,
  uploadEventImage,
  upsertEventSignup,
  type ApiGuild,
  type AdminAccess,
  type AuditLogEntry,
  type Communication,
  type CommunicationInput,
  type CommunicationInstance,
  type DailyMessage,
  type GuildBooster,
  type GuildChannel,
  type GuildConfig,
  type GuildRole,
  type GuildWidgetStatus,
  type LeaderboardEntry,
  type MemberProfile,
  type PublicLeaderboardEntry,
  type RaidLog,
  type KarutaDrop,
  type KarutaCard,
  type KarutaAlbum,
  type XpConfig,
  type XpImportEntry,
  type XpRoleMultiplier,
  type XpRoleRule,
  type EventSignup,
  type EventImage,
  type HubEvent,
} from "./api";
import "./styles.css";

// Renderiza markdown de forma segura (sanitizado) para el contenido de
// los comunicados en el hub. breaks:true respeta los saltos de línea.
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, breaks: true });
  return DOMPurify.sanitize(typeof html === "string" ? html : "");
}

type HubTab =
  | "home"
  | "dashboard"
  | "comunicados"
  | "raids"
  | "eventos"
  | "memes"
  | "karuta"
  | "perfil"
  | "sugerencias"
  | "admin";

const VALID_TABS: HubTab[] = [
  "home",
  "dashboard",
  "comunicados",
  "raids",
  "eventos",
  "memes",
  "karuta",
  "perfil",
  "sugerencias",
  "admin",
];

// Módulos que el admin puede activar/desactivar desde el panel. Inicio y
// Admin siempre están visibles (no son módulos desactivables).
type HubModule = Exclude<HubTab, "home" | "admin">;

const HUB_MODULES: Array<{
  key: HubModule;
  label: string;
  description: string;
}> = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Resumen con el podio, actividad y estado del servidor.",
  },
  {
    key: "comunicados",
    label: "Comunicados",
    description: "Anuncios y comunicados de la comunidad.",
  },
  {
    key: "raids",
    label: "Raids",
    description: "Logs de raids y próximas incursiones.",
  },
  {
    key: "eventos",
    label: "Eventos",
    description: "Calendario y organización de eventos.",
  },
  {
    key: "memes",
    label: "Memes",
    description: "Highlights, clips y contenido destacado.",
  },
  {
    key: "karuta",
    label: "Karuta",
    description: "Drops, cartas y guía de comandos de Karuta.",
  },
  {
    key: "sugerencias",
    label: "Sugerencias",
    description: "Sugerencias para el staff.",
  },
];

// Rangos de staff: cada rango tiene un set de módulos fijo definido acá
// (desde el código). El owner solo elige qué rango darle a cada rol.
type StaffTier = "admin" | "officer";

const STAFF_TIERS: Record<
  StaffTier,
  { label: string; description: string; modules: string[] }
> = {
  admin: {
    label: "Admin",
    description:
      "Casi todo: configuración, comunicados, raids, loro, XP, Karuta y eventos.",
    modules: [
      "config",
      "comunicados",
      "raids",
      "daily",
      "xp",
      "karuta",
      "eventos",
    ],
  },
  officer: {
    label: "Officer",
    description:
      "Operativo: comunicados, raids/logs, mensajes diarios, Karuta y eventos.",
    modules: ["comunicados", "raids", "daily", "karuta", "eventos"],
  },
};

// Devuelve el rango de un rol según sus módulos guardados (para el selector).
// Si no coincide con un rango exacto, devuelve null.
function tierForModules(modules: string[]): StaffTier | null {
  const sortKey = (list: string[]): string => [...list].sort().join(",");
  if (sortKey(modules) === sortKey(STAFF_TIERS.admin.modules)) {
    return "admin";
  }
  if (sortKey(modules) === sortKey(STAFF_TIERS.officer.modules)) {
    return "officer";
  }
  return null;
}

// El perfil NO es un módulo activable: se accede desde el chip de usuario
// (arriba a la derecha) y nunca se oculta ni aparece en la navegación.

// Si enabledModules está vacío/ausente, todos los módulos quedan activos
// (comportamiento por defecto, evita romper guilds ya configuradas).
function isModuleEnabled(config: GuildConfig, moduleKey: string): boolean {
  const enabled = config.enabledModules;
  if (!enabled || enabled.length === 0) {
    return true;
  }
  // "muro" era el nombre anterior de "karuta": si una guild ya configuró
  // sus módulos antes del rename, seguimos respetando esa elección.
  if (moduleKey === "karuta" && enabled.includes("muro")) {
    return true;
  }
  return enabled.includes(moduleKey);
}

type KarutaSection = "drops" | "raras" | "coleccion" | "guia";

// Slugs de URL para cada sección de Karuta.
const KARUTA_SECTION_SLUGS: Record<KarutaSection, string> = {
  drops: "drops-raros",
  raras: "raras",
  coleccion: "coleccion",
  guia: "guia-de-comandos",
};

function karutaSectionFromSlug(slug: string): KarutaSection | null {
  const entry = Object.entries(KARUTA_SECTION_SLUGS).find(
    ([, value]) => value === slug,
  );
  return entry ? (entry[0] as KarutaSection) : null;
}

// Convierte un título a slug de URL (p. ej. "Sistema de Loot y Addons" →
// "sistema-de-loot-y-addons").
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Parsea el hash:
//   #/karuta/raras → tab "karuta", karutaSection "raras"
//   #/comunicados/sistema-de-loot-y-addons → tab "comunicados" + slug
function parseLocationHash(): {
  tab: HubTab;
  karutaSection: KarutaSection;
  comunicadoSlug: string | null;
} {
  const raw = window.location.hash.replace(/^#\/?/, "").trim().toLowerCase();
  const parts = raw.split("/").filter(Boolean);
  const tab = (VALID_TABS as string[]).includes(parts[0])
    ? (parts[0] as HubTab)
    : "home";
  const karutaSection =
    tab === "karuta" && parts[1]
      ? (karutaSectionFromSlug(parts[1]) ?? "raras")
      : "raras";
  const comunicadoSlug =
    tab === "comunicados" && parts[1] ? parts[1] : null;
  return { tab, karutaSection, comunicadoSlug };
}

function tabFromHash(): HubTab {
  return parseLocationHash().tab;
}

type ToastKind = "success" | "error";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

// Spinner de carga reutilizable (estado de carga de secciones).
function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

// Frases random de Karpindomo en el widget flotante (humor "anuncios").
const KARPINDOMO_LINES: string[] = [
  "Señor, hay karpinchos calientes en su zona",
  "Señor, encontré karpinchos dispuestos a farmear con usted",
  "Señor, hay un karpincho soltero a 50 metros de usted",
  "Señor, ¿le interesa un karpincho con doble pinga?",
  "Señor, los karpinchos de su zona lo están esperando",
];

// Widget de Karpindomo: un botón flotante estilo burbuja de chat (como los
// widgets de ayuda), que se abre con un mensaje random. No usa clases ni
// layout de "popup", así los bloqueadores de publicidad no lo esconden.
function KarpindomoWidget({
  msg,
  open,
  onToggle,
  onClose,
}: {
  msg: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="karpindomo-widget">
      {open ? (
        <div
          className="karpindomo-bubble"
          role="dialog"
          aria-label="Karpindomo"
        >
          <span className="karpindomo-bubble-tail" aria-hidden="true" />
          <div className="karpindomo-bubble-head">
            <strong>Karpindomo</strong>
            <button
              className="karpindomo-bubble-close"
              onClick={onClose}
              aria-label="Cerrar"
              type="button"
            >
              ✕
            </button>
          </div>
          <p>{msg}</p>
        </div>
      ) : null}
      <button
        className={`karpindomo-fab${open ? " open" : ""}`}
        onClick={onToggle}
        aria-label="Karpindomo"
        title="Karpindomo"
        type="button"
      >
        <img className="karpindomo-fab-icon" src="/karpindomo.png" alt="" />
      </button>
    </div>
  );
}

// Lista reutilizable de logs de raid (se usa en la tab Logs y en Raids).
// Cada log es un acordeón: el detalle se expande solo al hacer click.
function RaidLogsList({
  logs,
  onHide,
}: {
  logs: RaidLog[];
  onHide?: (log: RaidLog) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleLog = (logId: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  if (logs.length === 0) {
    return (
      <div className="empty-state">
        Todavía no hay logs de raid. Los logs se sincronizan desde Warcraft Logs
        y aparecen acá y en Discord.
      </div>
    );
  }

  return (
    <>
      {logs.map((log) => {
        const expanded = expandedIds.has(log.id);
        return (
          <article className="comunicado-card comunicado-acc" key={log.id}>
            <button
              className="comunicado-acc-header"
              onClick={() => toggleLog(log.id)}
              type="button"
              aria-expanded={expanded}
            >
              <span className="comunicado-acc-heading">
                <strong>{log.title || "Log de Raid"}</strong>
                {log.firstFightAt ? (
                  <span className="comunicado-date">
                    {new Date(log.firstFightAt).toLocaleDateString()}
                  </span>
                ) : null}
                <span className="raid-log-meta-inline">
                  ⚔️ {log.fightCount} · 💀 {log.kills}
                </span>
              </span>
              <span className="comunicado-acc-heading-right">
                <span className={`raid-log-badge raid-log-${log.status}`}>
                  {log.status === "failed"
                    ? "Sin datos"
                    : log.status === "live"
                      ? "En vivo"
                      : log.discordPosted
                        ? "Publicado"
                        : "En espera"}
                </span>
                <span
                  className={`comunicado-acc-chevron${expanded ? " open" : ""}`}
                  aria-hidden="true"
                >
                  ▸
                </span>
              </span>
            </button>
            {expanded ? (
              <div className="comunicado-acc-body">
                <div className="raid-log-meta">
                  ⚔️ {log.fightCount} fight/s · 💀 {log.kills} kill/s
                </div>
                {log.summary && log.summary.fights.length > 0 ? (
                  <div className="raid-log-fights">
                    {log.summary.fights.map((fight, index) => (
                      <span
                        className={`raid-log-fight${fight.kill ? " kill" : " wipe"}`}
                        key={index}
                      >
                        {fight.name ?? "Fight"} {fight.kill ? "✅" : "❌"}
                      </span>
                    ))}
                  </div>
                ) : log.error ? (
                  <div className="meta-text">⚠️ {log.error}</div>
                ) : null}
                <a
                  className="raid-log-link"
                  href={log.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver en Warcraft Logs ↗
                </a>
                {onHide ? (
                  <div className="comunicado-acc-actions">
                    <button
                      className="ghost-button danger"
                      onClick={() => onHide(log)}
                      type="button"
                    >
                      Eliminar
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

// Convierte una fecha a string compatible con <input type="datetime-local">
// (formato local YYYY-MM-DDTHH:mm, sin zona horaria).
function toDateTimeLocal(value: Date | string): string {
  const date = new Date(value);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Tarjeta de evento del Módulo X: muestra info, roster e inscripción del
// usuario logueado (clase, rol, personaje y estado).
function EventCard({
  canManage,
  event,
  meId,
  onDelete,
  onEdit,
  onRemoveSignup,
  onSignup,
}: {
  canManage: boolean;
  event: HubEvent;
  meId?: string;
  onDelete: (event: HubEvent) => void;
  onEdit: (event: HubEvent) => void;
  onRemoveSignup: (eventId: string) => Promise<void>;
  onSignup: (
    eventId: string,
    input: {
      character?: string;
      role?: string;
      status: string;
      wowClass?: string;
    },
  ) => Promise<void>;
}) {
  const mySignup = meId
    ? event.signups.find((signup) => signup.userId === meId)
    : undefined;

  const [wowClass, setWowClass] = useState(mySignup?.wowClass ?? "");
  const [role, setRole] = useState(mySignup?.role ?? "");
  const [character, setCharacter] = useState(mySignup?.character ?? "");
  const [status, setStatus] = useState(mySignup?.status ?? "yes");
  const [submitting, setSubmitting] = useState(false);

  const typeMeta =
    EVENT_TYPES.find((entry) => entry.key === event.type) ?? EVENT_TYPES[0];

  const counts = {
    no: event.signups.filter((signup) => signup.status === "no").length,
    tentative: event.signups.filter((signup) => signup.status === "tentative")
      .length,
    yes: event.signups.filter((signup) => signup.status === "yes").length,
  };

  const signupsClosed =
    event.status !== "scheduled" ||
    Boolean(
      event.signupDeadline &&
      new Date(event.signupDeadline).getTime() < Date.now(),
    );
  const endAt = event.durationMinutes
    ? new Date(
        new Date(event.startsAt).getTime() + event.durationMinutes * 60_000,
      )
    : undefined;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await onSignup(event.id, {
        character: character.trim() || undefined,
        role: role || undefined,
        status,
        wowClass: wowClass || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="event-card">
      {event.imageUrl ? (
        <img
          className="event-card-image"
          src={event.imageUrl}
          alt={event.title}
        />
      ) : (
        <div className="event-card-image event-card-image-placeholder">
          <span aria-hidden="true">{typeMeta.emoji}</span>
        </div>
      )}
      <div className="event-card-body">
        <div className="event-card-head">
          <strong>{event.title}</strong>
          <div className="event-card-badges">
            {event.status !== "scheduled" ? (
              <span className={`event-card-status ${event.status}`}>
                {event.status === "cancelled" ? "Cancelado" : "Completado"}
              </span>
            ) : null}
            <span className="event-card-type">
              {typeMeta.emoji} {typeMeta.label}
            </span>
          </div>
        </div>
        <div className="event-card-date">
          📅 {new Date(event.startsAt).toLocaleString()}
          {endAt ? ` → ${endAt.toLocaleTimeString()}` : ""}
        </div>
        {event.signupDeadline ? (
          <div className={`event-deadline${signupsClosed ? " closed" : ""}`}>
            {signupsClosed
              ? "🔒 Inscripciones cerradas"
              : `⏳ Cierre de inscripciones: ${new Date(event.signupDeadline).toLocaleString()}`}
          </div>
        ) : null}
        {event.description ? (
          <p className="event-card-desc">{event.description}</p>
        ) : null}
        <div className="event-card-counts">
          <span className="event-count yes">✅ {counts.yes}</span>
          <span className="event-count tentative">🤔 {counts.tentative}</span>
          <span className="event-count no">❌ {counts.no}</span>
        </div>

        {event.signups.length > 0 ? (
          <div className="event-roster">
            {(["tank", "healer", "dps"] as const).map((combatRole) => {
              const roleSignups = event.signups.filter(
                (signup) =>
                  signup.role === combatRole && signup.status === "yes",
              );
              if (roleSignups.length === 0) {
                return null;
              }
              return (
                <div className="event-roster-group" key={combatRole}>
                  <span className="event-roster-role">
                    {roleMeta(combatRole)?.emoji} {roleMeta(combatRole)?.label}
                  </span>
                  {roleSignups.map((signup) => (
                    <span
                      className="event-roster-member"
                      key={signup.id}
                      style={
                        signup.wowClass
                          ? { color: classColor(signup.wowClass) }
                          : undefined
                      }
                    >
                      {classEmoji(signup.wowClass)}{" "}
                      {signup.character
                        ? `${signup.character} (${signup.username})`
                        : signup.username}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="event-roster-empty">Sin inscripciones todavía.</div>
        )}

        {meId ? (
          <div className="event-signup">
            {signupsClosed ? (
              <div className="event-signup-closed">
                🔒 Las inscripciones están cerradas.
                {mySignup ? " Tu inscripción actual queda guardada." : ""}
              </div>
            ) : (
              <>
                <div className="event-signup-status">
                  {(["yes", "tentative", "no"] as const).map((value) => (
                    <button
                      className={`event-status-btn ${value}${status === value ? " active" : ""}`}
                      key={value}
                      onClick={() => setStatus(value)}
                      title={
                        value === "yes"
                          ? "Voy"
                          : value === "tentative"
                            ? "Quizás"
                            : "No voy"
                      }
                      type="button"
                    >
                      {value === "yes"
                        ? "✅"
                        : value === "tentative"
                          ? "🤔"
                          : "❌"}
                    </button>
                  ))}
                </div>
                <div className="event-signup-fields">
                  <select
                    className="select"
                    value={wowClass}
                    onChange={(event) => setWowClass(event.target.value)}
                  >
                    <option value="">Clase (opcional)</option>
                    {WOW_CLASSES.map((cls) => (
                      <option key={cls} value={cls}>
                        {classEmoji(cls)} {cls}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                  >
                    <option value="">Rol (opcional)</option>
                    {COMBAT_ROLES.map((combatRole) => (
                      <option key={combatRole} value={combatRole}>
                        {roleMeta(combatRole)?.emoji}{" "}
                        {roleMeta(combatRole)?.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={character}
                    onChange={(event) => setCharacter(event.target.value)}
                    placeholder="Personaje (opcional)"
                    maxLength={40}
                  />
                </div>
                <div className="event-signup-actions">
                  <button
                    className="primary-button"
                    onClick={() => void submit()}
                    disabled={submitting}
                    type="button"
                  >
                    {submitting ? "Guardando…" : "Guardar inscripción"}
                  </button>
                  {mySignup ? (
                    <button
                      className="ghost-button"
                      onClick={() => void onRemoveSignup(event.id)}
                      type="button"
                    >
                      Quitar inscripción
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {canManage ? (
          <div className="event-card-actions">
            <button
              className="ghost-button"
              onClick={() => onEdit(event)}
              type="button"
            >
              Editar
            </button>
            <button
              className="ghost-button danger"
              onClick={() => onDelete(event)}
              type="button"
            >
              Eliminar evento
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

// Dropdown multi-select de roles (estilo acordeón) para elegir varios.
function RoleMultiSelect({
  label,
  roles,
  value,
  onChange,
  emptyText,
  hint,
}: {
  label: string;
  roles: GuildRole[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  hint?: string;
}) {
  const selectedNames = value
    .map((id) => roles.find((role) => role.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const toggle = (roleId: string): void => {
    onChange(
      value.includes(roleId)
        ? value.filter((id) => id !== roleId)
        : [...value, roleId],
    );
  };

  return (
    <label className="role-multiselect-field">
      <span>{label}</span>
      <details className="role-multiselect">
        <summary className="role-multiselect-summary">
          <span className="role-multiselect-value">
            {selectedNames.length > 0 ? selectedNames.join(", ") : emptyText}
          </span>
          <span className="comunicado-acc-chevron" aria-hidden="true">
            ▸
          </span>
        </summary>
        <div className="role-multiselect-options">
          {roles.length === 0 ? (
            <div className="muted-text">No hay roles disponibles.</div>
          ) : (
            roles.map((role) => {
              const checked = value.includes(role.id);
              return (
                <label className="role-multiselect-option" key={role.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(role.id)}
                  />
                  <span
                    className="role-multiselect-option-name"
                    style={
                      role.color
                        ? {
                            borderColor: `#${role.color.toString(16).padStart(6, "0")}`,
                            color: `#${role.color.toString(16).padStart(6, "0")}`,
                          }
                        : undefined
                    }
                  >
                    {role.name}
                  </span>
                </label>
              );
            })
          )}
        </div>
        {hint ? (
          <div className="muted-text role-multiselect-hint">{hint}</div>
        ) : null}
      </details>
    </label>
  );
}

const LANDING_PREVIEW_USERS = [
  "Azzaio",
  "VoiceMaster",
  "Karpindomo",
  "ShadowNova",
  "LunaHex",
  "Ragnar",
  "Myrth",
] as const;

function formatGuildLabel(guild: ApiGuild): string {
  return guild.owner ? `${guild.name} (owner)` : guild.name;
}

function canAccessAdmin(guild: ApiGuild | null): boolean {
  // El panel de admin es solo para gente privilegiada: únicamente el dueño
  // de la guild (aunque otro tenga permiso de Manage Server en Discord).
  return guild?.owner === true;
}

function guildIconUrl(guild: ApiGuild | null): string | null {
  if (!guild?.icon) {
    return null;
  }

  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`;
}

// URL del avatar de Discord del usuario logueado (gif si es animado).
function userAvatarUrl(user: {
  avatar: string | null;
  id: string;
}): string | undefined {
  if (!user.avatar) {
    return undefined;
  }
  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

function tabLabel(tab: HubTab): string {
  if (tab === "home") {
    return "Inicio";
  }

  if (tab === "dashboard") {
    return "Dashboard";
  }

  if (tab === "comunicados") {
    return "Comunicados";
  }

  if (tab === "raids") {
    return "Raids";
  }

  if (tab === "eventos") {
    return "Eventos";
  }

  if (tab === "memes") {
    return "Memes";
  }

  if (tab === "karuta") {
    return "Karuta";
  }

  if (tab === "perfil") {
    return "Perfil";
  }

  if (tab === "sugerencias") {
    return "Sugerencias";
  }

  return "Admin";
}

function panelTitle(tab: HubTab): string {
  if (tab === "home") {
    return "Inicio";
  }

  if (tab === "dashboard") {
    return "Dashboard";
  }

  if (tab === "comunicados") {
    return "Comunicados";
  }

  if (tab === "raids") {
    return "Raids";
  }

  if (tab === "eventos") {
    return "Eventos";
  }

  if (tab === "memes") {
    return "Memes";
  }

  if (tab === "karuta") {
    return "Karuta";
  }

  if (tab === "perfil") {
    return "Perfil";
  }

  if (tab === "sugerencias") {
    return "Sugerencias";
  }

  return "Panel de Admin";
}

function panelDescription(tab: HubTab): string {
  if (tab === "home") {
    return "Bienvenido al hub de la comunidad.";
  }

  if (tab === "dashboard") {
    return "";
  }

  if (tab === "comunicados") {
    return "Anuncios y comunicados de la comunidad.";
  }

  if (tab === "raids") {
    return "";
  }

  if (tab === "eventos") {
    return "Calendario, estados de asistencia y sincronización con Discord.";
  }

  if (tab === "memes") {
    return "Highlights, clips y contenido curado de la comunidad.";
  }

  if (tab === "karuta") {
    return "";
  }

  if (tab === "perfil") {
    return "Perfil y progreso en la comunidad.";
  }

  if (tab === "sugerencias") {
    return "La idea llega como DM directo al staff del servidor.";
  }

  return "";
}

function ServerStats({
  status,
  loading,
}: {
  status: GuildWidgetStatus | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="stats-grid">
        <div className="stat-tile">
          <span className="label">Estado</span>
          <strong>Cargando...</strong>
        </div>
      </div>
    );
  }

  const connected = status?.presenceCount != null ? status.presenceCount : null;
  const totalMembers = status?.memberCount ?? null;
  const boosts = status?.boostCount ?? null;

  return (
    <div className="stats-grid">
      <div className="stat-tile stat-tile-online">
        <span className="label">Conectados</span>
        <strong className="stat-online">
          {connected ?? "—"}
          <span className="online-dots" aria-hidden="true">
            <span className="online-dot" />
            <span className="online-dot" />
            <span className="online-dot" />
          </span>
        </strong>
      </div>
      <div className="stat-tile">
        <span className="label">Miembros totales</span>
        <strong>{totalMembers ?? "—"}</strong>
      </div>
      <div className="stat-tile stat-tile-boost">
        <span className="label">Boosts de Nitro</span>
        <strong className="stat-boost">
          <span className="boost-gem" aria-hidden="true">
            ◈
          </span>
          {boosts ?? "—"}
        </strong>
      </div>
    </div>
  );
}

type ConfirmDialog = {
  kind: "danger" | "default";
  message: string;
  onConfirm: () => void;
  title: string;
};

function ConfirmModal({
  dialog,
  onClose,
}: {
  dialog: ConfirmDialog;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h4>{dialog.title}</h4>
        <p className="confirm-message">{dialog.message}</p>
        <div className="form-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className={
              dialog.kind === "danger" ? "danger-button" : "primary-button"
            }
            onClick={() => {
              onClose();
              dialog.onConfirm();
            }}
            type="button"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      className="icon-button-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const PODIUM_TIERS = [
  { color: "#ffd700", label: "Oro" },
  { color: "#c0c0c0", label: "Plata" },
  { color: "#cd7f32", label: "Bronce" },
  { color: "#9aa3ad", label: "Hierro" },
  { color: "#b87333", label: "Cobre" },
] as const;

// Guía de comandos de Karuta con el prefijo del server ("k" + comando).
// Basado en el listado oficial de Karuta (karuta.com). Si Karuta agrega o
// renombra comandos, esta lista se actualiza acá.
const KARUTA_COMMAND_GROUPS: Array<{
  title: string;
  commands: Array<{ command: string; description: string }>;
}> = [
  {
    title: "Diario y cooldowns",
    commands: [
      { command: "kdrop", description: "Larga un set de cartas en el canal" },
      { command: "kdaily", description: "Bonus de gold cada 23.5 horas" },
      {
        command: "kvote",
        description: "Link para votar (1 ticket cada 12h, 2 vie-dom)",
      },
      {
        command: "kremind",
        description: "Ver o activar aviso por DM de vote/daily/drop/grab",
      },
    ],
  },
  {
    title: "Colección",
    commands: [
      {
        command: "kcollection [user]",
        description: "Ver la colección de alguien",
      },
      {
        command: "kview [código]",
        description: "Ver una carta en alta resolución",
      },
      { command: "klookup [personaje]", description: "Buscar un personaje" },
    ],
  },
  {
    title: "Wishlist",
    commands: [
      {
        command: "kwishlist [user]",
        description: "Ver la wishlist de alguien",
      },
      {
        command: "kwishadd [personaje]",
        description: "Agregar un personaje a tu wishlist",
      },
      {
        command: "kwishremove [personaje]",
        description: "Sacar un personaje de tu wishlist",
      },
      {
        command: "kwishwatch",
        description: "Avisa por acá cuando dropea algo de tu wishlist",
      },
    ],
  },
  {
    title: "Cartas e ítems",
    commands: [
      {
        command: "kburn [código]",
        description: "Destruye una carta y da recursos",
      },
      { command: "kgive", description: "Regalar una carta a otro user" },
      { command: "ktrade", description: "Tradear una carta con otro user" },
      {
        command: "kmultitrade",
        description: "Tradear varias cartas/ítems a la vez",
      },
      { command: "kitems [user]", description: "Ver el inventario de alguien" },
      { command: "kuse", description: "Usar un ítem del inventario" },
    ],
  },
  {
    title: "Tiendas",
    commands: [
      { command: "kitemshop", description: "Tienda de ítems estándar" },
      { command: "kgemshop", description: "Tienda de gemas" },
      { command: "kticketshop", description: "Tienda de tickets" },
      {
        command: "kbuy [cantidad]",
        description: "Comprar un ítem de una tienda",
      },
    ],
  },
  {
    title: "Tags",
    commands: [
      {
        command: "ktags [user]",
        description: "Ver los tags de un usuario",
      },
      {
        command: "kaddtag [nombre]",
        description: "Agregar un tag a tus cartas",
      },
      {
        command: "kremovetag [nombre]",
        description: "Quitar un tag",
      },
      {
        command: "krenametag [viejo] [nuevo]",
        description: "Renombrar un tag",
      },
      {
        command: "kcleartags",
        description: "Eliminar todos tus tags",
      },
      {
        command: "t:tag",
        description: "Filtro combinable: kb t:t, kc t:t, kburn t:t",
      },
    ],
  },
  {
    title: "Info",
    commands: [
      {
        command: "kuserinfo [user]",
        description: "Ver detalles de un usuario",
      },
      { command: "kserverinfo", description: "Ver detalles del servidor" },
      { command: "kchestview", description: "Ver el cofre del servidor" },
      {
        command: "kchestgive [cantidad]",
        description: "Contribuir gemas al cofre",
      },
      { command: "khelp", description: "Lista completa de comandos de Karuta" },
    ],
  },
];

function HomeView({
  boostCount,
  boosters,
  colorFor,
  leaderboard,
  loading,
  username,
}: {
  boostCount: number | null;
  boosters: GuildBooster[];
  colorFor: (
    level: number,
  ) => { color: string; textShadow?: string } | undefined;
  leaderboard: LeaderboardEntry[];
  loading: boolean;
  username: string | null;
}) {
  const top5 = leaderboard.slice(0, 5);

  return (
    <div className="home-view">
      <section className="home-hero">
        <div className="home-hero-art" aria-hidden="true" />
        <h1 className="brand-gradient">Bienvenido a Bonafide</h1>
        <p>
          Hola <strong className="user-name">{username}</strong>, este es el hub
          de la comunidad.
        </p>
      </section>

      <section className="panel content-panel home-panel">
        <div className="section-header">
          <div>
            <h2>Podio del servidor</h2>
            <p>Top 5 MVP por XP del servidor.</p>
          </div>
        </div>
        {loading ? (
          <div className="empty-state">Cargando podio...</div>
        ) : top5.length === 0 ? (
          <div className="empty-state">
            Aún no hay XP registrado en este servidor.
          </div>
        ) : (
          <div className="podium">
            {top5.map((entry) => (
              <div
                className={`podium-item podium-place-${entry.rank}`}
                key={entry.userId}
              >
                <span className="podium-rank">{entry.rank}</span>
                {entry.avatarUrl ? (
                  <img className="podium-avatar" src={entry.avatarUrl} alt="" />
                ) : (
                  <span className="podium-avatar podium-avatar-placeholder">
                    ?
                  </span>
                )}
                <span className="podium-name" style={colorFor(entry.level)}>
                  {entry.nickname || entry.username || `@${entry.userId}`}
                </span>
                <span className="podium-tier">
                  {entry.rank === 1 ? "👑 " : ""}
                  {PODIUM_TIERS[entry.rank - 1]?.label ?? ""}
                </span>
                <span className="podium-meta">
                  Nivel {entry.level} · {entry.xp} XP
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel content-panel home-panel">
        <div className="section-header">
          <div>
            <h2>Nitro · Boosts del servidor</h2>
            <p>Los miembros que ayudan a crecer el server.</p>
          </div>
          <span className="boost-count-badge">
            <span className="boost-gem" aria-hidden="true">
              ◈
            </span>
            {boostCount ?? "—"}
          </span>
        </div>
        {loading ? (
          <div className="empty-state">Cargando boosters...</div>
        ) : boosters.length === 0 ? (
          <div className="empty-state">Aún no hay boosters registrados.</div>
        ) : (
          <div className="booster-list">
            {boosters.map((booster) => (
              <div className="booster-item" key={booster.userId}>
                {booster.avatarUrl ? (
                  <img
                    className="booster-avatar"
                    src={booster.avatarUrl}
                    alt=""
                  />
                ) : (
                  <span className="booster-avatar booster-avatar-placeholder">
                    ?
                  </span>
                )}
                <span className="booster-name">
                  {booster.nickname || booster.username}
                </span>
                <span className="booster-since">
                  Desde {new Date(booster.premiumSince).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [me, setMe] = useState<{
    avatar: string | null;
    global_name: string | null;
    id: string;
    username: string;
  } | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [guilds, setGuilds] = useState<ApiGuild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [config, setConfig] = useState<GuildConfig>({});
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [dirtyModules, setDirtyModules] = useState<Set<string>>(new Set());
  const [xpDirty, setXpDirty] = useState(false);
  const savedXpRef = useRef<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<AdminAccess | null>(null);
  // Rol seleccionado en el panel de Permisos de staff (solo owner).
  const [staffRoleId, setStaffRoleId] = useState("");
  const [widgetStatus, setWidgetStatus] = useState<GuildWidgetStatus | null>(
    null,
  );
  const [voiceChannels, setVoiceChannels] = useState<GuildChannel[]>([]);
  const [textChannels, setTextChannels] = useState<GuildChannel[]>([]);
  const [guildRoles, setGuildRoles] = useState<GuildRole[]>([]);
  const [xpConfig, setXpConfig] = useState<XpConfig | null>(null);
  const [dailyMessages, setDailyMessages] = useState<DailyMessage[]>([]);
  const [dailyMessageDraft, setDailyMessageDraft] = useState("");
  const [raidLogs, setRaidLogs] = useState<RaidLog[]>([]);
  const [raidLogsLoading, setRaidLogsLoading] = useState(false);
  const [raidLogUrl, setRaidLogUrl] = useState("");
  const [hiddenRaidLogs, setHiddenRaidLogs] = useState<RaidLog[]>([]);
  const [karutaDrops, setKarutaDrops] = useState<KarutaDrop[]>([]);
  const [karutaCards, setKarutaCards] = useState<KarutaCard[]>([]);
  const [karutaAlbums, setKarutaAlbums] = useState<KarutaAlbum[]>([]);
  const [karutaLoading, setKarutaLoading] = useState(false);
  const [karutaSection, setKarutaSection] = useState<KarutaSection>(
    () => parseLocationHash().karutaSection,
  );
  const [comunicadoSlug, setComunicadoSlug] = useState<string | null>(() =>
    parseLocationHash().comunicadoSlug,
  );
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState({
    description: "",
    durationMinutes: "",
    imageUrl: "",
    signupDeadline: "",
    startsAt: "",
    status: "scheduled",
    title: "",
    type: "raid",
  });
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventImages, setEventImages] = useState<EventImage[]>([]);
  const [eventImagesLoading, setEventImagesLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingAction, setSavingAction] = useState<
    | "config"
    | "xp"
    | "panel"
    | "daily"
    | "modules"
    | "permissions"
    | "karuta"
    | null
  >(null);
  const [sendingSuggestion, setSendingSuggestion] = useState(false);
  const [suggestionTitle, setSuggestionTitle] = useState("");
  const [suggestionText, setSuggestionText] = useState("");
  const [roleModal, setRoleModal] = useState<{
    kind: "add" | "remove";
    level: number;
  } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [boosters, setBoosters] = useState<GuildBooster[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [published, setPublished] = useState<CommunicationInstance[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(true);
  const [expandedPublished, setExpandedPublished] = useState<Set<string>>(
    new Set(),
  );
  const [landingPreview, setLandingPreview] = useState<
    PublicLeaderboardEntry[]
  >([]);
  const [commEditor, setCommEditor] = useState<
    (CommunicationInput & { id: string | null }) | null
  >(null);
  const [instanceEditor, setInstanceEditor] = useState<{
    communicationId: string;
    content: string;
    id: string;
    title: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<HubTab>(() => tabFromHash());
  // Tema visual: oscuro por defecto, con persistencia en localStorage.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const stored = window.localStorage.getItem("bonafide-theme");
      return stored === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [karpindomoMsg, setKarpindomoMsg] = useState(KARPINDOMO_LINES[0] ?? "");
  const [karpindomoOpen, setKarpindomoOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(
    null,
  );
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingGuildData, setLoadingGuildData] = useState(false);
  // Indica que ya terminó la PRIMERA validación de sesión. Antes de eso
  // mostramos un spinner (no la landing) para evitar el parpadeo de login.
  const [sessionReady, setSessionReady] = useState(false);
  const loading = loadingSession || loadingGuildData;
  const importFileRef = useRef<HTMLInputElement | null>(null);

  function pushToast(message: string, kind: ToastKind = "success"): void {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }

  // Karpindomo random: solo con sesión. La primera vez aparece sí o sí al
  // poco de entrar; después sigue apareciendo solo con tiempos aleatorios.
  useEffect(() => {
    if (!username) {
      setKarpindomoOpen(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let dismissId: ReturnType<typeof setTimeout> | undefined;

    const appear = (): void => {
      if (cancelled) {
        return;
      }
      const line =
        KARPINDOMO_LINES[Math.floor(Math.random() * KARPINDOMO_LINES.length)] ??
        KARPINDOMO_LINES[0];
      setKarpindomoMsg(line);
      setKarpindomoOpen(true);
      dismissId = setTimeout(() => {
        if (!cancelled) {
          setKarpindomoOpen(false);
        }
      }, 10_000);
    };

    const schedule = (first: boolean): void => {
      if (cancelled) {
        return;
      }
      const delay = first
        ? 15_000 + Math.floor(Math.random() * 30_000) // 15s a 45s
        : 45_000 + Math.floor(Math.random() * 180_000); // 45s a 3m45s
      timeoutId = setTimeout(() => {
        if (cancelled) {
          return;
        }
        // La primera vez aparece siempre; después ~70% por ciclo.
        if (first || Math.random() < 0.7) {
          appear();
        }
        schedule(false);
      }, delay);
    };

    schedule(true);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (dismissId) {
        clearTimeout(dismissId);
      }
    };
  }, [username]);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? null,
    [guilds, selectedGuildId],
  );
  const selectedGuildIcon = guildIconUrl(selectedGuild);
  const isAdminOwner = canAccessAdmin(selectedGuild);
  const adminAccessModules = adminAccess?.modules ?? [];
  // ¿Puede entrar al panel Admin? El owner siempre; el staff solo si tiene
  // algún módulo otorgado por rol (adminRoleModules).
  const adminEnabled = isAdminOwner || adminAccessModules.length > 0;
  // ¿Puede usar un módulo puntual del Admin?
  const canAccess = (module: string): boolean =>
    isAdminOwner || adminAccessModules.includes(module);

  // Rango efectivo del usuario logueado, para el chip (owner/admin/officer).
  const myTier: "owner" | "admin" | "officer" | null = isAdminOwner
    ? "owner"
    : tierForModules(adminAccessModules);

  // Roles asignados a cada rango, para la vista por jerarquía.
  const staffByTier: Record<"admin" | "officer", string[]> = {
    admin: [],
    officer: [],
  };
  for (const role of guildRoles) {
    const rule = (config.adminRoleModules ?? []).find(
      (entry) => entry.roleId === role.id,
    );
    const tier = tierForModules(rule?.modules ?? []);
    if (tier) {
      staffByTier[tier].push(role.name);
    }
  }

  async function refreshSession(): Promise<void> {
    setLoadingSession(true);
    try {
      const me = await getMe();
      if (!me) {
        setUsername(null);
        setGuilds([]);
        setSelectedGuildId(null);
        setConfig({});
        setWidgetStatus(null);
        return;
      }

      const nextGuilds = await getGuilds();
      setMe(me);
      setUsername(me.global_name ?? me.username);
      setGuilds(nextGuilds);
      setSelectedGuildId((current) => current ?? nextGuilds[0]?.id ?? null);
    } catch (error) {
      void error;
      pushToast("No se pudo validar la sesión.", "error");
    } finally {
      setLoadingSession(false);
      setSessionReady(true);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  // Aplica el tema elegido al documento y lo persiste.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("bonafide-theme", theme);
    } catch {
      // Almacenamiento no disponible: el tema solo vale para esta sesión.
    }
  }, [theme]);

  // La config de XP tiene muchos campos: en lugar de marcar cada editor,
  // comparamos el estado actual contra el último guardado.
  useEffect(() => {
    if (!xpConfig) {
      return;
    }
    setXpDirty(JSON.stringify(xpConfig) !== savedXpRef.current);
  }, [xpConfig]);

  useEffect(() => {
    if (!selectedGuildId) {
      return;
    }

    let cancelled = false;
    setConfigLoaded(false);
    setConfig({});
    setLoadingGuildData(true);
    Promise.all([
      getGuildConfig(selectedGuildId),
      getGuildWidgetStatus(selectedGuildId),
      getLeaderboard(selectedGuildId),
      // La config de XP se carga junto con el leaderboard para que los
      // colores por nivel estén listos al primer render (evita el flash de
      // nombres blancos al entrar al Dashboard). Un fallo acá no rompe el
      // resto de la carga.
      getXpConfig(selectedGuildId).catch(() => null),
    ])
      .then(([nextConfig, nextWidgetStatus, nextLeaderboard, nextXpConfig]) => {
        if (cancelled) {
          return;
        }

        setConfig(nextConfig);
        setConfigDirty(false);
        setDirtyModules(new Set());
        setWidgetStatus(nextWidgetStatus);
        setLeaderboard(nextLeaderboard);
        setXpConfig(nextXpConfig);
        savedXpRef.current = nextXpConfig ? JSON.stringify(nextXpConfig) : null;
        setXpDirty(false);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void error;
          pushToast("No se pudo cargar la configuración.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConfigLoaded(true);
          setLoadingGuildData(false);
        }
      });

    // Permisos de admin: se cargan por separado para que un fallo acá no
    // rompa el resto de los datos de la guild.
    getAdminAccess(selectedGuildId)
      .then((next) => {
        if (!cancelled) {
          setAdminAccess(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdminAccess({ modules: [], owner: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId || !adminEnabled) {
      setCommunications([]);
      return;
    }
    let cancelled = false;
    listCommunications(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setCommunications(list);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedGuildId, adminEnabled]);

  useEffect(() => {
    if (!selectedGuildId) {
      setPublished([]);
      setPublishedLoading(true);
      return;
    }
    let cancelled = false;
    setPublishedLoading(true);
    listPublishedCommunications(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setPublished(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setPublishedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId || activeTab !== "raids") {
      setRaidLogs([]);
      setRaidLogsLoading(false);
      return;
    }
    let cancelled = false;
    let firstLoad = true;

    const refreshRaidLogs = (): void => {
      if (firstLoad) {
        setRaidLogsLoading(true);
      }
      void listRaidLogs(selectedGuildId)
        .then((logs) => {
          if (!cancelled) {
            setRaidLogs(logs);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            setRaidLogsLoading(false);
            firstLoad = false;
          }
        });
    };

    refreshRaidLogs();
    const refreshTimer = window.setInterval(refreshRaidLogs, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [activeTab, selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId || activeTab !== "karuta") {
      setKarutaDrops([]);
      setKarutaCards([]);
      setKarutaAlbums([]);
      setKarutaLoading(false);
      return;
    }
    let cancelled = false;

    const refreshKaruta = (): Promise<void> => {
      return Promise.allSettled([
        getKarutaDrops(selectedGuildId),
        getKarutaCards(selectedGuildId),
        getKarutaAlbums(selectedGuildId),
      ]).then(([drops, cards, albums]) => {
        if (cancelled) {
          return;
        }
        if (drops.status === "fulfilled") {
          setKarutaDrops(drops.value);
        }
        if (cards.status === "fulfilled") {
          setKarutaCards(cards.value);
        }
        if (albums.status === "fulfilled") {
          setKarutaAlbums(albums.value);
        }
      });
    };

    let firstLoad = true;
    const runRefresh = (): void => {
      if (firstLoad) {
        setKarutaLoading(true);
      }
      void refreshKaruta().finally(() => {
        if (!cancelled) {
          setKarutaLoading(false);
          firstLoad = false;
        }
      });
    };

    runRefresh();
    const refreshTimer = window.setInterval(runRefresh, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [activeTab, selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId || activeTab !== "eventos") {
      setEvents([]);
      setEventsLoading(false);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    getEvents(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setEvents(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setEventsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  // Borra un drop de Karuta (admin/owner) y lo saca del feed local.
  function handleDeleteKarutaDrop(drop: KarutaDrop): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar drop",
      message: `¿Eliminar "${drop.cardName ?? "esta carta"}" del feed de Karuta?`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteKarutaDrop(selectedGuildId, drop.id);
            setKarutaDrops((current) =>
              current.filter((entry) => entry.id !== drop.id),
            );
            pushToast("Drop eliminado.", "success");
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo eliminar el drop.",
              "error",
            );
          }
        })();
      },
    });
  }

  // Quita manualmente una carta del registro de posesión (admin/owner).
  function handleDeleteKarutaCard(card: KarutaCard): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Quitar carta",
      message: `¿Quitar "${card.cardName ?? "esta carta"}" del listado?`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteKarutaCard(selectedGuildId, card.id);
            setKarutaCards((current) =>
              current.filter((entry) => entry.id !== card.id),
            );
            pushToast("Carta quitada del registro.", "success");
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo quitar la carta.",
              "error",
            );
          }
        })();
      },
    });
  }

  function handleDeleteKarutaAlbum(album: KarutaAlbum): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Quitar colección",
      message: `¿Quitar "${album.albumName ?? "esta colección"}" de la sección?`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteKarutaAlbum(selectedGuildId, album.id);
            setKarutaAlbums((current) =>
              current.filter((entry) => entry.id !== album.id),
            );
            pushToast("Colección quitada.", "success");
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo quitar la colección.",
              "error",
            );
          }
        })();
      },
    });
  }

  async function handleEventSignup(
    eventId: string,
    input: {
      character?: string;
      role?: string;
      status: string;
      wowClass?: string;
    },
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await upsertEventSignup(selectedGuildId, eventId, input);
      const list = await getEvents(selectedGuildId);
      setEvents(list);
      pushToast("Inscripción guardada.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la inscripción.",
        "error",
      );
    }
  }

  async function handleRemoveEventSignup(eventId: string): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await deleteMyEventSignup(selectedGuildId, eventId);
      if (me) {
        setEvents((current) =>
          current.map((event) =>
            event.id === eventId
              ? {
                  ...event,
                  signups: event.signups.filter(
                    (signup) => signup.userId !== me.id,
                  ),
                }
              : event,
          ),
        );
      }
      pushToast("Inscripción quitada.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo quitar la inscripción.",
        "error",
      );
    }
  }

  function handleDeleteEvent(event: HubEvent): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar evento",
      message: `¿Eliminar "${event.title}" y todas sus inscripciones?`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteEvent(selectedGuildId, event.id);
            setEvents((current) =>
              current.filter((entry) => entry.id !== event.id),
            );
            pushToast("Evento eliminado.", "success");
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo eliminar el evento.",
              "error",
            );
          }
        })();
      },
    });
  }

  function handleCloseEventForm(): void {
    setShowEventForm(false);
    setEditingEventId(null);
    setEventForm({
      description: "",
      durationMinutes: "",
      imageUrl: "",
      signupDeadline: "",
      startsAt: "",
      status: "scheduled",
      title: "",
      type: "raid",
    });
  }

  function handleEditEvent(event: HubEvent): void {
    setEditingEventId(event.id);
    setEventForm({
      description: event.description ?? "",
      durationMinutes:
        event.durationMinutes != null ? String(event.durationMinutes) : "",
      imageUrl: event.imageUrl ?? "",
      signupDeadline: event.signupDeadline
        ? toDateTimeLocal(event.signupDeadline)
        : "",
      startsAt: toDateTimeLocal(event.startsAt),
      status: event.status,
      title: event.title,
      type: event.type,
    });
    setShowEventForm(true);
  }

  // Sube una imagen a la biblioteca y la selecciona como imagen del evento.
  async function handleImageFileChange(
    changeEvent: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = changeEvent.target.files?.[0];
    if (!file || !selectedGuildId) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      pushToast("El archivo debe ser una imagen.", "error");
      changeEvent.target.value = "";
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      pushToast("La imagen es demasiado grande (máx. 3MB).", "error");
      changeEvent.target.value = "";
      return;
    }
    setUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const image = await uploadEventImage(selectedGuildId, {
        dataUrl,
        name: file.name,
      });
      setEventImages((current) => [image, ...current]);
      setEventForm((current) => ({ ...current, imageUrl: image.dataUrl }));
      pushToast("Imagen subida a la biblioteca.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "No se pudo subir la imagen.",
        "error",
      );
    } finally {
      setUploadingImage(false);
      changeEvent.target.value = "";
    }
  }

  async function handleDeleteEventImage(image: EventImage): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await deleteEventImage(selectedGuildId, image.id);
      setEventImages((current) =>
        current.filter((entry) => entry.id !== image.id),
      );
      pushToast("Imagen eliminada de la biblioteca.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la imagen.",
        "error",
      );
    }
  }

  // Crea o actualiza un evento desde la web (sin intervención de Discord).
  async function handleSaveEvent(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    if (!eventForm.title.trim() || !eventForm.startsAt) {
      pushToast("Faltan título o fecha/hora.", "error");
      return;
    }
    setCreatingEvent(true);
    try {
      if (editingEventId) {
        const updated = await updateEvent(selectedGuildId, editingEventId, {
          description: eventForm.description.trim() || undefined,
          durationMinutes: eventForm.durationMinutes
            ? Number(eventForm.durationMinutes)
            : null,
          imageUrl: eventForm.imageUrl || undefined,
          signupDeadline: eventForm.signupDeadline || null,
          startsAt: eventForm.startsAt,
          status: eventForm.status,
          title: eventForm.title.trim(),
          type: eventForm.type,
        });
        setEvents((current) =>
          current
            .map((entry) => (entry.id === updated.id ? updated : entry))
            .sort(
              (a, b) =>
                new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
            ),
        );
        pushToast("Evento actualizado.", "success");
      } else {
        const created = await createEvent(selectedGuildId, {
          description: eventForm.description.trim() || undefined,
          durationMinutes: eventForm.durationMinutes
            ? Number(eventForm.durationMinutes)
            : undefined,
          imageUrl: eventForm.imageUrl || undefined,
          signupDeadline: eventForm.signupDeadline || undefined,
          startsAt: eventForm.startsAt,
          title: eventForm.title.trim(),
          type: eventForm.type,
        });
        setEvents((current) =>
          [...current, created].sort(
            (a, b) =>
              new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
          ),
        );
        pushToast("Evento creado.", "success");
      }
      handleCloseEventForm();
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el evento.",
        "error",
      );
    } finally {
      setCreatingEvent(false);
    }
  }

  useEffect(() => {
    if (!selectedGuildId || !showEventForm) {
      return;
    }
    let cancelled = false;
    setEventImagesLoading(true);
    getEventImages(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setEventImages(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setEventImagesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGuildId, showEventForm]);

  useEffect(() => {
    if (activeTab !== "perfil" || !selectedGuildId || !me) {
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    getMemberProfile(selectedGuildId, me.id)
      .then((nextProfile) => {
        if (!cancelled) {
          setProfile(nextProfile);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId, me]);

  async function refreshCommunications(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    const [list, publishedList] = await Promise.all([
      listCommunications(selectedGuildId),
      listPublishedCommunications(selectedGuildId),
    ]);
    setCommunications(list);
    setPublished(publishedList);
  }

  function togglePublished(id: string): void {
    setExpandedPublished((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Comunicado seleccionado por URL (#/comunicados/<slug>).
  const currentComunicado = comunicadoSlug
    ? (published.find(
        (comm) => slugifyTitle(comm.title) === comunicadoSlug,
      ) ?? null)
    : null;

  async function copyComunicadoLink(comm: { title: string }): Promise<void> {
    const url = `${window.location.origin}${window.location.pathname}#/comunicados/${slugifyTitle(comm.title)}`;
    try {
      await navigator.clipboard.writeText(url);
      pushToast("Enlace del comunicado copiado.", "success");
    } catch {
      pushToast("No se pudo copiar el enlace.", "error");
    }
  }

  async function handleSaveCommunication(): Promise<void> {
    if (!selectedGuildId || !commEditor) {
      return;
    }
    if (!commEditor.title?.trim() || !commEditor.content?.trim()) {
      pushToast("Faltan título y/o contenido.", "error");
      return;
    }
    try {
      if (commEditor.id) {
        await updateCommunication(selectedGuildId, commEditor.id, {
          title: commEditor.title,
          content: commEditor.content,
          channelId: commEditor.channelId,
        });
        pushToast("Plantilla actualizada.", "success");
      } else {
        await createCommunication(selectedGuildId, commEditor);
        pushToast("Plantilla creada.", "success");
      }
      setCommEditor(null);
      await refreshCommunications();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al guardar.",
        "error",
      );
    }
  }

  async function handlePublishCommunication(id: string): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await publishCommunication(selectedGuildId, id);
      const target = communications.find((comm) => comm.id === id);
      pushToast(
        target?.channelId
          ? "Publicado en Discord."
          : "Publicado solo en la web.",
        "success",
      );
      await refreshCommunications();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al publicar.",
        "error",
      );
    }
  }

  function requestDeleteCommunication(comm: Communication): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar plantilla",
      message: `¿Eliminar la plantilla "${comm.title}" y todos sus mensajes publicados? Esta acción no se puede deshacer.`,
      onConfirm: () => {
        void handleDeleteCommunication(comm.id);
      },
    });
  }

  async function handleDeleteCommunication(id: string): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await deleteCommunication(selectedGuildId, id);
      pushToast("Plantilla eliminada.", "success");
      await refreshCommunications();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al eliminar.",
        "error",
      );
    }
  }

  function requestDeleteInstance(instance: CommunicationInstance): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar mensaje",
      message: `¿Eliminar el mensaje "${instance.title}" de Discord? La plantilla se conserva.`,
      onConfirm: () => {
        void handleDeleteInstance(instance.communicationId, instance.id);
      },
    });
  }

  async function handleDeleteInstance(
    communicationId: string,
    instanceId: string,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await deleteCommunicationInstance(
        selectedGuildId,
        communicationId,
        instanceId,
      );
      pushToast("Mensaje eliminado de Discord.", "success");
      await refreshCommunications();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al eliminar.",
        "error",
      );
    }
  }

  async function handleSaveInstance(): Promise<void> {
    if (!selectedGuildId || !instanceEditor) {
      return;
    }
    if (!instanceEditor.title?.trim() || !instanceEditor.content?.trim()) {
      pushToast("Faltan título y/o contenido.", "error");
      return;
    }
    try {
      await updateCommunicationInstance(
        selectedGuildId,
        instanceEditor.communicationId,
        instanceEditor.id,
        {
          title: instanceEditor.title,
          content: instanceEditor.content,
        },
      );
      pushToast("Mensaje editado (Discord + web).", "success");
      setInstanceEditor(null);
      await refreshCommunications();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al editar.",
        "error",
      );
    }
  }

  // Marca un módulo como "con cambios sin guardar". El botón Guardar de cada
  // tarjeta solo se muestra cuando su módulo está sucio.
  function markDirty(module: string): void {
    setDirtyModules((current) => new Set(current).add(module));
  }

  function clearDirty(module: string): void {
    setDirtyModules((current) => {
      const next = new Set(current);
      next.delete(module);
      return next;
    });
  }

  function isDirty(module: string): boolean {
    return dirtyModules.has(module);
  }

  // Actualiza la config y marca el módulo correspondiente como modificado.
  // Sin `module`, aplica a la tarjeta "Configuración varias" (configDirty).
  function editConfig(
    updater: (current: GuildConfig) => GuildConfig,
    module?: string,
  ): void {
    if (module) {
      markDirty(module);
    } else {
      setConfigDirty(true);
    }
    setConfig(updater);
  }

  async function handleSave(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("config");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, config);
      setConfig(nextConfig);
      setConfigDirty(false);
      pushToast("Configuración guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  // ── Karuta (watcher + criterios de rareza) ───────────────────────
  async function handleSaveKarutaConfig(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("karuta");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        karutaWatchEnabled: config.karutaWatchEnabled,
        karutaChannelId: config.karutaChannelId,
        karutaRarePrintMax: config.karutaRarePrintMax,
        karutaRareWishlistMin: config.karutaRareWishlistMin,
      });
      clearDirty("karuta");
      setConfig(nextConfig);
      pushToast("Configuración de Karuta guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración de Karuta.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  // ── Módulos activos (toggles del panel Admin) ────────────────────
  function toggleModule(key: string): void {
    markDirty("modules");
    setConfig((current) => {
      const enabled = new Set(
        current.enabledModules && current.enabledModules.length > 0
          ? current.enabledModules
          : HUB_MODULES.map((mod) => mod.key),
      );
      if (enabled.has(key)) {
        enabled.delete(key);
      } else {
        enabled.add(key);
      }
      return { ...current, enabledModules: [...enabled] };
    });
  }

  async function handleSaveModules(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    setSavingAction("modules");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        enabledModules: config.enabledModules ?? [],
      });
      setConfig(nextConfig);
      clearDirty("modules");
      pushToast("Módulos actualizados.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar los módulos.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleSaveStaffPermissions(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    setSavingAction("permissions");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        adminRoleModules: config.adminRoleModules ?? [],
      });
      setConfig(nextConfig);
      clearDirty("permissions");
      pushToast("Permisos de staff actualizados.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar los permisos.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleSendSuggestion(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    const title = suggestionTitle.trim();
    const text = suggestionText.trim();
    if (!title || !text) {
      pushToast("Completá el título y el texto.", "error");
      return;
    }
    setSendingSuggestion(true);
    try {
      await submitSuggestion(selectedGuildId, title, text);
      setSuggestionTitle("");
      setSuggestionText("");
      pushToast("Sugerencia enviada al staff.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo enviar la sugerencia.", "error");
    } finally {
      setSendingSuggestion(false);
    }
  }

  // ── Mensajes diarios (loro de Karpindomo) ────────────────────────
  async function handleSaveDailyConfig(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("daily");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        dailyMessagesChannelId: config.dailyMessagesChannelId,
        dailyMessagesEnabled: config.dailyMessagesEnabled,
        dailyMessagesMaxMinutes: config.dailyMessagesMaxMinutes,
        dailyMessagesMinMinutes: config.dailyMessagesMinMinutes,
      });
      clearDirty("daily");
      setConfig(nextConfig);
      pushToast("Configuración del loro guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración del loro.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleCreateDailyMessage(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    const content = dailyMessageDraft.trim();
    if (!content) {
      pushToast("Escribí una frase primero.", "error");
      return;
    }

    try {
      const created = await createDailyMessage(selectedGuildId, content);
      setDailyMessages((current) => [...current, created]);
      setDailyMessageDraft("");
      pushToast("Frase del loro guardada.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al guardar la frase.",
        "error",
      );
    }
  }

  async function handleToggleDailyMessage(
    message: DailyMessage,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const updated = await updateDailyMessage(selectedGuildId, message.id, {
        enabled: !message.enabled,
      });
      setDailyMessages((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      pushToast(
        updated.enabled ? "Frase activada." : "Frase pausada.",
        "success",
      );
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "Error al actualizar la frase.",
        "error",
      );
    }
  }

  async function handleDeleteDailyMessage(
    message: DailyMessage,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await deleteDailyMessage(selectedGuildId, message.id);
      setDailyMessages((current) =>
        current.filter((entry) => entry.id !== message.id),
      );
      pushToast("Frase eliminada.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al eliminar la frase.",
        "error",
      );
    }
  }

  // ── Logs de Raid (Warcraft Logs) ─────────────────────────────────
  async function refreshRaidLogs(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const logs = await listRaidLogs(selectedGuildId);
      setRaidLogs(logs);
    } catch {
      // silencioso: se muestra vacío si falla
    }
  }

  async function handleCreateRaidLog(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    const url = raidLogUrl.trim();
    if (!url) {
      pushToast("Falta el link de Warcraft Logs.", "error");
      return;
    }

    try {
      const result = await createRaidLog(selectedGuildId, url);
      setRaidLogUrl("");
      pushToast(
        result.posted
          ? "Log de raid agregado y publicado en Discord."
          : "Log de raid agregado. Se publicará cuando tenga datos.",
        "success",
      );
      await refreshRaidLogs();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al agregar el log.",
        "error",
      );
    }
  }

  async function handleHideRaidLog(log: RaidLog): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await hideRaidLog(selectedGuildId, log.id);
      setRaidLogs((current) => current.filter((entry) => entry.id !== log.id));
      pushToast("Log eliminado. No se va a volver a capturar.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al eliminar el log.",
        "error",
      );
    }
  }

  function requestHideRaidLog(log: RaidLog): void {
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar log de raid",
      message: `¿Eliminar "${log.title || log.reportCode}"? Se saca de la lista y el watcher no lo vuelve a capturar. Podés recuperarlo desde el panel Admin → Logs de Raid.`,
      onConfirm: () => {
        void handleHideRaidLog(log);
      },
    });
  }

  // ── Logs ocultos: restaurar o borrar definitivamente ─────────────
  async function refreshHiddenRaidLogs(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const logs = await listHiddenRaidLogs(selectedGuildId);
      setHiddenRaidLogs(logs);
    } catch {
      setHiddenRaidLogs([]);
    }
  }

  function requestShowRaidLog(log: RaidLog): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "default",
      title: "Restaurar log",
      message: `¿Volver a mostrar "${log.title || log.reportCode}" en la lista de logs?`,
      onConfirm: () => {
        void (async () => {
          try {
            await restoreRaidLog(selectedGuildId, log.id);
            setHiddenRaidLogs((current) =>
              current.filter((entry) => entry.id !== log.id),
            );
            pushToast("Log restaurado.", "success");
            void refreshRaidLogs();
          } catch (error) {
            pushToast(
              error instanceof Error ? error.message : "Error al restaurar.",
              "error",
            );
          }
        })();
      },
    });
  }

  function requestPermanentDeleteRaidLog(log: RaidLog): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Borrar definitivamente",
      message: `¿Borrar "${log.title || log.reportCode}" para siempre? Ya no podrás recuperarlo y, si el raid sigue en Warcraft Logs, el watcher lo volverá a capturar.`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteRaidLogPermanent(selectedGuildId, log.id);
            setHiddenRaidLogs((current) =>
              current.filter((entry) => entry.id !== log.id),
            );
            pushToast("Log borrado definitivamente.", "success");
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "Error al borrar el log.",
              "error",
            );
          }
        })();
      },
    });
  }

  async function handleSaveLogsConfig(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("config");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        logsChannelId: config.logsChannelId,
      });
      clearDirty("logsChannel");
      setConfig(nextConfig);
      pushToast("Canal de logs guardado.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar el canal de logs.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleSaveLogsWatch(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("config");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        logsWatchEnabled: config.logsWatchEnabled,
        logsWatchGuild: config.logsWatchGuild,
        logsWatchRegion: config.logsWatchRegion,
        logsWatchServer: config.logsWatchServer,
      });
      setConfig(nextConfig);
      clearDirty("logsWatch");
      pushToast("Vigilado de gremio guardado.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar el vigilado de gremio.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleSaveXp(): Promise<void> {
    if (!selectedGuildId || !xpConfig) {
      return;
    }

    setSavingAction("xp");
    try {
      const nextXp = await saveXpConfig(selectedGuildId, xpConfig);
      setXpConfig(nextXp);
      savedXpRef.current = JSON.stringify(nextXp);
      setXpDirty(false);
      pushToast("Configuración de XP guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración de XP.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleExportXp(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setLoadingGuildData(true);
    try {
      const payload = await exportXpData(selectedGuildId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bonafide-xp-${selectedGuildId}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      pushToast(
        `XP exportada (${payload.entries.length} usuarios).`,
        "success",
      );
    } catch (error) {
      void error;
      pushToast("No se pudo exportar el XP.", "error");
    } finally {
      setLoadingGuildData(false);
    }
  }

  async function handleImportXpFile(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedGuildId) {
      return;
    }

    const text = await file.text().catch(() => null);
    if (!text) {
      pushToast("No se pudo leer el archivo.", "error");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      pushToast("El archivo no es un JSON válido.", "error");
      return;
    }

    let entries: XpImportEntry[] = [];
    const payload = parsed as { entries?: XpImportEntry[] };
    if (Array.isArray(payload.entries)) {
      entries = payload.entries;
    } else if (Array.isArray(parsed)) {
      entries = parsed as XpImportEntry[];
    }

    if (entries.length === 0) {
      pushToast("El archivo no tiene entradas de XP válidas.", "error");
      return;
    }

    setConfirmDialog({
      kind: "default",
      title: "Importar XP",
      message: `¿Importar ${entries.length} perfil/es de XP? Se reemplazarán los niveles/XP actuales de esos usuarios.`,
      onConfirm: () => {
        void (async () => {
          if (!selectedGuildId) {
            return;
          }
          setLoadingGuildData(true);
          try {
            const result = await importXpData(selectedGuildId, entries);
            const nextLeaderboard = await getLeaderboard(selectedGuildId);
            setLeaderboard(nextLeaderboard);
            pushToast(
              `${result.imported} perfiles de XP importados.`,
              "success",
            );
          } catch (error) {
            void error;
            pushToast("No se pudo importar el XP.", "error");
          } finally {
            setLoadingGuildData(false);
          }
        })();
      },
    });
  }

  function requestResetAllXp(): void {
    if (!selectedGuildId) {
      return;
    }

    setConfirmDialog({
      kind: "danger",
      title: "Resetear niveles de todos",
      message:
        "⚠️ ¡CUIDADO! Vas a eliminar los niveles y XP de TODOS los miembros del servidor. Esta acción no se puede deshacer.",
      onConfirm: () => {
        void performResetAllXp();
      },
    });
  }

  async function performResetAllXp(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setLoadingGuildData(true);
    try {
      const result = await resetAllXp(selectedGuildId);
      setLeaderboard([]);
      pushToast(
        `Se reiniciaron los niveles de ${result.reset} usuarios.`,
        "success",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      pushToast(`No se pudo resetear el XP: ${message}`, "error");
    } finally {
      setLoadingGuildData(false);
    }
  }

  function requestSyncRoles(): void {
    if (!selectedGuildId) {
      return;
    }

    setConfirmDialog({
      kind: "default",
      title: "Re-sincronizar roles",
      message:
        "¿Re-sincronizar roles y prefijos de nombre de todos los miembros según su nivel actual? El bot lo procesará en unos segundos.",
      onConfirm: () => {
        void performSyncRoles();
      },
    });
  }

  async function performSyncRoles(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setLoadingGuildData(true);
    try {
      await requestXpSync(selectedGuildId);
      pushToast(
        "Sincronización encolada. El bot aplicará roles y prefijos en unos segundos.",
        "success",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      pushToast(`No se pudo encolar la sincronización: ${message}`, "error");
    } finally {
      setLoadingGuildData(false);
    }
  }

  function levelColorFor(level: number): string | undefined {
    if (!xpConfig) {
      return undefined;
    }

    let color: string | undefined;
    for (const rule of xpConfig.levelRoles) {
      if (rule.level <= level && rule.color) {
        color = rule.color;
      }
    }

    return color;
  }

  function levelStyleFor(
    level: number,
    glow = true,
  ): { color: string; textShadow?: string } | undefined {
    const color = levelColorFor(level);
    return color
      ? glow
        ? { color, textShadow: `0 0 6px ${color}, 0 0 14px ${color}66` }
        : { color }
      : undefined;
  }

  async function refreshAuditLogs(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const logs = await getAuditLogs(selectedGuildId);
      setAuditLogs(logs);
    } catch {
      // silencioso: puede fallar si el usuario no es owner
    }
  }

  function updateXpRole(level: number, patch: Partial<XpRoleRule>): void {
    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        levelRoles: current.levelRoles.map((rule) =>
          rule.level === level ? { ...rule, ...patch } : rule,
        ),
      };
    });
  }

  function changeXpRoleLevel(currentLevel: number, rawValue: number): void {
    if (!Number.isFinite(rawValue)) {
      return;
    }

    const nextLevel = Math.floor(rawValue);
    if (nextLevel < 0) {
      return;
    }

    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      if (nextLevel === currentLevel) {
        return { ...current };
      }

      const alreadyExists = current.levelRoles.some(
        (rule) => rule.level === nextLevel && rule.level !== currentLevel,
      );
      if (alreadyExists) {
        pushToast("Ese nivel ya está asignado a otro rol.", "error");
        return { ...current };
      }

      return {
        ...current,
        levelRoles: current.levelRoles.map((rule) =>
          rule.level === currentLevel ? { ...rule, level: nextLevel } : rule,
        ),
      };
    });
  }

  function addXpRole(): void {
    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      const nextLevel =
        current.levelRoles.reduce((max, rule) => Math.max(max, rule.level), 0) +
        1;

      return {
        ...current,
        levelRoles: [
          ...current.levelRoles,
          {
            addRoleIds: [],
            level: nextLevel,
            nicknamePrefix: "",
            removeRoleIds: [],
            roleId: "",
            stacking: "stack",
          },
        ],
      };
    });
  }

  function removeXpRole(level: number): void {
    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        levelRoles: current.levelRoles.filter((rule) => rule.level !== level),
      };
    });
  }

  function updateXpMultiplier(
    roleId: string,
    patch: Partial<XpRoleMultiplier>,
  ): void {
    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        roleMultipliers: current.roleMultipliers.map((entry) =>
          entry.roleId === roleId ? { ...entry, ...patch } : entry,
        ),
      };
    });
  }

  function addXpMultiplier(): void {
    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      const usedRoleIds = new Set(
        current.roleMultipliers.map((entry) => entry.roleId),
      );
      const availableRole = guildRoles.find(
        (role) => !usedRoleIds.has(role.id),
      );

      return {
        ...current,
        roleMultipliers: [
          ...current.roleMultipliers,
          {
            multiplier: 2,
            roleId: availableRole?.id ?? "",
          },
        ],
      };
    });
  }

  function removeXpMultiplier(roleId: string): void {
    setXpConfig((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        roleMultipliers: current.roleMultipliers.filter(
          (entry) => entry.roleId !== roleId,
        ),
      };
    });
  }

  async function handleLogout(): Promise<void> {
    setLoadingSession(true);
    try {
      await logout();
      setUsername(null);
      setGuilds([]);
      setSelectedGuildId(null);
      setConfig({});
      setWidgetStatus(null);
      pushToast("Sesión cerrada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo cerrar la sesión.", "error");
    } finally {
      setLoadingSession(false);
    }
  }

  // La navegación = Inicio (siempre) + módulos activos + Admin (con permisos).
  const visibleTabs: HubTab[] = [
    "home",
    ...(configLoaded
      ? HUB_MODULES.filter((mod) => isModuleEnabled(config, mod.key)).map(
          (mod) => mod.key,
        )
      : []),
    ...(adminEnabled ? (["admin"] as HubTab[]) : []),
  ];

  useEffect(() => {
    if (activeTab === "admin" && !adminEnabled) {
      setActiveTab("dashboard");
      return;
    }
    // Solo los módulos activables pueden redirigir. Los tabs personales
    // (perfil) o de estructura (home) nunca se ocultan por la config.
    if (
      configLoaded &&
      HUB_MODULES.some((mod) => mod.key === activeTab) &&
      !isModuleEnabled(config, activeTab)
    ) {
      setActiveTab("dashboard");
    }
  }, [activeTab, adminEnabled, config.enabledModules, configLoaded]);

  useEffect(() => {
    const onHashChange = (): void => {
      const { tab, karutaSection, comunicadoSlug } = parseLocationHash();
      setActiveTab(tab);
      setKarutaSection(karutaSection);
      setComunicadoSlug(comunicadoSlug);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    const target =
      activeTab === "karuta"
        ? `#/karuta/${KARUTA_SECTION_SLUGS[karutaSection]}`
        : activeTab === "comunicados" && comunicadoSlug
          ? `#/comunicados/${comunicadoSlug}`
          : `#/${activeTab}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, [activeTab, karutaSection, comunicadoSlug]);

  // Al salir de Comunicados se limpia el slug: volver a la tab siempre
  // muestra la lista (no un comunicado puntual anterior).
  useEffect(() => {
    if (activeTab !== "comunicados" && comunicadoSlug) {
      setComunicadoSlug(null);
    }
  }, [activeTab, comunicadoSlug]);

  useEffect(() => {
    if (activeTab !== "admin" || !selectedGuildId) {
      setVoiceChannels([]);
      setTextChannels([]);
      setGuildRoles([]);
      setDailyMessages([]);
      setHiddenRaidLogs([]);
      setAuditLogs([]);
      return;
    }

    let cancelled = false;
    Promise.all([
      getGuildVoiceChannels(selectedGuildId),
      getGuildTextChannels(selectedGuildId),
      getGuildRoles(selectedGuildId),
      listDailyMessages(selectedGuildId),
    ])
      .then(([channels, textCh, roles, daily]) => {
        if (cancelled) {
          return;
        }

        setVoiceChannels(channels);
        setTextChannels(textCh);
        setGuildRoles(roles);
        setDailyMessages(daily);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void error;
          setVoiceChannels([]);
          setTextChannels([]);
          setGuildRoles([]);
          setDailyMessages([]);
          pushToast(
            "No se pudieron cargar los datos del panel Admin.",
            "error",
          );
        }
      });

    if (canAccess("raids")) {
      void refreshHiddenRaidLogs();
    } else {
      setHiddenRaidLogs([]);
    }

    const isOwner = guilds.some(
      (guild) => guild.id === selectedGuildId && guild.owner,
    );
    if (isOwner) {
      void getAuditLogs(selectedGuildId)
        .then((logs) => {
          if (!cancelled) {
            setAuditLogs(logs);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAuditLogs([]);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  useEffect(() => {
    if (activeTab !== "home" || !selectedGuildId) {
      setBoosters([]);
      return;
    }

    let cancelled = false;
    getGuildBoosters(selectedGuildId)
      .then((boostersList) => {
        if (!cancelled) {
          setBoosters(boostersList);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBoosters([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  // Carrusel de la landing: nombres reales del leaderboard público.
  useEffect(() => {
    if (username) {
      return;
    }
    let cancelled = false;
    getPublicLeaderboard()
      .then((list) => {
        if (!cancelled) {
          setLandingPreview(list);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!sessionReady) {
    return (
      <div className="shell app-loading">
        <main className="app-loading-main">
          <LoadingState label="Cargando…" />
        </main>
      </div>
    );
  }

  if (!username) {
    const previewPills =
      landingPreview.length > 0
        ? landingPreview.map((entry) => ({
            isBooster: entry.isBooster,
            name: entry.nickname ?? entry.username ?? "—",
          }))
        : LANDING_PREVIEW_USERS.map((name) => ({
            isBooster: false,
            name,
          }));

    return (
      <div className="shell landing-shell">
        <main className="landing-main">
          <section className="panel landing-hero landing-hero-center">
            <h1 className="brand-gradient">BONAFIDE</h1>

            <p className="landing-tagline">Bienvenido a Bonafide</p>

            <a className="primary-button landing-login" href={loginUrl()}>
              <svg
                className="landing-discord-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Entrar con Discord
            </a>

            <div
              className="landing-media"
              role="img"
              aria-label="Miembros de Bonafide"
            >
              <div className="cover-art" />
              <div className="carousel-mask">
                <div className="carousel-track">
                  {previewPills.map((pill, index) => (
                    <span
                      className={`user-pill${pill.isBooster ? " booster-pill" : ""}`}
                      key={`a-${index}`}
                    >
                      {pill.isBooster ? (
                        <span className="booster-gem" aria-hidden="true">
                          ◈
                        </span>
                      ) : null}
                      {pill.name}
                    </span>
                  ))}
                  {previewPills.map((pill, index) => (
                    <span
                      className={`user-pill${pill.isBooster ? " booster-pill" : ""}`}
                      key={`b-${index}`}
                    >
                      {pill.isBooster ? (
                        <span className="booster-gem" aria-hidden="true">
                          ◈
                        </span>
                      ) : null}
                      {pill.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const panelDesc = panelDescription(activeTab);
  const roleModalTarget =
    roleModal != null
      ? (xpConfig?.levelRoles.find((rule) => rule.level === roleModal.level) ??
        null)
      : null;

  return (
    <div className="app-shell">
      <ToastViewport toasts={toasts} />
      {username ? (
        <KarpindomoWidget
          msg={karpindomoMsg}
          open={karpindomoOpen}
          onToggle={() => setKarpindomoOpen((value) => !value)}
          onClose={() => setKarpindomoOpen(false)}
        />
      ) : null}
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="brand"
            onClick={() => setActiveTab("home")}
            title="Ir al inicio"
            type="button"
          >
            {selectedGuildIcon ? (
              <img
                className="brand-icon"
                src={selectedGuildIcon}
                alt={selectedGuild?.name ?? "Bonafide"}
              />
            ) : null}
            <strong>Bonafide</strong>
          </button>

          <nav className="top-nav">
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                className={`nav-link ${activeTab === tab ? "active" : ""}${tab === "admin" ? " nav-link--admin" : ""}`}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tabLabel(tab)}
              </button>
            ))}
          </nav>

          <div className="topbar-user">
            {guilds.length > 1 ? (
              <select
                className="select guild-select"
                value={selectedGuildId ?? ""}
                onChange={(event) => setSelectedGuildId(event.target.value)}
              >
                <option value="" disabled>
                  Selecciona guild
                </option>
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {formatGuildLabel(guild)}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              className={`user-chip user-chip-link${myTier ? ` user-chip--${myTier}` : ""}`}
              onClick={() => setActiveTab("perfil")}
              type="button"
              title="Ver mi perfil"
            >
              {me?.avatar ? (
                <img
                  className="user-chip-avatar"
                  src={userAvatarUrl(me)}
                  alt=""
                />
              ) : null}
              {username}
            </button>
            <button
              className="theme-toggle"
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
              type="button"
              title={
                theme === "dark"
                  ? "Cambiar a tema claro"
                  : "Cambiar a tema oscuro"
              }
              aria-label="Cambiar tema"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              className="logout-button"
              onClick={handleLogout}
              disabled={loading}
              type="button"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        {activeTab === "home" ? (
          <HomeView
            boostCount={widgetStatus?.boostCount ?? null}
            boosters={boosters}
            colorFor={levelStyleFor}
            leaderboard={leaderboard}
            loading={loadingGuildData}
            username={username}
          />
        ) : (
          <>
            <section className="page-hero">
              <h1 className="brand-gradient">Bienvenido a Bonafide</h1>
              <p>
                Bienvenido <strong className="user-name">{username}</strong>
              </p>
            </section>

            <section className="panel content-panel">
              <div className="section-header">
                <div>
                  <h2>{panelTitle(activeTab)}</h2>
                  {panelDesc ? <p>{panelDesc}</p> : null}
                </div>
              </div>

              {activeTab === "dashboard" ? (
                <div className="dashboard-stack">
                  <div className="dashboard-toolbar">
                    <button
                      className="icon-button"
                      onClick={refreshSession}
                      disabled={loading}
                      title="Refrescar datos"
                      aria-label="Refrescar datos"
                    >
                      <svg
                        className="icon-button-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                        <polyline points="21 3 21 9 15 9" />
                      </svg>
                    </button>
                  </div>
                  <ServerStats
                    status={widgetStatus}
                    loading={loadingGuildData}
                  />

                  <div className="leaderboard-panel">
                    <h3>Leaderboard de XP</h3>
                    {loadingGuildData ? (
                      <div className="empty-state">Cargando ranking...</div>
                    ) : leaderboard.length === 0 ? (
                      <div className="empty-state">
                        Todavía no hay XP registrado en este servidor.
                      </div>
                    ) : (
                      <table className="leaderboard-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Usuario</th>
                            <th>Nivel</th>
                            <th>XP</th>
                            <th>Mensajes</th>
                            <th>Min. voz</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaderboard.map((entry) => (
                            <tr
                              key={entry.userId}
                              className={
                                entry.rank <= 5 ? "mvp-row" : undefined
                              }
                            >
                              <td>
                                <span
                                  className={
                                    entry.rank <= 5 ? "mvp-rank" : undefined
                                  }
                                >
                                  {entry.rank}
                                </span>
                              </td>
                              <td>
                                <span className="leaderboard-user">
                                  {entry.avatarUrl ? (
                                    <img
                                      className="leaderboard-avatar"
                                      src={entry.avatarUrl}
                                      alt=""
                                    />
                                  ) : (
                                    <span className="leaderboard-avatar leaderboard-avatar-placeholder">
                                      ?
                                    </span>
                                  )}
                                  <span
                                    className="user-mention"
                                    style={levelStyleFor(
                                      entry.level,
                                      entry.isBooster,
                                    )}
                                  >
                                    {entry.nickname ||
                                      entry.username ||
                                      `@${entry.userId}`}
                                  </span>
                                  {entry.isBooster ? (
                                    <span
                                      className="booster-badge"
                                      title="Server Booster"
                                      aria-label="Server Booster"
                                    >
                                      ◈
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td>
                                <span
                                  className="leaderboard-level"
                                  style={levelStyleFor(
                                    entry.level,
                                    entry.isBooster,
                                  )}
                                >
                                  {entry.level}
                                </span>
                              </td>
                              <td>{entry.xp}</td>
                              <td>{entry.messageCount}</td>
                              <td>{entry.voiceMinutes}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="dashboard-actions">
                    {widgetStatus?.inviteUrl ? (
                      <a
                        className="primary-button"
                        href={widgetStatus.inviteUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Invitación del servidor
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {activeTab === "admin" && selectedGuild && adminEnabled ? (
                <div className="admin-card-stack">
                  {canAccess("config") ? (
                    <details className="admin-card admin-card-acc admin-card--admin">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Configuraciones principales{" "}
                            <span className="admin-tier-badge tier-admin">
                              Admin
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="form-grid">
                          <label>
                            <span>Canal de Karpindomo</span>
                            <select
                              className="select"
                              value={config.memberLogChannelId ?? ""}
                              onChange={(event) =>
                                editConfig((current) => ({
                                  ...current,
                                  memberLogChannelId:
                                    event.target.value || undefined,
                                }))
                              }
                            >
                              <option value="">Sin canal configurado</option>
                              {textChannels.map((channel) => (
                                <option key={channel.id} value={channel.id}>
                                  {channel.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Rol de entrada</span>
                            <select
                              className="select"
                              value={config.defaultRoleId ?? ""}
                              onChange={(event) =>
                                editConfig((current) => ({
                                  ...current,
                                  defaultRoleId:
                                    event.target.value || undefined,
                                }))
                              }
                            >
                              <option value="">Sin rol de entrada</option>
                              {guildRoles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Rol DJ</span>
                            <select
                              className="select select-inline"
                              value={(config.musicRoleIds ?? [])[0] ?? ""}
                              onChange={(event) =>
                                editConfig((current) => ({
                                  ...current,
                                  musicRoleIds: event.target.value
                                    ? [event.target.value]
                                    : [],
                                }))
                              }
                            >
                              <option value="">Sin restricción</option>
                              {guildRoles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <RoleMultiSelect
                            label="Roles sin acceso a salas dinámicas"
                            roles={guildRoles}
                            value={config.bannedVoiceRoleIds ?? []}
                            onChange={(next) =>
                              editConfig((current) => ({
                                ...current,
                                bannedVoiceRoleIds: next,
                              }))
                            }
                            emptyText="Ningún rol desperuanizado"
                            hint="No podrán ver salas dinámicas."
                          />

                          <label>
                            <span>Canal creador de salas</span>
                            <select
                              className="select select-inline"
                              value={config.dynamicVoiceCreateChannelId ?? ""}
                              onChange={(event) =>
                                editConfig((current) => ({
                                  ...current,
                                  dynamicVoiceCreateChannelId:
                                    event.target.value || undefined,
                                }))
                              }
                            >
                              <option value="">Sin canal configurado</option>
                              {voiceChannels.map((channel) => (
                                <option key={channel.id} value={channel.id}>
                                  {channel.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Rangos que reciben sugerencias</span>
                            <div className="suggestion-tier-chips">
                              {(["owner", "admin", "officer"] as const).map(
                                (tier) => {
                                  const checked = (
                                    config.suggestionsDmTiers ?? []
                                  ).includes(tier);
                                  const label =
                                    tier === "owner"
                                      ? "Owner"
                                      : tier === "admin"
                                        ? "Admin"
                                        : "Officer";
                                  return (
                                    <label
                                      className={`suggestion-tier-chip${checked ? " checked" : ""}`}
                                      key={tier}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          editConfig((current) => {
                                            const tiers = new Set(
                                              current.suggestionsDmTiers ?? [],
                                            );
                                            if (checked) {
                                              tiers.delete(tier);
                                            } else {
                                              tiers.add(tier);
                                            }
                                            return {
                                              ...current,
                                              suggestionsDmTiers: [...tiers],
                                            };
                                          })
                                        }
                                      />
                                      <span>{label}</span>
                                    </label>
                                  );
                                },
                              )}
                            </div>
                          </label>
                        </div>
                      </div>
                      {configDirty ? (
                        <div className="admin-card-footer">
                          <button
                            className="primary-button"
                            onClick={() => void handleSave()}
                            disabled={savingAction !== null}
                          >
                            {savingAction === "config"
                              ? "Guardando…"
                              : "Guardar"}
                          </button>
                        </div>
                      ) : null}
                    </details>
                  ) : null}

                  {canAccess("karuta") ? (
                    <details className="admin-card admin-card-acc admin-card--officer">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Karuta{" "}
                            <span className="admin-tier-badge tier-officer">
                              Officer
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="karuta-watcher-editor">
                          <div className="karuta-watcher-head">
                            <div>
                              <strong>Watcher de Karuta</strong>
                              <span>
                                Detecta drops y cartas automáticamente
                              </span>
                            </div>
                            <label className="raid-watcher-toggle">
                              <input
                                type="checkbox"
                                checked={config.karutaWatchEnabled ?? false}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      karutaWatchEnabled: event.target.checked,
                                    }),
                                    "karuta",
                                  )
                                }
                              />
                              <span
                                className="raid-watcher-switch"
                                aria-hidden="true"
                              />
                              <span className="sr-only">Activar watcher</span>
                            </label>
                          </div>
                          <div className="form-grid">
                            <label>
                              <span>Canal de Karuta</span>
                              <select
                                className="select"
                                value={config.karutaChannelId ?? ""}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      karutaChannelId:
                                        event.target.value || undefined,
                                    }),
                                    "karuta",
                                  )
                                }
                              >
                                <option value="">Sin canal configurado</option>
                                {textChannels.map((channel) => (
                                  <option key={channel.id} value={channel.id}>
                                    {channel.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>Print máximo para "rara"</span>
                              <input
                                type="number"
                                min={1}
                                max={10000}
                                value={config.karutaRarePrintMax ?? 10}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      karutaRarePrintMax:
                                        raw === "" ? undefined : Number(raw),
                                    }),
                                    "karuta",
                                  );
                                }}
                              />
                            </label>
                            <label>
                              <span>Wishlists mínimas</span>
                              <input
                                type="number"
                                min={1}
                                max={100000}
                                value={config.karutaRareWishlistMin ?? 3}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      karutaRareWishlistMin:
                                        raw === "" ? undefined : Number(raw),
                                    }),
                                    "karuta",
                                  );
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      {isDirty("karuta") ? (
                        <div className="admin-card-footer">
                          <button
                            className="primary-button"
                            onClick={() => void handleSaveKarutaConfig()}
                            disabled={savingAction !== null}
                          >
                            {savingAction === "karuta"
                              ? "Guardando…"
                              : "Guardar configuración"}
                          </button>
                        </div>
                      ) : null}
                    </details>
                  ) : null}

                  {isAdminOwner ? (
                    <details className="admin-card admin-card-acc admin-card--owner">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Módulos{" "}
                            <span className="admin-tier-badge tier-owner">
                              Owner
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="modules-grid">
                          {HUB_MODULES.map((mod) => {
                            const checked = isModuleEnabled(config, mod.key);
                            return (
                              <label
                                className={`module-toggle${checked ? " checked" : ""}`}
                                key={mod.key}
                              >
                                <span className="module-toggle-text">
                                  <strong>{mod.label}</strong>
                                </span>
                                <span className="module-switch">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleModule(mod.key)}
                                  />
                                  <span
                                    className="module-switch-track"
                                    aria-hidden="true"
                                  >
                                    <span className="module-switch-thumb" />
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      {isDirty("modules") ? (
                        <div className="admin-card-footer">
                          <button
                            className="primary-button"
                            onClick={() => void handleSaveModules()}
                            disabled={savingAction !== null}
                          >
                            {savingAction === "modules"
                              ? "Guardando…"
                              : "Guardar módulos"}
                          </button>
                        </div>
                      ) : null}
                    </details>
                  ) : null}

                  {isAdminOwner ? (
                    <details className="admin-card admin-card-acc admin-card--owner">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Permisos{" "}
                            <span className="admin-tier-badge tier-owner">
                              Owner
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="staff-hierarchy">
                          <div className="staff-hierarchy-tier owner">
                            <span
                              className="staff-hierarchy-icon"
                              aria-hidden="true"
                            >
                              👑
                            </span>
                            <div className="staff-hierarchy-info">
                              <strong>Owner / Super Admin</strong>
                              <small>
                                Todas las secciones, incluida auditoría y
                                permisos.
                              </small>
                            </div>
                          </div>
                          <div className="staff-hierarchy-tier admin">
                            <span
                              className="staff-hierarchy-icon"
                              aria-hidden="true"
                            >
                              🟠
                            </span>
                            <div className="staff-hierarchy-info">
                              <strong>Admin</strong>
                              <small>{STAFF_TIERS.admin.description}</small>
                              <span className="staff-hierarchy-roles">
                                {staffByTier.admin.length > 0
                                  ? `Roles: ${staffByTier.admin.join(", ")}`
                                  : "Sin roles asignados"}
                              </span>
                            </div>
                          </div>
                          <div className="staff-hierarchy-tier officer">
                            <span
                              className="staff-hierarchy-icon"
                              aria-hidden="true"
                            >
                              🟢
                            </span>
                            <div className="staff-hierarchy-info">
                              <strong>Officer</strong>
                              <small>{STAFF_TIERS.officer.description}</small>
                              <span className="staff-hierarchy-roles">
                                {staffByTier.officer.length > 0
                                  ? `Roles: ${staffByTier.officer.join(", ")}`
                                  : "Sin roles asignados"}
                              </span>
                            </div>
                          </div>
                          <div className="staff-hierarchy-tier none">
                            <span
                              className="staff-hierarchy-icon"
                              aria-hidden="true"
                            >
                              ⚪
                            </span>
                            <div className="staff-hierarchy-info">
                              <strong>Sin acceso</strong>
                              <small>El hub normal, sin panel Admin.</small>
                            </div>
                          </div>
                        </div>
                        <label className="staff-role-picker">
                          <span>Rol de staff</span>
                          <select
                            className="select"
                            value={staffRoleId}
                            onChange={(event) =>
                              setStaffRoleId(event.target.value)
                            }
                          >
                            <option value="">Seleccionar un rol</option>
                            {guildRoles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        {staffRoleId
                          ? (() => {
                              const role = guildRoles.find(
                                (item) => item.id === staffRoleId,
                              );
                              const rule = (config.adminRoleModules ?? []).find(
                                (entry) => entry.roleId === staffRoleId,
                              );
                              const tier = tierForModules(rule?.modules ?? []);
                              const custom =
                                !tier && (rule?.modules.length ?? 0) > 0;
                              return (
                                <div className="staff-role-editor">
                                  <div className="staff-role-editor-head">
                                    <strong>{role?.name ?? "Rol"}</strong>
                                    <select
                                      className="select staff-tier-select"
                                      value={tier ?? ""}
                                      onChange={(event) => {
                                        const nextTier = event.target.value as
                                          | StaffTier
                                          | "";
                                        editConfig((current) => {
                                          const rules = [
                                            ...(current.adminRoleModules ?? []),
                                          ];
                                          const index = rules.findIndex(
                                            (entry) =>
                                              entry.roleId === staffRoleId,
                                          );
                                          if (index >= 0) {
                                            rules.splice(index, 1);
                                          }
                                          if (nextTier) {
                                            rules.push({
                                              modules: [
                                                ...STAFF_TIERS[nextTier]
                                                  .modules,
                                              ],
                                              roleId: staffRoleId,
                                            });
                                          }
                                          return {
                                            ...current,
                                            adminRoleModules: rules,
                                          };
                                        }, "permissions");
                                      }}
                                    >
                                      <option value="">Sin acceso</option>
                                      <option value="admin">Admin</option>
                                      <option value="officer">Officer</option>
                                    </select>
                                  </div>
                                  <p className="staff-role-editor-note">
                                    {tier
                                      ? `Acceso ${STAFF_TIERS[tier].label}: ${STAFF_TIERS[tier].description}`
                                      : custom
                                        ? "Rango personalizado de una configuración anterior."
                                        : "Este rol no tiene acceso al panel Admin."}
                                  </p>
                                </div>
                              );
                            })()
                          : null}
                      </div>
                      {isDirty("permissions") ? (
                        <div className="admin-card-footer">
                          <button
                            className="primary-button"
                            onClick={() => void handleSaveStaffPermissions()}
                            disabled={savingAction !== null}
                          >
                            {savingAction === "permissions"
                              ? "Guardando…"
                              : "Guardar permisos"}
                          </button>
                        </div>
                      ) : null}
                    </details>
                  ) : null}

                  {canAccess("comunicados") ? (
                    <details className="admin-card admin-card-acc admin-card--officer">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Comunicados{" "}
                            <span className="admin-tier-badge tier-officer">
                              Officer
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="plantillas-actions">
                          <button
                            className="primary-button"
                            onClick={() =>
                              setCommEditor({
                                id: null,
                                title: "",
                                content: "",
                                channelId: "",
                              })
                            }
                            type="button"
                          >
                            Nueva plantilla
                          </button>
                        </div>
                        {communications.length === 0 ? (
                          <div className="empty-state comunicados-empty">
                            <p>No existen plantillas.</p>
                          </div>
                        ) : (
                          communications.map((comm) => (
                            <div
                              className="comunicado-admin-block"
                              key={comm.id}
                            >
                              <div className="comunicado-admin-row">
                                <div className="comunicado-admin-info">
                                  <strong>{comm.title}</strong>
                                  <span
                                    className={`comunicado-status comunicado-status-${comm.instances.length > 0 ? "published" : "draft"}`}
                                  >
                                    {comm.instances.length > 0
                                      ? `Publicado (${comm.instances.length})`
                                      : "Borrador"}
                                  </span>
                                </div>
                                <div className="comunicado-admin-actions">
                                  <button
                                    className="ghost-button"
                                    onClick={() =>
                                      setCommEditor({
                                        id: comm.id,
                                        title: comm.title,
                                        content: comm.content,
                                        channelId: comm.channelId ?? "",
                                      })
                                    }
                                    type="button"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    className="primary-button"
                                    onClick={() =>
                                      void handlePublishCommunication(comm.id)
                                    }
                                    type="button"
                                  >
                                    {comm.instances.length > 0
                                      ? "Republicar"
                                      : "Publicar"}
                                  </button>
                                  <button
                                    className="danger-button"
                                    onClick={() =>
                                      requestDeleteCommunication(comm)
                                    }
                                    type="button"
                                  >
                                    Eliminar plantilla
                                  </button>
                                </div>
                              </div>
                              {comm.instances.length > 0 ? (
                                <div className="comunicado-instances">
                                  {comm.instances.map((instance) => (
                                    <div
                                      className="comunicado-instance-row"
                                      key={instance.id}
                                    >
                                      <span>
                                        {instance.discordMessageIds.length > 0
                                          ? "Mensaje"
                                          : "Web"}{" "}
                                        ·{" "}
                                        {new Date(
                                          instance.publishedAt,
                                        ).toLocaleDateString()}{" "}
                                        {new Date(
                                          instance.publishedAt,
                                        ).toLocaleTimeString([], {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}
                                      </span>
                                      <div className="comunicado-instance-actions">
                                        <button
                                          className="ghost-button"
                                          onClick={() =>
                                            setInstanceEditor({
                                              communicationId:
                                                instance.communicationId,
                                              content: instance.content,
                                              id: instance.id,
                                              title: instance.title,
                                            })
                                          }
                                          type="button"
                                        >
                                          Editar
                                        </button>
                                        <button
                                          className="ghost-button danger"
                                          onClick={() =>
                                            requestDeleteInstance(instance)
                                          }
                                          type="button"
                                        >
                                          Eliminar mensaje
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </details>
                  ) : null}

                  {canAccess("daily") ? (
                    <details className="admin-card admin-card-acc admin-card--officer">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Mensajes Karpindomo{" "}
                            <span className="admin-tier-badge tier-officer">
                              Officer
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="daily-watcher-editor">
                          <div className="daily-watcher-head">
                            <div>
                              <strong>Loro activado</strong>
                              <span>
                                Publica una frase al azar en intervalos
                                aleatorios
                              </span>
                            </div>
                            <label className="raid-watcher-toggle">
                              <input
                                type="checkbox"
                                checked={config.dailyMessagesEnabled ?? false}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      dailyMessagesEnabled:
                                        event.target.checked,
                                    }),
                                    "daily",
                                  )
                                }
                              />
                              <span
                                className="raid-watcher-switch"
                                aria-hidden="true"
                              />
                              <span className="sr-only">Activar loro</span>
                            </label>
                          </div>

                          <div className="form-grid">
                            <label>
                              <span>Canal de publicación</span>
                              <select
                                className="select"
                                value={config.dailyMessagesChannelId ?? ""}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      dailyMessagesChannelId:
                                        event.target.value || undefined,
                                    }),
                                    "daily",
                                  )
                                }
                              >
                                <option value="">Sin canal configurado</option>
                                {textChannels.map((channel) => (
                                  <option key={channel.id} value={channel.id}>
                                    {channel.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>Intervalo mínimo (min)</span>
                              <input
                                type="number"
                                min="1"
                                value={config.dailyMessagesMinMinutes ?? 15}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      dailyMessagesMinMinutes:
                                        Number(event.target.value) || 1,
                                    }),
                                    "daily",
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Intervalo máximo (min)</span>
                              <input
                                type="number"
                                min="1"
                                value={config.dailyMessagesMaxMinutes ?? 90}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      dailyMessagesMaxMinutes:
                                        Number(event.target.value) || 1,
                                    }),
                                    "daily",
                                  )
                                }
                              />
                            </label>
                          </div>

                          {isDirty("daily") ? (
                            <button
                              className="primary-button"
                              onClick={() => void handleSaveDailyConfig()}
                              disabled={savingAction !== null}
                              type="button"
                            >
                              {savingAction === "daily"
                                ? "Guardando…"
                                : "Guardar configuración"}
                            </button>
                          ) : null}
                        </div>

                        <div className="daily-messages-editor">
                          <div className="daily-messages-head">
                            <strong>Frases del loro</strong>
                            <span className="muted-text">
                              {
                                dailyMessages.filter(
                                  (message) => message.enabled,
                                ).length
                              }{" "}
                              de {dailyMessages.length} activas
                            </span>
                          </div>
                          <textarea
                            className="textarea"
                            rows={3}
                            value={dailyMessageDraft}
                            onChange={(event) =>
                              setDailyMessageDraft(event.target.value)
                            }
                          />
                          <button
                            className="primary-button"
                            onClick={() => void handleCreateDailyMessage()}
                            type="button"
                          >
                            + Agregar frase
                          </button>

                          {dailyMessages.length === 0 ? (
                            <div className="empty-state">
                              <p>
                                No hay frases todavía. ¡Agregá la primera para
                                que el loro empiece a hablar!
                              </p>
                            </div>
                          ) : (
                            dailyMessages.map((message) => (
                              <div
                                className="daily-message-row"
                                key={message.id}
                              >
                                <span
                                  className={`daily-message-content${message.enabled ? "" : " muted"}`}
                                >
                                  {message.content}
                                </span>
                                <div className="daily-message-actions">
                                  <button
                                    className="ghost-button"
                                    onClick={() =>
                                      void handleToggleDailyMessage(message)
                                    }
                                    type="button"
                                  >
                                    {message.enabled ? "Pausar" : "Activar"}
                                  </button>
                                  <button
                                    className="ghost-button danger"
                                    onClick={() =>
                                      void handleDeleteDailyMessage(message)
                                    }
                                    type="button"
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {canAccess("raids") ? (
                    <details className="admin-card admin-card-acc admin-card--officer">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Logs de Raid{" "}
                            <span className="admin-tier-badge tier-officer">
                              Officer
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <label>
                          <span>Canal de publicación</span>
                          <select
                            className="select"
                            value={config.logsChannelId ?? ""}
                            onChange={(event) =>
                              editConfig(
                                (current) => ({
                                  ...current,
                                  logsChannelId:
                                    event.target.value || undefined,
                                }),
                                "logsChannel",
                              )
                            }
                          >
                            <option value="">Sin canal configurado</option>
                            {textChannels.map((channel) => (
                              <option key={channel.id} value={channel.id}>
                                {channel.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {isDirty("logsChannel") ? (
                          <button
                            className="primary-button"
                            onClick={() => void handleSaveLogsConfig()}
                            disabled={savingAction !== null}
                            type="button"
                          >
                            {savingAction === "config"
                              ? "Guardando…"
                              : "Guardar canal"}
                          </button>
                        ) : null}

                        <div className="raid-watcher-editor">
                          <div className="raid-watcher-head">
                            <div>
                              <strong>Watcher</strong>
                              <span>Publica nuevas raids automáticamente</span>
                            </div>
                            <label className="raid-watcher-toggle">
                              <input
                                type="checkbox"
                                checked={config.logsWatchEnabled ?? false}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      logsWatchEnabled: event.target.checked,
                                    }),
                                    "logsWatch",
                                  )
                                }
                              />
                              <span
                                className="raid-watcher-switch"
                                aria-hidden="true"
                              />
                              <span className="sr-only">Activar watcher</span>
                            </label>
                          </div>
                          <div className="form-grid">
                            <label>
                              <span>Guild</span>
                              <input
                                value={config.logsWatchGuild ?? ""}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      logsWatchGuild:
                                        event.target.value || undefined,
                                    }),
                                    "logsWatch",
                                  )
                                }
                                placeholder="Nombre en Warcraft Logs"
                              />
                            </label>
                            <label>
                              <span>Realm</span>
                              <input
                                value={config.logsWatchServer ?? ""}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      logsWatchServer:
                                        event.target.value || undefined,
                                    }),
                                    "logsWatch",
                                  )
                                }
                                placeholder="Nombre del realm"
                              />
                            </label>
                            <label>
                              <span>Región</span>
                              <select
                                className="select"
                                value={config.logsWatchRegion ?? "EU"}
                                onChange={(event) =>
                                  editConfig(
                                    (current) => ({
                                      ...current,
                                      logsWatchRegion: event.target.value,
                                    }),
                                    "logsWatch",
                                  )
                                }
                              >
                                <option value="EU">EU</option>
                                <option value="US">US</option>
                              </select>
                            </label>
                          </div>
                          {isDirty("logsWatch") ? (
                            <button
                              className="primary-button"
                              onClick={() => void handleSaveLogsWatch()}
                              disabled={savingAction !== null}
                              type="button"
                            >
                              Guardar
                            </button>
                          ) : null}
                        </div>

                        <div className="daily-messages-editor">
                          <div className="daily-messages-head">
                            <strong>Agregar log</strong>
                          </div>
                          <input
                            value={raidLogUrl}
                            onChange={(event) =>
                              setRaidLogUrl(event.target.value)
                            }
                            placeholder="https://www.warcraftlogs.com/reports/XXXX"
                          />
                          <button
                            className="primary-button"
                            onClick={() => void handleCreateRaidLog()}
                            type="button"
                          >
                            + Agregar log de raid
                          </button>
                        </div>

                        {hiddenRaidLogs.length > 0 ? (
                          <div className="hidden-raid-logs">
                            <div className="daily-messages-head">
                              <strong>
                                Eliminados ({hiddenRaidLogs.length})
                              </strong>
                              <span className="muted-text">
                                Se pueden restaurar o borrar para siempre.
                              </span>
                            </div>
                            {hiddenRaidLogs.map((log) => (
                              <div className="daily-message-row" key={log.id}>
                                <div className="daily-message-content">
                                  <strong>{log.title || log.reportCode}</strong>
                                  <div className="muted-text">
                                    ⚔️ {log.fightCount} · 💀 {log.kills}
                                  </div>
                                </div>
                                <div className="daily-message-actions">
                                  <button
                                    className="ghost-button"
                                    onClick={() => requestShowRaidLog(log)}
                                    type="button"
                                  >
                                    Restaurar
                                  </button>
                                  <button
                                    className="ghost-button danger"
                                    onClick={() =>
                                      requestPermanentDeleteRaidLog(log)
                                    }
                                    type="button"
                                  >
                                    Borrar definitivamente
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}

                  {canAccess("xp") ? (
                    <details className="admin-card admin-card-acc admin-card--admin">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Sistema de XP{" "}
                            <span className="admin-tier-badge tier-admin">
                              Admin
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      {xpConfig ? (
                        <>
                          <div className="admin-card-body">
                            <div className="form-grid">
                              <label>
                                <span>XP por mensaje</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={xpConfig.messageXp}
                                  onChange={(event) =>
                                    setXpConfig((current) =>
                                      current
                                        ? {
                                            ...current,
                                            messageXp:
                                              Number(event.target.value) || 0,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              </label>

                              <label>
                                <span>XP por minuto en voz</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={xpConfig.voiceXpPerMinute}
                                  onChange={(event) =>
                                    setXpConfig((current) =>
                                      current
                                        ? {
                                            ...current,
                                            voiceXpPerMinute:
                                              Number(event.target.value) || 0,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              </label>

                              <label>
                                <span>Cooldown anti-spam (segundos)</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={xpConfig.cooldownSeconds}
                                  onChange={(event) =>
                                    setXpConfig((current) =>
                                      current
                                        ? {
                                            ...current,
                                            cooldownSeconds:
                                              Number(event.target.value) || 0,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              </label>

                              <label>
                                <span>XP base por nivel</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={xpConfig.levelBaseXp}
                                  onChange={(event) =>
                                    setXpConfig((current) =>
                                      current
                                        ? {
                                            ...current,
                                            levelBaseXp:
                                              Number(event.target.value) || 0,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              </label>

                              <label>
                                <span>Cap de nivel (0 = sin límite)</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={xpConfig.maxLevel}
                                  onChange={(event) =>
                                    setXpConfig((current) =>
                                      current
                                        ? {
                                            ...current,
                                            maxLevel:
                                              Math.max(
                                                0,
                                                Number(event.target.value),
                                              ) || 0,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              </label>
                            </div>

                            <h4>Roles por nivel</h4>
                            <div className="xp-roles">
                              {xpConfig.levelRoles.length === 0 ? (
                                <div className="empty-state">
                                  Aún no hay roles por nivel configurados.
                                </div>
                              ) : (
                                xpConfig.levelRoles.map((rule, index) => (
                                  <div className="xp-role-row" key={index}>
                                    <label className="xp-role-level-input">
                                      <span>Nivel</span>
                                      <input
                                        type="number"
                                        min="0"
                                        value={rule.level}
                                        onChange={(event) =>
                                          changeXpRoleLevel(
                                            rule.level,
                                            Number(event.target.value),
                                          )
                                        }
                                      />
                                    </label>
                                    <select
                                      className="select"
                                      value={rule.roleId}
                                      onChange={(event) =>
                                        updateXpRole(rule.level, {
                                          roleId: event.target.value,
                                        })
                                      }
                                    >
                                      <option value="">Sin rol</option>
                                      {guildRoles.map((role) => (
                                        <option key={role.id} value={role.id}>
                                          {role.name}
                                        </option>
                                      ))}
                                    </select>
                                    <label className="xp-nickname-prefix">
                                      <span>Prefijo de nombre</span>
                                      <input
                                        type="text"
                                        maxLength={8}
                                        placeholder="🔵"
                                        value={rule.nicknamePrefix ?? ""}
                                        onChange={(event) =>
                                          updateXpRole(rule.level, {
                                            nicknamePrefix: event.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="xp-color-input">
                                      <span>Color (nivel/nombre)</span>
                                      <span className="xp-color-row">
                                        <input
                                          type="color"
                                          value={rule.color ?? "#6aa8ff"}
                                          onChange={(event) =>
                                            updateXpRole(rule.level, {
                                              color: event.target.value,
                                            })
                                          }
                                        />
                                        {rule.color ? (
                                          <button
                                            type="button"
                                            className="ghost-button small"
                                            onClick={() =>
                                              updateXpRole(rule.level, {
                                                color: undefined,
                                              })
                                            }
                                          >
                                            Quitar
                                          </button>
                                        ) : null}
                                      </span>
                                    </label>
                                    <div
                                      className="xp-mode-toggle"
                                      title="Comportamiento al alcanzar este nivel"
                                    >
                                      <button
                                        type="button"
                                        className={
                                          rule.stacking !== "replace"
                                            ? "active"
                                            : ""
                                        }
                                        onClick={() =>
                                          updateXpRole(rule.level, {
                                            stacking: "stack",
                                          })
                                        }
                                      >
                                        Acumular
                                      </button>
                                      <button
                                        type="button"
                                        className={
                                          rule.stacking === "replace"
                                            ? "active"
                                            : ""
                                        }
                                        onClick={() =>
                                          updateXpRole(rule.level, {
                                            stacking: "replace",
                                          })
                                        }
                                      >
                                        Reemplazar
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      className="ghost-button xp-remove-trigger"
                                      onClick={() =>
                                        setRoleModal({
                                          kind: "add",
                                          level: rule.level,
                                        })
                                      }
                                    >
                                      Dar roles extra ({rule.addRoleIds.length})
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost-button xp-remove-trigger"
                                      onClick={() =>
                                        setRoleModal({
                                          kind: "remove",
                                          level: rule.level,
                                        })
                                      }
                                    >
                                      Quitar roles extra (
                                      {rule.removeRoleIds.length})
                                    </button>
                                    <button
                                      className="ghost-button danger"
                                      onClick={() => removeXpRole(rule.level)}
                                      type="button"
                                    >
                                      Borrar
                                    </button>
                                  </div>
                                ))
                              )}

                              <button
                                className="ghost-button"
                                onClick={addXpRole}
                                type="button"
                              >
                                + Agregar rol de nivel
                              </button>
                            </div>

                            <h4>Multiplicadores de XP por rol</h4>
                            <div className="xp-roles">
                              {xpConfig.roleMultipliers.length === 0 ? (
                                <div className="empty-state">
                                  Aún no hay roles con multiplicador de XP.
                                </div>
                              ) : (
                                xpConfig.roleMultipliers.map((entry) => (
                                  <div
                                    className="xp-role-row xp-multiplier-row"
                                    key={entry.roleId}
                                  >
                                    <select
                                      className="select"
                                      value={entry.roleId}
                                      onChange={(event) =>
                                        updateXpMultiplier(entry.roleId, {
                                          roleId: event.target.value,
                                        })
                                      }
                                    >
                                      <option value="">Sin rol</option>
                                      {guildRoles.map((role) => (
                                        <option key={role.id} value={role.id}>
                                          {role.name}
                                        </option>
                                      ))}
                                    </select>
                                    <label className="xp-multiplier">
                                      <span>Multiplicador (x)</span>
                                      <input
                                        type="number"
                                        min="1"
                                        step="0.5"
                                        value={entry.multiplier}
                                        onChange={(event) =>
                                          updateXpMultiplier(entry.roleId, {
                                            multiplier:
                                              Number(event.target.value) || 1,
                                          })
                                        }
                                      />
                                    </label>
                                    <button
                                      className="ghost-button danger"
                                      onClick={() =>
                                        removeXpMultiplier(entry.roleId)
                                      }
                                      type="button"
                                    >
                                      Borrar
                                    </button>
                                  </div>
                                ))
                              )}

                              <button
                                className="ghost-button"
                                onClick={addXpMultiplier}
                                type="button"
                              >
                                + Agregar multiplicador
                              </button>
                            </div>

                            <div className="import-export">
                              <button
                                className="ghost-button"
                                onClick={() => void handleExportXp()}
                                type="button"
                              >
                                Exportar XP
                              </button>
                              <button
                                className="ghost-button"
                                onClick={() => importFileRef.current?.click()}
                                type="button"
                              >
                                Importar XP
                              </button>
                              <input
                                ref={importFileRef}
                                type="file"
                                accept="application/json,.json"
                                hidden
                                onChange={(event) =>
                                  void handleImportXpFile(event)
                                }
                              />
                              <button
                                className="ghost-button"
                                onClick={requestSyncRoles}
                                type="button"
                              >
                                Re-sincronizar roles
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={requestResetAllXp}
                                type="button"
                              >
                                Resetear niveles de todos
                              </button>
                            </div>
                          </div>
                          {xpDirty ? (
                            <div className="admin-card-footer">
                              <button
                                className="primary-button"
                                onClick={() => void handleSaveXp()}
                                disabled={savingAction !== null}
                              >
                                {savingAction === "xp"
                                  ? "Guardando…"
                                  : "Guardar configuración de XP"}
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="admin-card-body">
                          <p className="admin-card-loading">
                            Cargando configuración de XP…
                          </p>
                        </div>
                      )}
                    </details>
                  ) : null}

                  {isAdminOwner ? (
                    <details className="admin-card admin-card-acc admin-card--owner">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Registros{" "}
                            <span className="admin-tier-badge tier-owner">
                              Owner
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <div className="audit-body-actions">
                          <span className="audit-count">
                            {auditLogs.length} registro
                            {auditLogs.length === 1 ? "" : "s"}
                          </span>
                          <button
                            className="icon-button"
                            onClick={() => void refreshAuditLogs()}
                            title="Refrescar registro"
                            aria-label="Refrescar registro"
                            type="button"
                          >
                            <RefreshIcon />
                          </button>
                        </div>
                        {selectedGuild?.owner ? (
                          auditLogs.length === 0 ? (
                            <div className="empty-state">
                              Aún no hay cambios registrados. Las acciones del
                              panel Admin quedan anotadas acá.
                            </div>
                          ) : (
                            <div className="audit-list">
                              {auditLogs.map((entry) => (
                                <div className="audit-row" key={entry.id}>
                                  <span className="audit-time">
                                    {new Date(entry.createdAt).toLocaleString()}
                                  </span>
                                  <span className="audit-actor">
                                    {entry.actorName ??
                                      entry.actorUserId ??
                                      "—"}
                                  </span>
                                  <span className="audit-action">
                                    {entry.action}
                                  </span>
                                  {entry.details ? (
                                    <span className="audit-detail">
                                      {entry.details}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <div className="empty-state">
                            Solo el owner puede ver este registro.
                          </div>
                        )}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : activeTab === "admin" ? (
                <div className="empty-state">
                  {selectedGuild
                    ? "No tienes permisos para ver el panel Admin en esta guild."
                    : "No hay guild seleccionada o no tenes permisos para ver una."}
                </div>
              ) : activeTab === "raids" ? (
                <div className="dashboard-stack">
                  <details className="raid-logs-panel raid-logs-acc" open>
                    <summary className="raid-logs-acc-header">
                      <h3>Logs de Raid</h3>
                      <span className="admin-acc-chevron" aria-hidden="true">
                        ▸
                      </span>
                    </summary>
                    <div className="raid-logs-acc-body">
                      {config.logsWatchEnabled && config.logsWatchGuild ? (
                        <div className="raid-log-watcher">
                          <strong>{config.logsWatchGuild}</strong>
                          <span className="muted-text">
                            {config.logsWatchServer} · {config.logsWatchRegion}
                          </span>
                        </div>
                      ) : null}
                      <div className="comunicados-stack">
                        {raidLogsLoading ? (
                          <LoadingState label="Cargando logs de raid…" />
                        ) : (
                          <RaidLogsList
                            logs={raidLogs}
                            onHide={
                              canAccess("raids")
                                ? requestHideRaidLog
                                : undefined
                            }
                          />
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              ) : activeTab === "perfil" ? (
                <div className="profile-view">
                  {profileLoading ? (
                    <div className="empty-state">Cargando perfil...</div>
                  ) : !profile ? (
                    <div className="empty-state">
                      No se pudo cargar el perfil.
                    </div>
                  ) : (
                    <div className="profile-card">
                      <div
                        className="profile-banner"
                        style={
                          profile.bannerUrl
                            ? { backgroundImage: `url(${profile.bannerUrl})` }
                            : profile.accentColor
                              ? {
                                  backgroundColor: `#${profile.accentColor.toString(16).padStart(6, "0")}`,
                                }
                              : undefined
                        }
                      >
                        <img
                          className="profile-avatar"
                          src={
                            profile.avatarUrl ?? profile.serverAvatarUrl ?? ""
                          }
                          alt={profile.displayName}
                        />
                      </div>
                      <div className="profile-body">
                        <h3>{profile.displayName}</h3>
                        <span className="profile-username">
                          @{profile.username}
                        </span>
                        <div className="profile-badges">
                          {profile.isBooster ? (
                            <span className="profile-badge booster">
                              💎 Booster
                            </span>
                          ) : null}
                          {profile.joinedAt ? (
                            <span className="profile-badge">
                              📅 Desde{" "}
                              {new Date(profile.joinedAt).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        {(() => {
                          const entry = leaderboard.find(
                            (candidate) => candidate.userId === profile.userId,
                          );
                          if (!entry) {
                            return null;
                          }
                          const voiceMinutes = entry.voiceMinutes;
                          const hours = Math.floor(voiceMinutes / 60);
                          const minutes = voiceMinutes % 60;
                          return (
                            <div className="profile-stats">
                              <div className="profile-stat">
                                <strong>{entry.level}</strong>
                                <span>Nivel</span>
                              </div>
                              <div className="profile-stat">
                                <strong>{entry.xp}</strong>
                                <span>XP</span>
                              </div>
                              <div className="profile-stat">
                                <strong>{entry.messageCount}</strong>
                                <span>Mensajes</span>
                              </div>
                              <div className="profile-stat">
                                <strong>
                                  {hours > 0
                                    ? `${hours}h ${minutes}m`
                                    : `${minutes}m`}
                                </strong>
                                <span>Voz</span>
                              </div>
                            </div>
                          );
                        })()}
                        {profile.roles.length > 0 ? (
                          <div className="profile-roles">
                            {profile.roles.map((role) => (
                              <span
                                className="profile-role"
                                key={role.id}
                                style={
                                  role.color
                                    ? {
                                        borderColor: `#${role.color.toString(16).padStart(6, "0")}`,
                                        color: `#${role.color.toString(16).padStart(6, "0")}`,
                                      }
                                    : undefined
                                }
                              >
                                {role.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              ) : activeTab === "comunicados" ? (
                <div className="comunicados-stack">
                  {publishedLoading ? (
                    <LoadingState label="Cargando comunicados…" />
                  ) : currentComunicado ? (
                    <div className="comunicado-detail">
                      <button
                        className="comunicado-back"
                        onClick={() => setComunicadoSlug(null)}
                        type="button"
                      >
                        ← Todos los comunicados
                      </button>
                      <article className="comunicado-card">
                        <div className="comunicado-detail-head">
                          <h3>{currentComunicado.title}</h3>
                          {currentComunicado.publishedAt ? (
                            <span className="comunicado-date">
                              {new Date(
                                currentComunicado.publishedAt,
                              ).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        {currentComunicado.authorName ? (
                          <div className="comunicado-author">
                            Por {currentComunicado.authorName}
                          </div>
                        ) : null}
                        <div
                          className="comunicado-content comunicado-markdown"
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(currentComunicado.content),
                          }}
                        />
                        <div className="comunicado-detail-actions">
                          <button
                            className="primary-button"
                            onClick={() =>
                              void copyComunicadoLink(currentComunicado)
                            }
                            type="button"
                          >
                            🔗 Copiar enlace
                          </button>
                          {canAccess("comunicados") ? (
                            <>
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  setInstanceEditor({
                                    communicationId:
                                      currentComunicado.communicationId,
                                    content: currentComunicado.content,
                                    id: currentComunicado.id,
                                    title: currentComunicado.title,
                                  })
                                }
                                type="button"
                              >
                                Editar
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={() =>
                                  requestDeleteInstance(currentComunicado)
                                }
                                type="button"
                              >
                                Eliminar mensaje
                              </button>
                            </>
                          ) : null}
                        </div>
                      </article>
                    </div>
                  ) : comunicadoSlug ? (
                    <div className="empty-state">
                      <p>No se encontró ese comunicado.</p>
                      <button
                        className="primary-button"
                        onClick={() => setComunicadoSlug(null)}
                        type="button"
                      >
                        Ver todos los comunicados
                      </button>
                    </div>
                  ) : published.length === 0 ? (
                    <div className="empty-state">
                      Todavía no hay comunicados publicados.
                    </div>
                  ) : (
                    published.map((comm) => {
                      const expanded = expandedPublished.has(comm.id);
                      return (
                        <article
                          className="comunicado-card comunicado-acc"
                          key={comm.id}
                        >
                          <button
                            className="comunicado-acc-header"
                            onClick={() => togglePublished(comm.id)}
                            type="button"
                            aria-expanded={expanded}
                          >
                            <span className="comunicado-acc-heading">
                              <strong>{comm.title}</strong>
                              {comm.publishedAt ? (
                                <span className="comunicado-date">
                                  {new Date(
                                    comm.publishedAt,
                                  ).toLocaleDateString()}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={`comunicado-acc-chevron${expanded ? " open" : ""}`}
                              aria-hidden="true"
                            >
                              ▸
                            </span>
                          </button>
                          {expanded ? (
                            <div className="comunicado-acc-body">
                              <div className="comunicado-acc-copy">
                                <button
                                  className="ghost-button"
                                  onClick={() => void copyComunicadoLink(comm)}
                                  type="button"
                                >
                                  🔗 Copiar enlace
                                </button>
                              </div>
                              {comm.authorName ? (
                                <div className="comunicado-author">
                                  Por {comm.authorName}
                                </div>
                              ) : null}
                              <div
                                className="comunicado-content comunicado-markdown"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdown(comm.content),
                                }}
                              />
                              {canAccess("comunicados") ? (
                                <div className="comunicado-acc-actions">
                                  <button
                                    className="ghost-button"
                                    onClick={() =>
                                      setInstanceEditor({
                                        communicationId: comm.communicationId,
                                        content: comm.content,
                                        id: comm.id,
                                        title: comm.title,
                                      })
                                    }
                                    type="button"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    className="ghost-button danger"
                                    onClick={() => requestDeleteInstance(comm)}
                                    type="button"
                                  >
                                    Eliminar mensaje
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </div>
              ) : activeTab === "sugerencias" ? (
                <div className="suggestions-view">
                  <label className="suggestions-field">
                    <span>Título</span>
                    <input
                      className="input"
                      value={suggestionTitle}
                      onChange={(event) =>
                        setSuggestionTitle(event.target.value)
                      }
                      placeholder="Título de la sugerencia"
                      maxLength={120}
                    />
                  </label>
                  <label className="suggestions-field">
                    <span>Texto</span>
                    <textarea
                      className="textarea"
                      rows={6}
                      value={suggestionText}
                      onChange={(event) =>
                        setSuggestionText(event.target.value)
                      }
                      placeholder="Detalle de la sugerencia"
                      maxLength={2000}
                    />
                  </label>
                  <div className="suggestions-actions">
                    <button
                      className="primary-button"
                      onClick={() => void handleSendSuggestion()}
                      disabled={sendingSuggestion}
                    >
                      {sendingSuggestion ? "Enviando…" : "Enviar sugerencia"}
                    </button>
                  </div>
                </div>
              ) : activeTab === "karuta" ? (
                <div className="karuta-view">
                  <div className="karuta-subtabs" role="tablist">
                    <button
                      className={`karuta-subtab${karutaSection === "raras" ? " active" : ""}`}
                      onClick={() => setKarutaSection("raras")}
                      type="button"
                    >
                      Raras
                    </button>
                    <button
                      className={`karuta-subtab${karutaSection === "drops" ? " active" : ""}`}
                      onClick={() => setKarutaSection("drops")}
                      type="button"
                    >
                      Drops raros
                    </button>
                    <button
                      className={`karuta-subtab${karutaSection === "coleccion" ? " active" : ""}`}
                      onClick={() => setKarutaSection("coleccion")}
                      type="button"
                    >
                      Colección
                    </button>
                    <button
                      className={`karuta-subtab${karutaSection === "guia" ? " active" : ""}`}
                      onClick={() => setKarutaSection("guia")}
                      type="button"
                    >
                      Comandos
                    </button>
                  </div>

                  {karutaLoading ? (
                    <LoadingState label="Cargando Karuta…" />
                  ) : karutaSection === "drops" ? (
                    <section className="karuta-section">
                      {karutaDrops.length === 0 ? (
                        <div className="empty-state">
                          Todavía no se detectó ningún drop.
                        </div>
                      ) : (
                        <div className="karuta-drops-grid">
                          {karutaDrops.map((drop) => (
                            <article className="karuta-drop-card" key={drop.id}>
                              {drop.imageUrl ? (
                                <img
                                  className="karuta-drop-image"
                                  src={drop.imageUrl}
                                  alt={drop.cardName ?? "Carta"}
                                />
                              ) : (
                                <div className="karuta-drop-image karuta-drop-image-placeholder">
                                  {drop.cardName ?? "Carta"}
                                </div>
                              )}
                              <div className="karuta-drop-body">
                                <strong>{drop.cardName ?? "Carta"}</strong>
                                {drop.series ? (
                                  <span className="karuta-drop-series">
                                    {drop.series}
                                  </span>
                                ) : null}
                                <span className="karuta-drop-user">
                                  {drop.dropperUsername
                                    ? `${drop.dropperUsername} lo tiró · `
                                    : ""}
                                  {drop.username ?? "Alguien"} se la llevó
                                </span>
                                <div className="karuta-drop-reasons">
                                  {drop.printNumber != null ? (
                                    <span className="karuta-drop-badge">
                                      Print #{drop.printNumber}
                                    </span>
                                  ) : null}
                                  {drop.wishlistCount != null ? (
                                    <span className="karuta-drop-badge">
                                      {drop.wishlistCount} en wishlist
                                    </span>
                                  ) : null}
                                </div>
                                <span className="karuta-drop-date">
                                  {new Date(drop.createdAt).toLocaleString()}
                                </span>
                                {canAccess("config") ? (
                                  <button
                                    className="ghost-button danger"
                                    onClick={() => handleDeleteKarutaDrop(drop)}
                                    type="button"
                                  >
                                    Eliminar
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  ) : karutaSection === "raras" ? (
                    <section className="karuta-section">
                      {karutaCards.length === 0 ? (
                        <div className="empty-state">
                          Todavía no hay cartas registradas.
                        </div>
                      ) : (
                        <div className="karuta-drops-grid">
                          {karutaCards.map((card) => (
                            <article className="karuta-drop-card" key={card.id}>
                              {card.imageUrl ? (
                                <img
                                  className="karuta-drop-image"
                                  src={card.imageUrl}
                                  alt={card.cardName ?? "Carta"}
                                />
                              ) : (
                                <div className="karuta-drop-image karuta-drop-image-placeholder">
                                  {card.cardName ?? "Carta"}
                                </div>
                              )}
                              <div className="karuta-drop-body">
                                <strong>{card.cardName ?? "Carta"}</strong>
                                {card.series ? (
                                  <span className="karuta-drop-series">
                                    {card.series}
                                  </span>
                                ) : null}
                                <span className="karuta-drop-user">
                                  {card.ownerUsername ?? "Desconocido"} posee la
                                  carta
                                </span>
                                <div className="karuta-drop-reasons">
                                  {card.printNumber != null ? (
                                    <span className="karuta-drop-badge">
                                      Print #{card.printNumber}
                                    </span>
                                  ) : null}
                                  {card.edition != null ? (
                                    <span className="karuta-drop-badge">
                                      Edición {card.edition}
                                    </span>
                                  ) : null}
                                  {card.wishlistCount != null ? (
                                    <span className="karuta-drop-badge">
                                      {card.wishlistCount} en wishlist
                                    </span>
                                  ) : null}
                                </div>
                                <code className="karuta-card-code">
                                  {card.code}
                                </code>
                                {canAccess("config") ? (
                                  <button
                                    className="ghost-button danger"
                                    onClick={() => handleDeleteKarutaCard(card)}
                                    type="button"
                                  >
                                    Quitar
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  ) : karutaSection === "coleccion" ? (
                    <section className="karuta-section">
                      {karutaAlbums.length === 0 ? (
                        <div className="empty-state">
                          Todavía no hay colecciones. Se agregan cuando alguien
                          ve su álbum con <code>ka</code>.
                        </div>
                      ) : (
                        <div className="karuta-albums-grid">
                          {karutaAlbums.map((album) => (
                            <article
                              className="karuta-drop-card"
                              key={album.id}
                            >
                              <div className="karuta-album-images">
                                {(album.images.length > 0
                                  ? album.images.map((image) => image.url)
                                  : album.imageUrl
                                    ? [album.imageUrl]
                                    : []
                                ).map((url, index) => (
                                  <img
                                    key={`${album.id}-${index}`}
                                    className="karuta-album-image"
                                    src={url}
                                    alt={`${album.albumName ?? "Álbum"} página ${index + 1}`}
                                    loading="lazy"
                                  />
                                ))}
                              </div>
                              <div className="karuta-drop-body">
                                <strong>{album.albumName ?? "Álbum"}</strong>
                                {album.background ? (
                                  <span className="karuta-drop-series">
                                    {album.background}
                                  </span>
                                ) : null}
                                <span className="karuta-drop-user">
                                  {album.ownerUsername ?? "Desconocido"}
                                </span>
                                {album.totalPages != null ? (
                                  <div className="karuta-drop-reasons">
                                    <span className="karuta-drop-badge">
                                      {album.totalPages} página
                                      {album.totalPages === 1 ? "" : "s"}
                                    </span>
                                  </div>
                                ) : null}
                                {canAccess("config") ? (
                                  <button
                                    className="ghost-button danger"
                                    onClick={() =>
                                      handleDeleteKarutaAlbum(album)
                                    }
                                    type="button"
                                  >
                                    Quitar
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  ) : (
                    <section className="karuta-section">
                      <h3>Guía de comandos</h3>
                      <p className="meta-text">
                        Comandos de Karuta con el prefijo de este server.
                      </p>
                      <div className="karuta-command-groups">
                        {KARUTA_COMMAND_GROUPS.map((group) => (
                          <div
                            className="karuta-command-group"
                            key={group.title}
                          >
                            <h4>{group.title}</h4>
                            <div className="karuta-command-list">
                              {group.commands.map((entry) => (
                                <div
                                  className="karuta-command-row"
                                  key={entry.command}
                                >
                                  <code>{entry.command}</code>
                                  <span>{entry.description}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : activeTab === "eventos" ? (
                <div className="dashboard-stack">
                  {canAccess("eventos") ? (
                    <div className="event-actions">
                      <button
                        className="primary-button"
                        onClick={() =>
                          showEventForm
                            ? handleCloseEventForm()
                            : setShowEventForm(true)
                        }
                        type="button"
                      >
                        {showEventForm ? "Cancelar" : "+ Nuevo evento"}
                      </button>
                    </div>
                  ) : null}

                  {showEventForm ? (
                    <div className="event-form-card">
                      <h3 className="event-form-title">
                        {editingEventId ? "Editar evento" : "Nuevo evento"}
                      </h3>
                      <div className="form-grid">
                        <label>
                          <span>Título</span>
                          <input
                            className="input"
                            value={eventForm.title}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="Ej: Raid Heroico — Torre del Brujo"
                            maxLength={120}
                          />
                        </label>
                        <label>
                          <span>Tipo</span>
                          <select
                            className="select"
                            value={eventForm.type}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                type: event.target.value,
                              }))
                            }
                          >
                            {EVENT_TYPES.map((type) => (
                              <option key={type.key} value={type.key}>
                                {type.emoji} {type.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {editingEventId ? (
                          <label>
                            <span>Estado</span>
                            <select
                              className="select"
                              value={eventForm.status}
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  status: event.target.value,
                                }))
                              }
                            >
                              <option value="scheduled">Programado</option>
                              <option value="cancelled">Cancelado</option>
                              <option value="completed">Completado</option>
                            </select>
                          </label>
                        ) : null}
                        <label>
                          <span>Fecha y hora</span>
                          <input
                            className="input"
                            type="datetime-local"
                            value={eventForm.startsAt}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                startsAt: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Duración (minutos)</span>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={eventForm.durationMinutes}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                durationMinutes: event.target.value,
                              }))
                            }
                            placeholder="Ej: 180"
                          />
                        </label>
                        <label>
                          <span>Cierre de inscripciones</span>
                          <input
                            className="input"
                            type="datetime-local"
                            value={eventForm.signupDeadline}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                signupDeadline: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="event-form-wide event-image-editor">
                          <span className="event-image-editor-label">
                            Imagen
                          </span>
                          {eventForm.imageUrl ? (
                            <div className="event-image-preview">
                              <img
                                src={eventForm.imageUrl}
                                alt="Imagen del evento"
                              />
                              <button
                                className="ghost-button danger"
                                onClick={() =>
                                  setEventForm((current) => ({
                                    ...current,
                                    imageUrl: "",
                                  }))
                                }
                                type="button"
                              >
                                Quitar imagen
                              </button>
                            </div>
                          ) : (
                            <div className="event-image-empty">
                              Sin imagen seleccionada.
                            </div>
                          )}
                          <div className="event-image-controls">
                            <input
                              className="input"
                              value={
                                eventForm.imageUrl.startsWith("data:")
                                  ? ""
                                  : eventForm.imageUrl
                              }
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  imageUrl: event.target.value,
                                }))
                              }
                              placeholder="O pegá una URL https://…"
                            />
                            <label className="primary-button event-upload-button">
                              {uploadingImage ? "Subiendo…" : "Subir imagen"}
                              <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(event) =>
                                  void handleImageFileChange(event)
                                }
                              />
                            </label>
                          </div>
                          <div className="event-image-library">
                            <strong>Biblioteca</strong>
                            {eventImagesLoading ? (
                              <span className="muted-text">Cargando…</span>
                            ) : eventImages.length === 0 ? (
                              <span className="muted-text">
                                Vacía: subí una imagen para reutilizarla.
                              </span>
                            ) : (
                              <div className="event-image-library-grid">
                                {eventImages.map((image) => (
                                  <div
                                    className="event-image-library-item"
                                    key={image.id}
                                  >
                                    <img
                                      src={image.dataUrl}
                                      alt={image.name ?? "Imagen"}
                                      onClick={() =>
                                        setEventForm((current) => ({
                                          ...current,
                                          imageUrl: image.dataUrl,
                                        }))
                                      }
                                    />
                                    <button
                                      className="event-image-library-delete"
                                      onClick={() =>
                                        void handleDeleteEventImage(image)
                                      }
                                      title="Eliminar de la biblioteca"
                                      type="button"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <label className="event-form-wide">
                          <span>Descripción</span>
                          <textarea
                            className="textarea"
                            rows={3}
                            value={eventForm.description}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            placeholder="Detalle del evento (opcional)"
                            maxLength={1000}
                          />
                        </label>
                      </div>
                      <div className="event-form-actions">
                        <button
                          className="primary-button"
                          onClick={() => void handleSaveEvent()}
                          disabled={creatingEvent}
                          type="button"
                        >
                          {creatingEvent
                            ? "Guardando…"
                            : editingEventId
                              ? "Guardar cambios"
                              : "Crear evento"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {eventsLoading ? (
                    <LoadingState label="Cargando eventos…" />
                  ) : events.length === 0 ? (
                    <div className="empty-state">
                      Todavía no hay eventos.
                      {canAccess("eventos")
                        ? " Creá el primero con «+ Nuevo evento»."
                        : ""}
                    </div>
                  ) : (
                    <div className="events-grid">
                      {events.map((event) => (
                        <EventCard
                          canManage={canAccess("eventos")}
                          event={event}
                          key={event.id}
                          meId={me?.id}
                          onDelete={handleDeleteEvent}
                          onEdit={handleEditEvent}
                          onRemoveSignup={handleRemoveEventSignup}
                          onSignup={handleEventSignup}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : activeTab === "dashboard" ? null : (
                <div className="empty-state">
                  Módulo en preparación. Esta tab ya está lista para conectar su
                  backend específico en la próxima iteración.
                </div>
              )}
            </section>
          </>
        )}
      </main>
      {roleModal != null ? (
        <div className="modal-overlay" onClick={() => setRoleModal(null)}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4>
              {roleModal.kind === "add"
                ? `Roles extra que se dan al ganar el nivel ${roleModal.level}`
                : `Roles extra que se quitan al ganar el nivel ${roleModal.level}`}
            </h4>
            {roleModalTarget ? (
              <div className="modal-role-list">
                {guildRoles.map((role) => {
                  const currentIds =
                    roleModal.kind === "add"
                      ? roleModalTarget.addRoleIds
                      : roleModalTarget.removeRoleIds;
                  const checked = currentIds.includes(role.id);
                  return (
                    <label className="xp-remove-check" key={role.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...currentIds, role.id]
                            : currentIds.filter((id) => id !== role.id);
                          updateXpRole(roleModal.level, {
                            ...(roleModal.kind === "add"
                              ? { addRoleIds: nextIds }
                              : { removeRoleIds: nextIds }),
                          });
                        }}
                      />
                      {role.name}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                No se encontró el rol de nivel configurado.
              </div>
            )}
            <div className="form-actions">
              <button
                className="primary-button"
                onClick={() => setRoleModal(null)}
                type="button"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {commEditor != null ? (
        <div className="modal-overlay" onClick={() => setCommEditor(null)}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4>{commEditor.id ? "Editar plantilla" : "Nueva plantilla"}</h4>
            <div className="comm-form">
              <label>
                <span>Título</span>
                <input
                  type="text"
                  value={commEditor.title}
                  onChange={(event) =>
                    setCommEditor((current) =>
                      current
                        ? { ...current, title: event.target.value }
                        : current,
                    )
                  }
                  placeholder="Ej: Reclutamiento abierto"
                />
              </label>
              <label>
                <span>Contenido</span>
                <textarea
                  className="textarea"
                  rows={8}
                  value={commEditor.content}
                  onChange={(event) =>
                    setCommEditor((current) =>
                      current
                        ? { ...current, content: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                <span>Canal de publicación (Discord)</span>
                <select
                  className="select"
                  value={commEditor.channelId}
                  onChange={(event) =>
                    setCommEditor((current) =>
                      current
                        ? { ...current, channelId: event.target.value }
                        : current,
                    )
                  }
                >
                  <option value="">Sin canal (solo web)</option>
                  {textChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setCommEditor(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                onClick={() => void handleSaveCommunication()}
                type="button"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {instanceEditor != null ? (
        <div className="modal-overlay" onClick={() => setInstanceEditor(null)}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4>Editar comunicado publicado</h4>
            <p className="comm-edit-hint">
              Se actualiza el mensaje en Discord y en la web.
            </p>
            <div className="comm-form">
              <label>
                <span>Título</span>
                <input
                  type="text"
                  value={instanceEditor.title}
                  onChange={(event) =>
                    setInstanceEditor((current) =>
                      current
                        ? { ...current, title: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                <span>Contenido</span>
                <textarea
                  className="textarea"
                  rows={8}
                  value={instanceEditor.content}
                  onChange={(event) =>
                    setInstanceEditor((current) =>
                      current
                        ? { ...current, content: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setInstanceEditor(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                onClick={() => void handleSaveInstance()}
                type="button"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <ConfirmModal
          dialog={confirmDialog}
          onClose={() => setConfirmDialog(null)}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
