import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
  EVENT_TYPES,
  classColor,
  classEmoji,
  createEvent,
  createEventSpec,
  deleteEvent,
  deleteEventImage,
  deleteEventSpec,
  deleteMyEventSignup,
  deleteMemberEventSignup,
  resetMyEventSignup,
  apiAssetUrl,
  DEFAULT_EVENT_ROLES,
  discordEmojiUrl,
  eventRoleMeta,
  getEventImages,
  getEventSpecs,
  getEventGames,
  getEvents,
  getGuildEmojis,
  publishRaidLog,
  resetEventOccurrence,
  resolveEventRoles,
  scanRaidLogs,
  updateEvent,
  updateRaidLogMessage,
  updateEventSpec,
  uploadEventImage,
  upsertEventSignup,
  upsertMemberEventSignup,
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
  type GuildEmoji,
  type GuildRole,
  type GuildWidgetStatus,
  type LeaderboardEntry,
  type MemberProfile,
  type PublicLeaderboardEntry,
  type RaidLog,
  type KarutaCard,
  type KarutaAlbum,
  type XpConfig,
  type XpImportEntry,
  type XpRoleMultiplier,
  type XpRoleRule,
  type RaidSpec,
  type EventGameConfig,
  type EventGameOption,
  type EventRoleOption,
  type EventDiscordOptions,
  type EventSignup,
  type EventImage,
  type EventTag,
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
    key: "karuta",
    label: "Karuta",
    description: "Cartas raras, colecciones y guía de comandos de Karuta.",
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

// Permisos que se pueden dar uno por uno: son los mismos módulos que revisa
// cada tarjeta del panel (canAccess) y cada ruta del API (canManageModule).
const STAFF_PERMISSIONS: Array<{
  description: string;
  key: string;
  label: string;
}> = [
  {
    description: "Canales, roles y ajustes del servidor.",
    key: "config",
    label: "Configuración general",
  },
  {
    description: "Crear, publicar y editar comunicados.",
    key: "comunicados",
    label: "Comunicados",
  },
  {
    description: "Escanear, publicar y borrar logs de raid.",
    key: "raids",
    label: "Logs de raid",
  },
  {
    description: "Los mensajes que publica Karpindomo cada día.",
    key: "daily",
    label: "Mensajes diarios",
  },
  {
    description: "Niveles, roles por nivel y ranking.",
    key: "xp",
    label: "Sistema de XP",
  },
  {
    description: "Cartas, rarezas y wishlists.",
    key: "karuta",
    label: "Karuta",
  },
  {
    description: "Crear eventos y gestionar inscripciones.",
    key: "eventos",
    label: "Eventos",
  },
];

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

// Un rol mostrado como chip: solo hace falta el id para quitarlo.
type StaffRoleChip = { id: string; name: string };

// Chips de roles + selector "Agregar rol…". Se usa en las plaquitas de la
// jerarquía (el rol entra con TODOS los permisos de ese rango) y en la lista
// por permiso (el rol entra con ese permiso suelto). Sin `onAdd` solo lista y
// permite quitar.
function StaffRoleControls({
  assigned,
  disabled,
  guildRoles,
  label,
  onAdd,
  onRemove,
}: {
  assigned: StaffRoleChip[];
  disabled: boolean;
  guildRoles: GuildRole[];
  label: string;
  onAdd?: (roleId: string) => void;
  onRemove: (roleId: string) => void;
}) {
  const assignedIds = new Set(assigned.map((role) => role.id));
  return (
    <div className="staff-permission-roles">
      {assigned.map((role) => (
        <span className="staff-permission-role" key={role.id}>
          {role.name}
          <button
            aria-label={`Quitar ${role.name}`}
            className="staff-permission-remove"
            disabled={disabled}
            onClick={() => onRemove(role.id)}
            title={`Quitar ${role.name}`}
            type="button"
          >
            ✕
          </button>
        </span>
      ))}
      {onAdd ? (
        <select
          aria-label={`Agregar rol: ${label}`}
          className="select staff-permission-add"
          disabled={disabled}
          onChange={(event) => {
            const roleId = event.target.value;
            event.target.value = "";
            if (roleId) {
              onAdd(roleId);
            }
          }}
          value=""
        >
          <option value="">Agregar rol…</option>
          {guildRoles
            .filter((role) => !assignedIds.has(role.id))
            .map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
        </select>
      ) : null}
    </div>
  );
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

type KarutaSection = "raras" | "coleccion" | "guia";

// Slugs de URL para cada sección de Karuta.
const KARUTA_SECTION_SLUGS: Record<KarutaSection, string> = {
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
  const comunicadoSlug = tab === "comunicados" && parts[1] ? parts[1] : null;
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

// Tarjeta de álbum de Karuta (Colección). Un álbum de Karuta tiene una
// imagen por página (ka muestra "Showing page N of M"), así que mostrarlas
// todas apiladas hacía la tarjeta enorme y deformaba la grilla. Esta tarjeta
// muestra UNA página por vez con flechas para navegar (‹ ›). El estado de la
// página visible es local de la tarjeta y se reinicia al cambiar de álbum
// (React lo hace solo porque usamos key={album.id} en el map).
// Limpia el markdown residual que Karuta a veces deja en los textos de un
// álbum (p. ej. el fondo puede venir como "**Rockin' Robin Cafe**").
function cleanKarutaText(value?: string): string | undefined {
  const cleaned = value
    ?.replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function KarutaAlbumCard({
  album,
  canDelete,
  onDelete,
}: {
  album: KarutaAlbum;
  canDelete: boolean;
  onDelete: (album: KarutaAlbum) => void;
}) {
  const urls =
    album.images.length > 0
      ? album.images.map((image) => apiAssetUrl(image.url))
      : album.imageUrl
        ? [apiAssetUrl(album.imageUrl)]
        : [];
  const [pageIndex, setPageIndex] = useState(0);
  // URLs que ya fallaron (los links de Discord expiran): evitamos el ícono de
  // imagen rota y, si hay otra página que sí cargue, saltamos a esa.
  const [brokenUrls, setBrokenUrls] = useState<string[]>([]);
  const albumName = cleanKarutaText(album.albumName) ?? "Álbum";
  const albumBackground = cleanKarutaText(album.background);
  const pageCount = urls.length;
  const pageNumber = pageCount > 0 ? pageIndex + 1 : 0;
  const currentUrl = pageCount > 0 ? urls[pageIndex] : undefined;
  const showImage =
    Boolean(currentUrl) && !brokenUrls.includes(currentUrl as string);

  const markBroken = (failedUrl: string) => {
    setBrokenUrls((previous) =>
      previous.includes(failedUrl) ? previous : [...previous, failedUrl],
    );
    const alternative = urls.findIndex(
      (url) => url !== failedUrl && !brokenUrls.includes(url),
    );
    if (alternative >= 0) {
      setPageIndex(alternative);
    }
  };

  return (
    <article className="karuta-drop-card">
      <div className="karuta-album-images">
        {showImage && currentUrl ? (
          <img
            className="karuta-album-image"
            src={currentUrl}
            alt={`${albumName} · página ${pageNumber}`}
            loading="lazy"
            onError={() => markBroken(currentUrl)}
          />
        ) : (
          <div className="karuta-album-image karuta-album-image-empty">
            {currentUrl
              ? `No se pudo cargar la imagen · ${albumName}`
              : "Sin imagen"}
          </div>
        )}
        {pageCount > 1 ? (
          <div className="karuta-album-nav">
            <button
              aria-label="Página anterior"
              className="karuta-album-nav-btn"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              type="button"
            >
              ‹
            </button>
            <span className="karuta-album-nav-counter">
              {pageNumber} / {pageCount}
            </span>
            <button
              aria-label="Página siguiente"
              className="karuta-album-nav-btn"
              disabled={pageIndex >= pageCount - 1}
              onClick={() =>
                setPageIndex((index) => Math.min(pageCount - 1, index + 1))
              }
              type="button"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
      <div className="karuta-drop-body">
        <strong>{albumName}</strong>
        {albumBackground ? (
          <span className="karuta-drop-series">{albumBackground}</span>
        ) : null}
        <span className="karuta-drop-user">
          {album.ownerUsername ?? "Desconocido"}
        </span>
        {album.totalPages != null ? (
          <div className="karuta-drop-reasons">
            <span className="karuta-drop-badge">
              {album.totalPages} página{album.totalPages === 1 ? "" : "s"}
            </span>
          </div>
        ) : null}
        {canDelete ? (
          <button
            className="ghost-button danger"
            onClick={() => onDelete(album)}
            type="button"
          >
            Quitar
          </button>
        ) : null}
      </div>
    </article>
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

// Lista reutilizable de logs de raid. Una entrada por NOCHE: los reports con
// el mismo título y fecha (una subida en dos partes) salen juntos y se publican
// en un solo mensaje. Cada entrada es un acordeón y se publica a mano.
function RaidLogsList({
  logs,
  onHide,
  onPublish,
  onUpdate,
}: {
  logs: RaidLog[];
  onHide?: (group: RaidLog[]) => void;
  onPublish?: (log: RaidLog) => Promise<void>;
  onUpdate?: (log: RaidLog) => Promise<void>;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byKey = new Map<string, RaidLog[]>();
    for (const log of logs) {
      const key = log.groupKey || log.id;
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.push(log);
      } else {
        byKey.set(key, [log]);
      }
    }
    return [...byKey.entries()].map(([key, parts]) => ({
      fights: parts.reduce((total, part) => total + part.fightCount, 0),
      key,
      kills: parts.reduce((total, part) => total + part.kills, 0),
      needsUpdate: parts.some((part) => part.needsUpdate),
      parts: [...parts].sort((a, b) =>
        (a.firstFightAt ?? a.createdAt).localeCompare(
          b.firstFightAt ?? b.createdAt,
        ),
      ),
      posted: parts.some((part) => part.discordPosted),
      startedAt: parts
        .map((part) => part.firstFightAt)
        .filter((date): date is string => Boolean(date))
        .sort()[0],
      status: parts.some((part) => part.status === "failed")
        ? "failed"
        : parts.some((part) => part.status === "live")
          ? "live"
          : "synced",
      title: parts[0]?.title,
    }));
  }, [logs]);

  const toggleGroup = (key: string): void => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <div className="empty-state">
        Todavía no hay logs de raid. El bot los detecta desde Warcraft Logs y
        quedan acá como borrador hasta que los publiques.
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const expanded = expandedKeys.has(group.key);
        const lead = group.parts[0];
        const busy = busyKey === group.key;
        // Publicado pero con el mensaje viejo: el API lo corrige solo. Si la
        // noche sigue en curso no se avisa: primero tiene que terminar.
        const pending =
          group.posted && group.needsUpdate === true && group.status !== "live";
        const runAction = (action?: (log: RaidLog) => Promise<void>) => {
          if (!action) {
            return;
          }
          setBusyKey(group.key);
          void action(lead).finally(() => setBusyKey(null));
        };

        return (
          <article className="comunicado-card comunicado-acc" key={group.key}>
            <button
              className="comunicado-acc-header"
              onClick={() => toggleGroup(group.key)}
              type="button"
              aria-expanded={expanded}
            >
              <span className="comunicado-acc-heading">
                <strong>{group.title || "Log de Raid"}</strong>
                {group.startedAt ? (
                  <span className="comunicado-date">
                    {formatDate24(group.startedAt)}
                  </span>
                ) : null}
                <span className="raid-log-meta-inline">
                  ⚔️ {group.fights} · 💀 {group.kills}
                  {group.parts.length > 1
                    ? ` · ${group.parts.length} reports`
                    : ""}
                </span>
              </span>
              <span className="comunicado-acc-heading-right">
                <span
                  className={`raid-log-badge raid-log-${group.status}${pending ? " raid-log-pending" : ""}`}
                >
                  {group.status === "failed"
                    ? "Sin datos"
                    : group.status === "live"
                      ? "En vivo"
                      : pending
                        ? "Actualizando…"
                        : group.posted
                          ? "Publicado"
                          : "Sin publicar"}
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
                  ⚔️ {group.fights} fight/s · 💀 {group.kills} kill/s
                </div>
                {group.parts.length > 1 ? (
                  <div className="raid-log-parts">
                    {group.parts.map((part) => (
                      <div className="raid-log-part" key={part.id}>
                        <span className="raid-log-part-code">
                          {part.reportCode}
                        </span>
                        <span className="muted-text">
                          ⚔️ {part.fightCount} · 💀 {part.kills}
                        </span>
                        <a
                          className="raid-log-link"
                          href={part.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver ↗
                        </a>
                      </div>
                    ))}
                  </div>
                ) : null}
                {lead?.summary && lead.summary.fights.length > 0 ? (
                  <div className="raid-log-fights">
                    {group.parts
                      .flatMap((part) => part.summary?.fights ?? [])
                      .map((fight, index) => (
                        <span
                          className={`raid-log-fight${fight.kill ? " kill" : " wipe"}`}
                          key={index}
                        >
                          {fight.name ?? "Fight"} {fight.kill ? "✅" : "❌"}
                        </span>
                      ))}
                  </div>
                ) : lead?.error ? (
                  <div className="meta-text">⚠️ {lead.error}</div>
                ) : null}
                {group.parts.length === 1 ? (
                  <a
                    className="raid-log-link"
                    href={lead.reportUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver en Warcraft Logs ↗
                  </a>
                ) : null}
                <div className="comunicado-acc-actions">
                  {group.posted ? (
                    onUpdate ? (
                      <button
                        className="ghost-button"
                        disabled={busy}
                        onClick={() => runAction(onUpdate)}
                        type="button"
                      >
                        {busy ? "Actualizando…" : "Actualizar"}
                      </button>
                    ) : null
                  ) : onPublish ? (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => runAction(onPublish)}
                      type="button"
                    >
                      {busy ? "Publicando…" : "Publicar"}
                    </button>
                  ) : null}
                  {onHide ? (
                    <button
                      className="ghost-button danger"
                      onClick={() => onHide(group.parts)}
                      type="button"
                    >
                      Eliminar
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

// Valores por defecto de la sección "Publicar en Discord" del form.
function defaultEventDiscord() {
  return {
    createScheduledEvent: false,
    entityType: "voice" as const,
    location: "",
    publishChannelId: "",
    publishMessage: false,
    recurrence: "none" as const,
    voiceChannelId: "",
  };
}

function recurrenceLabel(
  recurrence?: "none" | "daily" | "weekly" | "biweekly" | string,
): string | undefined {
  switch (recurrence) {
    case "daily":
      return "Repite todos los días";
    case "weekly":
      return "Repite semanal";
    case "biweekly":
      return "Repite cada 2 semanas";
    default:
      return undefined;
  }
}

const SIGNUP_OPTIONS: Array<{
  emoji: string;
  key: "yes" | "late" | "bench" | "no";
  label: string;
}> = [
  { emoji: "✅", key: "yes", label: "Voy" },
  { emoji: "⏰", key: "late", label: "Tarde" },
  { emoji: "🪑", key: "bench", label: "Bench" },
  { emoji: "❌", key: "no", label: "No asisto" },
];

// Horas de recordatorio de asistencia configurables por evento (antes del
// inicio). Con rol mínimo elegido, el bot menciona en el canal del aviso a
// quienes tienen el rol y todavía no se anotaron.
const REMINDER_HOUR_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 48, label: "48 h antes" },
  { hours: 24, label: "24 h antes" },
  { hours: 2, label: "2 h antes" },
];

// Convierte una fecha a string local YYYY-MM-DDTHH:mm (sin zona horaria).
function toDateTimeLocal(value: Date | string): string {
  const date = new Date(value);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Convierte el string local del formulario (YYYY-MM-DDTHH:mm) al instante
// absoluto en ISO/UTC. IMPORTANTE: si mandáramos el string "pelado", el
// servidor (que corre en UTC) lo interpretaría como UTC y el evento se
// guardaría 3 h corrido; con toISOString() viaja el momento exacto.
function toIsoInstant(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// ── Fechas y horas en formato fijo (dd/mm/aaaa + 24 hs) ─────────────
// No usamos toLocaleString/toLocaleDateString porque dependen del idioma del
// navegador: con el navegador en inglés muestran mm/dd y AM/PM.
function toDateOrNull(value: string | Date | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate24(value: string | Date | undefined): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatTime24(
  value: string | Date | undefined,
  withSeconds = false,
): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad2(date.getSeconds())}` : base;
}

function formatDateTime24(value: string | Date | undefined): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  return `${formatDate24(date)} ${formatTime24(date)}`;
}

// Parte de fecha (dd/mm/aaaa) de un valor local YYYY-MM-DDTHH:mm.
function datePartText(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

// Nombres/etiquetas del almanaque (semana arranca lunes, como acá).
const MONTH_LABELS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

function parseDateParts(
  value: string,
): { day: number; month: number; year: number } | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { day, month, year };
}

function currentMonthKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
}

// Selector de fecha y hora: se puede tipear dd/mm/aaaa o elegir la fecha en el
// almanaque (mismo formato siempre, sin depender del idioma del navegador) y
// la hora se elige en selects de 24 hs. Emite un valor local YYYY-MM-DDTHH:mm
// (o "" si la fecha está incompleta).
function EventDateTimeField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const [dateText, setDateText] = useState(() => datePartText(value));
  // Último valor que emitimos: sirve para distinguir un cambio nuestro (no hay
  // que pisar lo que el usuario está tipeando) de uno externo (editar/duplicar).
  const lastEmitted = useRef<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Mes que muestra el almanaque (clave YYYY-MM).
  const [calendarMonth, setCalendarMonth] = useState(() =>
    value ? value.slice(0, 7) : currentMonthKey(),
  );
  const hours = value.match(/T(\d{2}):/)?.[1] ?? "00";
  const minutes = value.match(/T\d{2}:(\d{2})/)?.[1] ?? "00";

  // Si el valor cambia desde afuera (editar/duplicar un evento), sincronizamos.
  useEffect(() => {
    if (value === lastEmitted.current) {
      return;
    }
    lastEmitted.current = value;
    setDateText(datePartText(value));
  }, [value]);

  const emit = (
    nextDateText: string,
    nextHours: string,
    nextMinutes: string,
  ) => {
    const match = nextDateText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
      lastEmitted.current = "";
      onChange("");
      return;
    }
    const [, day, month, year] = match;
    const iso = `${year}-${month}-${day}T${nextHours}:${nextMinutes}`;
    const next = Number.isNaN(new Date(iso).getTime()) ? "" : iso;
    lastEmitted.current = next;
    onChange(next);
  };

  const selected = parseDateParts(dateText);
  const [calendarYear, calendarMonthNumber] = calendarMonth
    .split("-")
    .map(Number);

  // Celdas del mes: huecos del primer día + los días (semana empieza lunes).
  const monthCells = useMemo(() => {
    const firstWeekday =
      (new Date(calendarYear, calendarMonthNumber - 1, 1).getDay() + 6) % 7;
    const totalDays = new Date(calendarYear, calendarMonthNumber, 0).getDate();
    const cells: Array<number | null> = Array.from(
      { length: firstWeekday },
      () => null,
    );
    for (let day = 1; day <= totalDays; day += 1) {
      cells.push(day);
    }
    return cells;
  }, [calendarMonthNumber, calendarYear]);

  const today = new Date();

  const shiftMonth = (delta: number): void => {
    const next = new Date(calendarYear, calendarMonthNumber - 1 + delta, 1);
    setCalendarMonth(`${next.getFullYear()}-${pad2(next.getMonth() + 1)}`);
  };

  const toggleCalendar = (): void => {
    if (!calendarOpen && selected) {
      // Abrimos en el mes de la fecha que ya está puesta.
      setCalendarMonth(`${selected.year}-${pad2(selected.month)}`);
    }
    setCalendarOpen((current) => !current);
  };

  const pickDay = (day: number): void => {
    const next = `${pad2(day)}/${pad2(calendarMonthNumber)}/${calendarYear}`;
    setDateText(next);
    emit(next, hours, minutes);
    setCalendarOpen(false);
  };

  return (
    <div className="event-datetime-field">
      <span className="event-date-input">
        <input
          className="input"
          inputMode="numeric"
          placeholder="dd/mm/aaaa"
          value={dateText}
          onChange={(event) => {
            // Máscara: solo dígitos, con las barras puestas solas.
            const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
            const parts = [
              digits.slice(0, 2),
              digits.slice(2, 4),
              digits.slice(4, 8),
            ].filter(Boolean);
            const nextText = parts.join("/");
            setDateText(nextText);
            emit(nextText, hours, minutes);
          }}
        />
        <button
          aria-expanded={calendarOpen}
          className="event-date-toggle"
          onClick={toggleCalendar}
          title="Elegir la fecha en el almanaque"
          type="button"
        >
          📅
        </button>
        {calendarOpen ? (
          <>
            <span
              className="event-calendar-backdrop"
              onClick={() => setCalendarOpen(false)}
            />
            <div className="event-calendar">
              <div className="event-calendar-head">
                <button
                  aria-label="Mes anterior"
                  onClick={() => shiftMonth(-1)}
                  type="button"
                >
                  ‹
                </button>
                <span>
                  {MONTH_LABELS[calendarMonthNumber - 1]} {calendarYear}
                </span>
                <button
                  aria-label="Mes siguiente"
                  onClick={() => shiftMonth(1)}
                  type="button"
                >
                  ›
                </button>
              </div>
              <div className="event-calendar-grid">
                {WEEKDAY_LABELS.map((label, index) => (
                  <span
                    className="event-calendar-weekday"
                    key={`${label}-${index}`}
                  >
                    {label}
                  </span>
                ))}
                {monthCells.map((day, index) =>
                  day === null ? (
                    <span key={`hueco-${index}`} />
                  ) : (
                    <button
                      className={[
                        "event-calendar-day",
                        selected &&
                        selected.day === day &&
                        selected.month === calendarMonthNumber &&
                        selected.year === calendarYear
                          ? "selected"
                          : "",
                        today.getDate() === day &&
                        today.getMonth() + 1 === calendarMonthNumber &&
                        today.getFullYear() === calendarYear
                          ? "today"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={day}
                      onClick={() => pickDay(day)}
                      type="button"
                    >
                      {day}
                    </button>
                  ),
                )}
              </div>
            </div>
          </>
        ) : null}
      </span>
      <select
        className="select event-time-select"
        value={hours}
        onChange={(event) => emit(dateText, event.target.value, minutes)}
      >
        {Array.from({ length: 24 }, (_value, hour) => (
          <option key={hour} value={pad2(hour)}>
            {pad2(hour)}
          </option>
        ))}
      </select>
      <span aria-hidden="true">:</span>
      <select
        className="select event-time-select"
        value={minutes}
        onChange={(event) => emit(dateText, hours, event.target.value)}
      >
        {Array.from({ length: 60 }, (_value, minute) => (
          <option key={minute} value={pad2(minute)}>
            {pad2(minute)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Tag de comunicados ──────────────────────────────────────────────
// Un comunicado puede llevar una etiqueta corta con color libre (hex).
// Normaliza el color a #rrggbb (acepta #rgb, "abc" o "#aabbcc").
function normalizeTagColor(
  value: string | undefined,
  fallback = "#ff7043",
): string {
  let hex = (value ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : fallback;
}

// Texto legible sobre el color del tag (blanco u oscuro según luminancia).
function tagTextColor(hex: string): string {
  const h = normalizeTagColor(hex).replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 150 ? "#141b2b" : "#ffffff";
}

// Chip del tag: si no hay etiqueta no renderiza nada (uso seguro en cards).
function ComunicadoTag({ color, label }: { color?: string; label?: string }) {
  const text = label?.trim();
  if (!text) {
    return null;
  }
  const background = normalizeTagColor(color);
  return (
    <span
      className="comunicado-tag"
      style={{ backgroundColor: background, color: tagTextColor(background) }}
      title={text}
    >
      {text}
    </span>
  );
}

const MAX_EVENT_TAGS = 6;
// Valor del filtro "eventos sin ninguna etiqueta".
const EVENT_TAG_NONE = "__none__";

// ── Filtros de listas (comunicados, eventos, raids, cartas) ─────────
// Todas las listas comparten el mecanismo: buscador, orden por fecha o
// alfabético y, donde haya etiquetas, chips para filtrar.
type ListOrder = "az" | "newest" | "oldest" | "za";
type KarutaRarityFilter = "all" | "normal" | "super" | "ultra";

const LIST_ORDER_OPTIONS: Array<{ key: ListOrder; label: string }> = [
  { key: "newest", label: "Más recientes" },
  { key: "oldest", label: "Más antiguos" },
  { key: "az", label: "A-Z" },
  { key: "za", label: "Z-A" },
];

function matchesSearch(value: string, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle.length === 0 || value.toLowerCase().includes(needle);
}

function sortByOrder<T>(
  items: T[],
  order: ListOrder,
  dateOf: (item: T) => string | undefined,
  labelOf: (item: T) => string,
): T[] {
  const time = (value?: string): number =>
    value ? new Date(value).getTime() : 0;
  return [...items].sort((a, b) => {
    if (order === "az") {
      return labelOf(a).localeCompare(labelOf(b), "es");
    }
    if (order === "za") {
      return labelOf(b).localeCompare(labelOf(a), "es");
    }
    const diff = time(dateOf(a)) - time(dateOf(b));
    return order === "oldest" ? diff : -diff;
  });
}

// Buscador + selector de orden. Los chips de etiqueta van como children, para
// que cada lista muestre los suyos.
function ListFilterBar({
  children,
  onOrderChange,
  onSearchChange,
  order,
  placeholder,
  search,
}: {
  children?: ReactNode;
  onOrderChange: (order: ListOrder) => void;
  onSearchChange: (value: string) => void;
  order: ListOrder;
  placeholder: string;
  search: string;
}) {
  return (
    <div className="list-filters">
      <input
        className="input list-search"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={search}
      />
      <select
        aria-label="Ordenar"
        className="select list-order"
        onChange={(event) => onOrderChange(event.target.value as ListOrder)}
        value={order}
      >
        {LIST_ORDER_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      {children}
    </div>
  );
}

// Editor de etiquetas de un evento: se agregan de a una (texto + color) y se
// ven como chips con su ✕. Sugiere textos ya usados en otros eventos.
function EventTagsField({
  onChange,
  suggestions,
  tags,
}: {
  onChange: (tags: EventTag[]) => void;
  suggestions: string[];
  tags: EventTag[];
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#6aa8ff");

  const addTag = (): void => {
    const text = label.trim().slice(0, 24);
    if (!text || tags.length >= MAX_EVENT_TAGS) {
      return;
    }
    if (tags.some((tag) => tag.label.toLowerCase() === text.toLowerCase())) {
      setLabel("");
      return;
    }
    onChange([...tags, { color: normalizeTagColor(color), label: text }]);
    setLabel("");
  };

  return (
    <div className="event-tags-editor">
      {tags.length > 0 ? (
        <div className="event-tag-list">
          {tags.map((tag) => (
            <span className="event-tag-item" key={tag.label}>
              <ComunicadoTag color={tag.color} label={tag.label} />
              <button
                className="event-tag-remove"
                onClick={() =>
                  onChange(tags.filter((entry) => entry.label !== tag.label))
                }
                title={`Quitar ${tag.label}`}
                type="button"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {tags.length < MAX_EVENT_TAGS ? (
        <div className="event-tag-add">
          <input
            className="event-tag-input"
            list="event-tag-suggestions"
            maxLength={24}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag();
              }
            }}
            placeholder="Etiqueta"
            value={label}
          />
          <input
            aria-label="Color de la etiqueta"
            className="event-tag-color"
            onChange={(event) => setColor(event.target.value)}
            type="color"
            value={color}
          />
          <button
            className="ghost-button"
            disabled={!label.trim()}
            onClick={addTag}
            type="button"
          >
            Agregar
          </button>
        </div>
      ) : null}
      <datalist id="event-tag-suggestions">
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </div>
  );
}

function EventTagFilterChip({
  active,
  color,
  label,
  onToggle,
}: {
  active: boolean;
  color: string;
  label: string;
  onToggle: () => void;
}) {
  const background = normalizeTagColor(color);
  return (
    <button
      className={`event-filter-chip${active ? " active" : ""}`}
      onClick={onToggle}
      style={
        active
          ? {
              backgroundColor: background,
              borderColor: background,
              color: tagTextColor(background),
            }
          : undefined
      }
      type="button"
    >
      {label}
    </button>
  );
}

// Campos del editor de tag (texto + color + vista previa). Se usa en el
// modal de plantilla y en el de mensaje publicado para no duplicar markup.
function ComunicadoTagFields({
  color,
  label,
  onColor,
  onLabel,
}: {
  color: string;
  label: string;
  onColor: (value: string) => void;
  onLabel: (value: string) => void;
}) {
  return (
    <div className="comm-tag-editor">
      <label>
        <span>Tag (opcional)</span>
        <input
          type="text"
          value={label}
          onChange={(event) => onLabel(event.target.value)}
          placeholder="Ej: Raid"
          maxLength={24}
        />
      </label>
      <div className="comm-tag-color">
        <span>Color del tag</span>
        <span className="comm-tag-color-row">
          <input
            type="color"
            className="comm-tag-swatch"
            value={normalizeTagColor(color)}
            onChange={(event) => onColor(event.target.value)}
          />
          <input
            type="text"
            className="comm-tag-hex"
            value={color}
            onChange={(event) => onColor(event.target.value)}
            placeholder="#ff7043"
            maxLength={7}
          />
        </span>
      </div>
      <div className="comm-tag-preview">
        <span>Vista previa:</span>
        <ComunicadoTag color={color} label={label} />
      </div>
    </div>
  );
}

// ── Tilt 3D de las cartas de Karuta ──────────────────────────────────
// La carta se inclina siguiendo al mouse, como si la sostuvieras, y el
// reflejo holográfico se corre con el cursor. Toda la matemática la hace el
// CSS: acá solo escribimos CSS custom properties en el elemento.
//
//   --karuta-tilt-x / --karuta-tilt-y   rotación en grados
//   --karuta-glare-x / --karuta-glare-y posición (%) del reflejo
//
// Sin estado de React a propósito: un setState por cada pointermove
// re-renderizaría la grilla completa decenas de veces por segundo. El frame
// pendiente y el último punto viven en WeakMaps por elemento (se liberan solos
// cuando la carta se desmonta) y los handlers son funciones de módulo, así no
// se asigna un closure por carta en cada render.
//
// Solo actúa con puntero fino (mouse/trackpad): en touch no existe el hover y
// las cartas se quedan con su animación automática de brillo.
const KARUTA_TILT_MAX_DEG = 10;
const KARUTA_TILT_PROPERTIES = [
  "--karuta-tilt-x",
  "--karuta-tilt-y",
  "--karuta-glare-x",
  "--karuta-glare-y",
];

const karutaTiltFrames = new WeakMap<HTMLElement, number>();
const karutaTiltPoints = new WeakMap<HTMLElement, { x: number; y: number }>();

function karutaTiltEnabled(): boolean {
  return (
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function applyKarutaTilt(element: HTMLElement): void {
  karutaTiltFrames.delete(element);
  const point = karutaTiltPoints.get(element);
  if (!point) {
    return;
  }

  const style = element.style;
  style.setProperty(
    "--karuta-tilt-x",
    `${(-point.y * KARUTA_TILT_MAX_DEG).toFixed(2)}deg`,
  );
  style.setProperty(
    "--karuta-tilt-y",
    `${(point.x * KARUTA_TILT_MAX_DEG).toFixed(2)}deg`,
  );
  style.setProperty(
    "--karuta-glare-x",
    `${((point.x + 0.5) * 100).toFixed(1)}%`,
  );
  style.setProperty(
    "--karuta-glare-y",
    `${((point.y + 0.5) * 100).toFixed(1)}%`,
  );
}

function handleKarutaCardPointerEnter(
  event: ReactPointerEvent<HTMLElement>,
): void {
  if (!karutaTiltEnabled()) {
    return;
  }
  event.currentTarget.classList.add("karuta-tilting");
}

function handleKarutaCardPointerMove(
  event: ReactPointerEvent<HTMLElement>,
): void {
  if (!karutaTiltEnabled()) {
    return;
  }

  const element = event.currentTarget;

  // El centro del rect no se mueve al transformar (rotamos y escalamos
  // alrededor del centro), pero el TAMAÑO sí: si midiéramos el rect ya
  // inclinado las coordenadas se retroalimentarían y la carta temblaría. Por
  // eso el tamaño sale de offsetWidth/offsetHeight, que ignora transforms.
  const rect = element.getBoundingClientRect();
  const width = element.offsetWidth || rect.width;
  const height = element.offsetHeight || rect.height;
  if (!width || !height) {
    return;
  }

  // -0.5 = borde izquierdo/arriba · 0 = centro · 0.5 = borde derecho/abajo
  karutaTiltPoints.set(element, {
    x: (event.clientX - (rect.left + rect.width / 2)) / width,
    y: (event.clientY - (rect.top + rect.height / 2)) / height,
  });

  // Un solo rAF por frame: pointermove llega 100+ veces por segundo y no tiene
  // sentido escribir estilos más seguido de lo que el browser pinta.
  if (!karutaTiltFrames.has(element)) {
    karutaTiltFrames.set(
      element,
      requestAnimationFrame(() => applyKarutaTilt(element)),
    );
  }
}

function handleKarutaCardPointerLeave(
  event: ReactPointerEvent<HTMLElement>,
): void {
  const element = event.currentTarget;

  const frame = karutaTiltFrames.get(element);
  if (frame !== undefined) {
    cancelAnimationFrame(frame);
    karutaTiltFrames.delete(element);
  }
  karutaTiltPoints.delete(element);
  element.classList.remove("karuta-tilting");

  // Sin las custom properties el CSS vuelve a sus valores por defecto (carta
  // plana, reflejo centrado); la transición se encarga de que no salte.
  for (const property of KARUTA_TILT_PROPERTIES) {
    element.style.removeProperty(property);
  }
}

// Arte de una carta de Karuta: si la imagen falla (URL caída o sin arte),
// muestra el placeholder con el nombre en vez de un cuadro vacío "roto".
function KarutaCardArt({ name, url }: { name?: string; url?: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="karuta-drop-image karuta-drop-image-placeholder">
        {name ?? "Carta"}
      </div>
    );
  }
  return (
    <img
      alt={name ?? "Carta"}
      className="karuta-drop-image"
      loading="lazy"
      onError={() => setBroken(true)}
      src={url}
    />
  );
}

// Niveles de rareza "extra" (config del módulo Karuta). Se comparan contra el
// print y/o la wishlist de la carta; en la grilla se pintan con brillos
// distintos: súper = dorado, ultra = holográfico.
const KARUTA_TIER_DEFAULTS = {
  superPrintMax: 3,
  superWishlistMin: 10,
  ultraPrintMax: 1,
  ultraWishlistMin: 25,
} as const;

type KarutaCardTier = "super" | "ultra" | null;

function karutaCardTier(
  card: { printNumber?: number; wishlistCount?: number },
  config: GuildConfig,
): KarutaCardTier {
  const print = card.printNumber;
  const wishlist = card.wishlistCount;

  const matches = (printMax?: number, wishlistMin?: number): boolean => {
    if (print != null && printMax != null && print <= printMax) {
      return true;
    }
    return wishlist != null && wishlistMin != null && wishlist >= wishlistMin;
  };

  const ultra = matches(
    config.karutaUltraRarePrintMax ?? KARUTA_TIER_DEFAULTS.ultraPrintMax,
    config.karutaUltraRareWishlistMin ?? KARUTA_TIER_DEFAULTS.ultraWishlistMin,
  );
  if (ultra) {
    return "ultra";
  }

  const superRare = matches(
    config.karutaSuperRarePrintMax ?? KARUTA_TIER_DEFAULTS.superPrintMax,
    config.karutaSuperRareWishlistMin ?? KARUTA_TIER_DEFAULTS.superWishlistMin,
  );
  return superRare ? "super" : null;
}

// Imagen de un emoji custom de Discord con fallback: si el CDN la rechaza
// (emoji borrado, URL inválida) mostramos el emoji unicode o nada, en vez del
// clásico recuadro de imagen rota.
function DiscordEmojiImage({
  animated,
  className = "signup-spec-emoji",
  emojiId,
  fallback,
  name,
  size,
}: {
  animated?: boolean;
  className?: string;
  emojiId?: string;
  fallback?: string;
  name?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = discordEmojiUrl(emojiId, animated, size);
  if (!url || failed) {
    return fallback ? <span aria-hidden="true">{fallback}</span> : null;
  }
  return (
    <img
      alt={name ?? ""}
      className={className}
      onError={() => setFailed(true)}
      src={url}
    />
  );
}

// Emoji de un rol de evento: custom de Discord (imagen) o unicode.
function EventRoleEmoji({
  role,
  roles,
  size = 18,
}: {
  role: string;
  roles: EventRoleOption[];
  size?: number;
}) {
  const meta = eventRoleMeta(role, roles);
  return (
    <DiscordEmojiImage
      animated={meta?.animated}
      emojiId={meta?.emojiId}
      fallback={meta?.emoji ?? "❔"}
      name={meta?.label}
      size={size}
    />
  );
}

// Tarjeta de evento del Módulo X: muestra info, roster e inscripción del
// usuario logueado (clase, rol, personaje y estado).
function EventCard({
  canManage,
  config,
  event,
  guildRoles,
  gameRoles,
  meId,
  onDelete,
  onDuplicate,
  onEdit,
  onRemoveSignup,
  onResetOccurrence,
  onResetSignup,
  onSignup,
  onStaffRemoveSignup,
  onStaffSignup,
  specs,
}: {
  canManage: boolean;
  config: GuildConfig;
  event: HubEvent;
  guildRoles: GuildRole[];
  // Roles de inscripción del JUEGO del evento.
  gameRoles: EventRoleOption[];
  meId?: string;
  onDelete: (event: HubEvent) => void;
  onDuplicate: (event: HubEvent) => void;
  onEdit: (event: HubEvent) => void;
  onRemoveSignup: (eventId: string) => Promise<void>;
  // Limpia la ocurrencia de una serie (Discord + inscripciones) y mueve el
  // molde a la próxima fecha, sin perder la serie.
  onResetOccurrence: (event: HubEvent) => void;
  onResetSignup: (eventId: string) => Promise<void>;
  onSignup: (
    eventId: string,
    input: {
      character?: string;
      role?: string;
      spec?: string;
      status: string;
      wowClass?: string;
    },
  ) => Promise<void>;
  // Edición manual del staff: cambia la inscripción de cualquier miembro.
  // `notify` = además avisarle por mensaje directo qué le cambió.
  onStaffRemoveSignup: (
    eventId: string,
    userId: string,
    username: string,
    notify: boolean,
  ) => Promise<void>;
  onStaffSignup: (
    eventId: string,
    userId: string,
    input: {
      character?: string;
      notify?: boolean;
      role?: string;
      spec?: string;
      status: string;
      wowClass?: string;
    },
  ) => Promise<void>;
  specs: RaidSpec[];
}) {
  const mySignup = meId
    ? event.signups.find((signup) => signup.userId === meId)
    : undefined;

  // Roles del juego del evento: el catálogo también viene ya filtrado por
  // juego desde la tab Eventos. `characterEnabled` permite ocultar el
  // personaje en juegos que no usan PJ (p. ej. LoL).
  const eventRoles = gameRoles;
  const characterEnabled = event.characterEnabled !== false;
  const roleLabelFor = (key: string): string =>
    eventRoleMeta(key, eventRoles)?.label ?? key;

  const [wowClass, setWowClass] = useState(mySignup?.wowClass ?? "");
  const [role, setRole] = useState(mySignup?.role ?? "");
  const [spec, setSpec] = useState(mySignup?.spec ?? "");
  // Rol que se está explorando en el selector (empieza por el actual).
  const [catalogRole, setCatalogRole] = useState<string>(
    mySignup?.role && eventRoles.some((entry) => entry.key === mySignup.role)
      ? mySignup.role
      : (eventRoles[0]?.key ?? "tank"),
  );
  const [character, setCharacter] = useState(mySignup?.character ?? "");
  const [status, setStatus] = useState(mySignup?.status ?? "yes");
  const [submitting, setSubmitting] = useState(false);
  // Error de validación del formulario de inscripción (p. ej. falta personaje).
  const [signupError, setSignupError] = useState<string | null>(null);
  // Edición manual del staff: qué miembro y con qué valores.
  const [staffEdit, setStaffEdit] = useState<{
    character: string;
    role: string;
    spec: string;
    status: string;
    userId: string;
    username: string;
    wowClass: string;
  } | null>(null);
  const [staffSaving, setStaffSaving] = useState(false);
  // Avisar por MD al miembro de qué le cambió (arranca encendido: es el
  // motivo por el que el staff abre el editor).
  const [staffNotify, setStaffNotify] = useState(true);
  // Quitar la inscripción de otro miembro es destructivo: pide confirmación.
  const [staffConfirmRemove, setStaffConfirmRemove] = useState(false);
  // Si ya elegí spec y estado muestro un resumen en vez del editor completo;
  // "Cambiar" vuelve a abrir el editor.
  const [editingSignup, setEditingSignup] = useState(false);
  const hasFullSignup = Boolean(
    mySignup?.status && mySignup?.wowClass && mySignup?.spec,
  );
  const showSignupSummary = hasFullSignup && !editingSignup;
  const signupDirty =
    status !== (mySignup?.status ?? "yes") ||
    role !== (mySignup?.role ?? "") ||
    wowClass !== (mySignup?.wowClass ?? "") ||
    spec !== (mySignup?.spec ?? "") ||
    character.trim() !== (mySignup?.character ?? "");

  const typeMeta =
    EVENT_TYPES.find((entry) => entry.key === event.type) ?? EVENT_TYPES[0];

  const counts = {
    bench: event.signups.filter((signup) => signup.status === "bench").length,
    late: event.signups.filter((signup) => signup.status === "late").length,
    no: event.signups.filter((signup) => signup.status === "no").length,
    yes: event.signups.filter((signup) => signup.status === "yes").length,
  };

  const paused = event.paused === true;
  const signupsClosed =
    paused ||
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

  // Clases presentes en el rol que se está explorando (con sus specs).
  const catalogClasses = useMemo(() => {
    const rows = specs.filter((entry) => entry.role === catalogRole);
    const classes = new Map<string, RaidSpec[]>();
    for (const row of rows) {
      const list = classes.get(row.className) ?? [];
      list.push(row);
      classes.set(row.className, list);
    }
    return [...classes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogRole, specs]);

  // Spec actualmente elegido en el formulario (para mostrar su emoji).
  const currentSpecRow = specs.find(
    (row) =>
      row.role === role &&
      row.className === wowClass &&
      row.specName === (spec ?? ""),
  );

  function chooseSpec(row: RaidSpec): void {
    setRole(row.role);
    setWowClass(row.className);
    setSpec(row.specName);
    setCatalogRole(row.role);
  }

  const submit = async (): Promise<void> => {
    // El evento pide personaje: no se guarda la inscripción sin él (ni en
    // Discord ni acá).
    if (characterEnabled && !character.trim()) {
      setSignupError("Falta el nombre de personaje.");
      return;
    }
    setSignupError(null);
    setSubmitting(true);
    try {
      await onSignup(event.id, {
        character: character.trim(),
        role: role || undefined,
        spec: spec || undefined,
        status,
        wowClass: wowClass || undefined,
      });
      // Si ya quedó completa, volvemos al resumen (no al editor abierto).
      setEditingSignup(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Columnas del roster: los roles configurados, más cualquier rol que
  // aparezca en las inscripciones y no esté en la config (el "dps" viejo, un
  // rol que se borró) y los que se anotaron sin elegir rol. Sin ese último
  // grupo, quien se anota con un botón rápido queda contado en "Asistencia"
  // pero invisible en el roster.
  const rosterColumns = useMemo(() => {
    const confirmed = event.signups.filter((signup) => signup.status === "yes");
    const knownKeys = new Set(eventRoles.map((role) => role.key));
    const extraKeys = [
      ...new Set(
        confirmed
          .map((signup) => signup.role?.trim() ?? "")
          .filter((key) => key === "" || !knownKeys.has(key)),
      ),
    ];
    return [
      ...eventRoles.map((role) => ({
        key: role.key,
        label: role.label,
        role: role.key,
      })),
      ...extraKeys.map((key) => ({
        key: key === "" ? "sin-rol" : key,
        label: key ? (eventRoleMeta(key, eventRoles)?.label ?? key) : "Sin rol",
        role: key,
      })),
    ];
  }, [event.signups, eventRoles]);

  // Render de un miembro del roster: emoji de la spec (si tiene uno
  // configurado) + nick y personaje. El staff además ve el botón para editar
  // esa inscripción a mano.
  const renderRosterEntry = (signup: EventSignup) => {
    const specRow = specs.find(
      (row) =>
        row.role === signup.role &&
        row.className === signup.wowClass &&
        row.specName === (signup.spec ?? ""),
    );
    return (
      <span className="event-roster-entry" key={signup.id}>
        <span className="event-roster-member">
          <DiscordEmojiImage
            animated={specRow?.animated}
            emojiId={specRow?.emojiId}
            name={specRow?.specName}
          />
          {signup.username}
          {signup.character ? ` (${signup.character})` : ""}
        </span>
        {canManage ? (
          <button
            className="event-roster-edit"
            onClick={() => {
              setStaffConfirmRemove(false);
              setStaffNotify(true);
              setStaffEdit({
                character: signup.character ?? "",
                role: signup.role ?? "",
                spec: signup.spec ?? "",
                status: signup.status,
                userId: signup.userId,
                username: signup.username,
                wowClass: signup.wowClass ?? "",
              });
            }}
            title={`Editar la inscripción de ${signup.username}`}
            type="button"
          >
            ✏️
          </button>
        ) : null}
      </span>
    );
  };

  // Opciones del editor del staff: clases y specs del rol elegido.
  const staffRoleSpecs = staffEdit
    ? specs.filter((row) => row.role === staffEdit.role)
    : [];
  const staffClasses = [
    ...new Set(staffRoleSpecs.map((row) => row.className)),
  ].sort((a, b) => a.localeCompare(b));

  const saveStaffEdit = async (): Promise<void> => {
    if (!staffEdit) {
      return;
    }
    setStaffSaving(true);
    try {
      await onStaffSignup(event.id, staffEdit.userId, {
        character: characterEnabled ? staffEdit.character.trim() : undefined,
        notify: staffNotify,
        role: staffEdit.role || undefined,
        spec: staffEdit.spec || undefined,
        status: staffEdit.status,
        wowClass: staffEdit.wowClass || undefined,
      });
      setStaffEdit(null);
    } finally {
      setStaffSaving(false);
    }
  };

  const removeStaffSignup = async (): Promise<void> => {
    if (!staffEdit) {
      return;
    }
    setStaffSaving(true);
    try {
      await onStaffRemoveSignup(
        event.id,
        staffEdit.userId,
        staffEdit.username,
        staffNotify,
      );
      setStaffConfirmRemove(false);
      setStaffEdit(null);
    } finally {
      setStaffSaving(false);
    }
  };

  return (
    <>
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
              {paused ? (
                <span className="event-card-status paused">⏸️ Pausado</span>
              ) : null}
              {event.status !== "scheduled" ? (
                <span className={`event-card-status ${event.status}`}>
                  {event.status === "cancelled" ? "Cancelado" : "Completado"}
                </span>
              ) : null}
              {event.signupDeadline && signupsClosed && !paused ? (
                <span className="event-card-status closed">🔒 Cerradas</span>
              ) : null}
              {(event.tags ?? []).map((tag) => (
                <ComunicadoTag
                  color={tag.color}
                  key={tag.label}
                  label={tag.label}
                />
              ))}
            </div>
          </div>
          {/* Misma info que el aviso de Discord (mismos emojis y etiquetas),
            para que la web y el canal cuenten lo mismo. */}
          <div className="event-info-grid">
            <div className="event-info-item">
              <span className="event-info-label">🕒 Empieza</span>
              <span className="event-info-value">
                {formatDateTime24(event.startsAt)}
              </span>
            </div>
            <div className="event-info-item">
              <span className="event-info-label">⏱️ Duración</span>
              <span className="event-info-value">
                {event.durationMinutes
                  ? `${event.durationMinutes} min${endAt ? ` (termina ${formatTime24(endAt)})` : ""}`
                  : "—"}
              </span>
            </div>{" "}
            <div className="event-info-item">
              <span className="event-info-label">
                ⏳ Cierre de inscripciones
              </span>
              <span
                className={`event-info-value${signupsClosed && event.signupDeadline ? " closed" : ""}`}
              >
                {event.signupDeadline
                  ? `${formatDateTime24(event.signupDeadline)}${
                      signupsClosed ? " · ya cerró" : ""
                    }`
                  : "—"}
              </span>
            </div>
            {event.recurrenceEnabled && event.recurrenceEveryDays ? (
              <div className="event-info-item">
                <span className="event-info-label">🔁 Repetición</span>
                <span className="event-info-value">
                  {`Cada ${event.recurrenceEveryDays} días`}
                </span>
              </div>
            ) : recurrenceLabel(event.discordEventConfig?.recurrence) ? (
              <div className="event-info-item">
                <span className="event-info-label">🔁 Repetición</span>
                <span className="event-info-value">
                  {recurrenceLabel(event.discordEventConfig?.recurrence)}
                </span>
              </div>
            ) : null}
            {event.discordEventConfig?.entityType === "external" &&
            event.discordEventConfig.location ? (
              <div className="event-info-item">
                <span className="event-info-label">📍 Ubicación</span>
                <span className="event-info-value">
                  {event.discordEventConfig.location}
                </span>
              </div>
            ) : null}
            {event.requiredRoleId ? (
              <div className="event-info-item wide">
                <span className="event-info-label">👥 Roster principal</span>
                <span className="event-info-value">
                  Requiere{" "}
                  <strong>
                    {event.requiredRoleName ??
                      guildRoles.find(
                        (role) => role.id === event.requiredRoleId,
                      )?.name ??
                      "el rol mínimo"}
                  </strong>
                  <em className="event-info-note">
                    Sin el rol, la inscripción queda como Bench.
                  </em>
                </span>
              </div>
            ) : null}
            {event.discordEventId ||
            (event.discordMessageIds?.length ?? 0) > 0 ? (
              <div className="event-info-item wide">
                <span className="event-info-label">📣 Discord</span>
                <span className="event-info-value">
                  {event.discordEventId ? (
                    <a
                      className="raid-log-link"
                      href={`https://discord.com/events/${event.guildId}/${event.discordEventId}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Ver evento en Discord
                    </a>
                  ) : (
                    <span className="muted-text">Aviso publicado</span>
                  )}
                </span>
              </div>
            ) : null}
          </div>
          {paused ? (
            <div className="event-deadline paused">⏸️ Evento pausado</div>
          ) : null}
          {event.description?.trim() ? (
            <p className="event-card-desc">{event.description.trim()}</p>
          ) : null}
          <div className="event-card-assistance">
            <span className="event-info-label">📊 Asistencia</span>
            <div className="event-card-counts">
              <span className="event-count total">
                👥 {counts.yes}
                {counts.bench + counts.late > 0
                  ? ` (+${counts.bench + counts.late})`
                  : ""}
              </span>
              {SIGNUP_OPTIONS.map((option) => (
                <span className={`event-count ${option.key}`} key={option.key}>
                  {option.emoji} {counts[option.key]}
                </span>
              ))}
            </div>
          </div>

          {event.signups.length > 0 ? (
            <div className="event-roster">
              {/* Columnas por rol (estilo Raid Helper): cada rol es una columna
                con sus confirmados (nombre, personaje y clase/spec). */}
              <div className="event-roster-columns">
                {rosterColumns.map((entry) => {
                  const roleSignups = event.signups.filter(
                    (signup) =>
                      signup.status === "yes" &&
                      (signup.role?.trim() ?? "") === entry.role,
                  );
                  if (roleSignups.length === 0) {
                    return null;
                  }
                  return (
                    <div className="event-roster-column" key={entry.key}>
                      <span className="event-roster-role">
                        <EventRoleEmoji
                          role={entry.role || "sin-rol"}
                          roles={eventRoles}
                        />{" "}
                        {entry.label} ({roleSignups.length})
                      </span>
                      <div className="event-roster-members">
                        {roleSignups.map((signup) => renderRosterEntry(signup))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Grupos por estado (uno por fila, debajo del roster): tarde,
                bench y al final los que no asisten. */}
              <div className="event-roster-statuses">
                {(
                  [
                    ["late", "⏰", "Llegan tarde"],
                    ["bench", "🪑", "Bench"],
                    ["no", "❌", "No asisten"],
                  ] as const
                ).map(([statusKey, emoji, label]) => {
                  const members = event.signups.filter(
                    (signup) => signup.status === statusKey,
                  );
                  if (members.length === 0) {
                    return null;
                  }
                  return (
                    <div className="event-roster-group" key={statusKey}>
                      <span className="event-roster-role">
                        {emoji} {label} ({members.length})
                      </span>
                      <span className="event-roster-group-members">
                        {members.map((signup) => renderRosterEntry(signup))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="event-roster-empty">Sin inscripciones todavía.</div>
          )}

          {meId ? (
            <div className="event-signup">
              {signupsClosed ? (
                <div className="event-signup-closed">
                  {paused
                    ? "⏸️ El evento está pausado."
                    : "🔒 Las inscripciones están cerradas."}
                  {mySignup ? " Tu inscripción actual queda guardada." : ""}
                </div>
              ) : (
                <>
                  {showSignupSummary ? (
                    <div className="event-signup-summary">
                      <div className="event-signup-summary-row">
                        <span className="event-signup-summary-status">
                          {SIGNUP_OPTIONS.find(
                            (option) => option.key === mySignup?.status,
                          )?.emoji ?? "❔"}{" "}
                          {SIGNUP_OPTIONS.find(
                            (option) => option.key === mySignup?.status,
                          )?.label ?? mySignup?.status}
                        </span>
                      </div>
                      {mySignup?.character ? (
                        <div className="event-signup-summary-line">
                          Personaje: {mySignup.character}
                        </div>
                      ) : null}
                      <div className="event-signup-actions">
                        <button
                          className="primary-button"
                          onClick={() => setEditingSignup(true)}
                          type="button"
                        >
                          Cambiar
                        </button>
                        <button
                          className="danger-button"
                          onClick={() => void onRemoveSignup(event.id)}
                          type="button"
                        >
                          Quitar inscripción
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="event-signup-status">
                        {SIGNUP_OPTIONS.map((option) => (
                          <button
                            className={`event-status-btn ${option.key}${status === option.key ? " active" : ""}`}
                            key={option.key}
                            onClick={() => setStatus(option.key)}
                            title={option.label}
                            type="button"
                          >
                            {option.emoji}
                          </button>
                        ))}
                      </div>
                      <div className="event-signup-picker">
                        <div className="event-signup-role-row">
                          {eventRoles.map((entry) => (
                            <button
                              className={`event-status-btn role${catalogRole === entry.key ? " active" : ""}`}
                              key={entry.key}
                              onClick={() => setCatalogRole(entry.key)}
                              title={entry.label}
                              type="button"
                            >
                              <EventRoleEmoji
                                role={entry.key}
                                roles={eventRoles}
                              />
                            </button>
                          ))}
                        </div>
                        {specs.length === 0 ? (
                          <div className="event-signup-no-catalog">
                            El staff todavía no configuró los roles de evento
                            (Admin → Configuración de eventos).
                          </div>
                        ) : catalogClasses.length === 0 ? (
                          <div className="event-signup-no-catalog">
                            Todavía no hay clases cargadas para ese rol.
                          </div>
                        ) : (
                          <div className="event-signup-specs">
                            {catalogClasses.map(([className, rows]) => (
                              <div
                                className="event-signup-class"
                                key={className}
                              >
                                <span className="event-signup-class-name">
                                  {className}
                                </span>
                                <div className="event-signup-spec-row">
                                  {rows.map((row) => {
                                    const selected =
                                      role === row.role &&
                                      wowClass === row.className &&
                                      spec === row.specName;
                                    return (
                                      <button
                                        className={`event-signup-spec${selected ? " active" : ""}`}
                                        key={row.id}
                                        onClick={() => chooseSpec(row)}
                                        title={`${row.specName} — ${row.className} (${roleLabelFor(row.role)})`}
                                        type="button"
                                      >
                                        <DiscordEmojiImage
                                          animated={row.animated}
                                          emojiId={row.emojiId}
                                          name={row.specName}
                                          size={24}
                                        />
                                        <span>{row.specName}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {role && wowClass && spec ? (
                          <div className="event-signup-selected">
                            <DiscordEmojiImage
                              animated={currentSpecRow?.animated}
                              emojiId={currentSpecRow?.emojiId}
                              fallback={classEmoji(wowClass)}
                              name={currentSpecRow?.specName}
                            />
                            <span>
                              {roleLabelFor(role)} · {wowClass}
                              {spec ? ` · ${spec}` : ""}
                            </span>
                            <button
                              className="ghost-button small"
                              onClick={() => {
                                setRole("");
                                setWowClass("");
                                setSpec("");
                              }}
                              type="button"
                            >
                              Quitar
                            </button>
                          </div>
                        ) : null}
                        {characterEnabled ? (
                          <input
                            className="input"
                            value={character}
                            onChange={(event) =>
                              setCharacter(event.target.value)
                            }
                            maxLength={40}
                            placeholder="Nombre de tu personaje"
                          />
                        ) : null}
                        {signupError ? (
                          <span className="event-signup-error">
                            ⚠️ {signupError}
                          </span>
                        ) : null}
                      </div>
                      <div className="event-signup-actions">
                        <button
                          className="primary-button"
                          onClick={() => void submit()}
                          disabled={
                            submitting || (Boolean(mySignup) && !signupDirty)
                          }
                          type="button"
                        >
                          {submitting ? "Guardando…" : "Guardar inscripción"}
                        </button>
                        {mySignup ? (
                          <>
                            {hasFullSignup ? (
                              <button
                                className="ghost-button"
                                onClick={() => setEditingSignup(false)}
                                type="button"
                              >
                                Cancelar
                              </button>
                            ) : null}
                            <button
                              className="ghost-button"
                              onClick={() => void onResetSignup(event.id)}
                              title="Borra tu inscripción y el personaje recordado"
                              type="button"
                            >
                              🔄 Resetear registro
                            </button>
                            <button
                              className="danger-button"
                              onClick={() => void onRemoveSignup(event.id)}
                              type="button"
                            >
                              Quitar inscripción
                            </button>
                          </>
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          ) : null}

          {canManage ? (
            <div className="event-card-actions">
              <button
                className="primary-button"
                onClick={() => onEdit(event)}
                type="button"
              >
                Editar
              </button>
              <button
                className="primary-button"
                onClick={() => onDuplicate(event)}
                type="button"
              >
                Duplicar
              </button>
              {event.recurrenceEnabled ? (
                <button
                  className="primary-button"
                  onClick={() => onResetOccurrence(event)}
                  type="button"
                >
                  Limpiar ocurrencia
                </button>
              ) : null}
              <button
                className="danger-button"
                onClick={() => onDelete(event)}
                type="button"
              >
                Eliminar evento
              </button>
            </div>
          ) : null}
        </div>
      </article>

      {/* Edición manual del staff: corrige la inscripción de cualquier miembro
          (estado, rol, clase/spec y personaje). El botón ✏️ de cada nombre del
          roster abre este modal. */}
      {staffEdit ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setStaffConfirmRemove(false);
            setStaffEdit(null);
          }}
        >
          <div
            className="modal modal-wide"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4>Editar la inscripción de {staffEdit.username}</h4>

            <div className="staff-edit-row">
              <span className="staff-edit-label">Estado</span>
              <div className="event-signup-status">
                {SIGNUP_OPTIONS.map((option) => (
                  <button
                    className={`event-status-btn ${option.key}${staffEdit.status === option.key ? " active" : ""}`}
                    key={option.key}
                    onClick={() =>
                      setStaffEdit((current) =>
                        current ? { ...current, status: option.key } : current,
                      )
                    }
                    title={option.label}
                    type="button"
                  >
                    {option.emoji} {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="staff-edit-row">
              <span className="staff-edit-label">Rol</span>
              <div className="event-signup-role-row">
                {eventRoles.map((entry) => (
                  <button
                    className={`event-status-btn role${staffEdit.role === entry.key ? " active" : ""}`}
                    key={entry.key}
                    onClick={() =>
                      setStaffEdit((current) =>
                        current
                          ? {
                              ...current,
                              role: entry.key,
                              spec: "",
                              wowClass: "",
                            }
                          : current,
                      )
                    }
                    type="button"
                  >
                    <EventRoleEmoji role={entry.key} roles={eventRoles} />{" "}
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="staff-edit-row">
              <span className="staff-edit-label">Clase y spec</span>
              {staffRoleSpecs.length === 0 ? (
                <span className="muted-text">
                  Ese rol no tiene clases cargadas en el catálogo.
                </span>
              ) : (
                <div className="event-signup-specs">
                  {staffClasses.map((className) => (
                    <div className="event-signup-class" key={className}>
                      <span className="event-signup-class-name">
                        {className}
                      </span>
                      <div className="event-signup-spec-row">
                        {staffRoleSpecs
                          .filter((row) => row.className === className)
                          .map((row) => {
                            const selected =
                              staffEdit.wowClass === row.className &&
                              staffEdit.spec === row.specName;
                            return (
                              <button
                                className={`event-signup-spec${selected ? " active" : ""}`}
                                key={row.id}
                                onClick={() =>
                                  setStaffEdit((current) =>
                                    current
                                      ? {
                                          ...current,
                                          role: row.role,
                                          spec: row.specName,
                                          wowClass: row.className,
                                        }
                                      : current,
                                  )
                                }
                                type="button"
                              >
                                <DiscordEmojiImage
                                  animated={row.animated}
                                  emojiId={row.emojiId}
                                  name={row.specName}
                                  size={24}
                                />
                                <span>{row.specName}</span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {characterEnabled ? (
              <div className="staff-edit-row">
                <span className="staff-edit-label">Personaje</span>
                <input
                  className="input"
                  value={staffEdit.character}
                  onChange={(event) =>
                    setStaffEdit((current) =>
                      current
                        ? { ...current, character: event.target.value }
                        : current,
                    )
                  }
                  maxLength={40}
                  placeholder="Nombre del personaje"
                />
              </div>
            ) : null}

            <label className={`module-toggle${staffNotify ? " checked" : ""}`}>
              <span className="module-toggle-text">
                <strong>🔔 Avisarle por mensaje directo</strong>
              </span>
              <span className="module-switch">
                <input
                  type="checkbox"
                  checked={staffNotify}
                  onChange={() => setStaffNotify((current) => !current)}
                />
                <span className="module-switch-track" aria-hidden="true">
                  <span className="module-switch-thumb" />
                </span>
              </span>
            </label>

            <div className="event-signup-actions">
              <button
                className="primary-button"
                disabled={staffSaving}
                onClick={() => void saveStaffEdit()}
                type="button"
              >
                {staffSaving ? "Guardando…" : "Guardar"}
              </button>
              {staffConfirmRemove ? (
                <>
                  <span className="staff-edit-confirm">
                    ¿Quitar la inscripción de {staffEdit.username}?
                    {staffNotify ? " Se le avisa por MD." : ""}
                  </span>
                  <button
                    className="danger-button"
                    disabled={staffSaving}
                    onClick={() => void removeStaffSignup()}
                    type="button"
                  >
                    Sí, quitar
                  </button>
                  <button
                    className="ghost-button"
                    disabled={staffSaving}
                    onClick={() => setStaffConfirmRemove(false)}
                    type="button"
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  className="danger-button"
                  disabled={staffSaving}
                  onClick={() => setStaffConfirmRemove(true)}
                  type="button"
                >
                  Quitar inscripción
                </button>
              )}
              <button
                className="ghost-button"
                disabled={staffSaving}
                onClick={() => {
                  setStaffConfirmRemove(false);
                  setStaffEdit(null);
                }}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
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
    // La cabecera de Eventos es propia (título + botón nuevo evento); no
    // queremos descripción genérica.
    return "";
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
                  Desde {formatDate24(booster.premiumSince)}
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
  const [savingPermission, setSavingPermission] = useState(false);
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
  const [scanningRaidLogs, setScanningRaidLogs] = useState(false);
  const [raidLogsLoading, setRaidLogsLoading] = useState(false);
  const [raidLogUrl, setRaidLogUrl] = useState("");
  const [hiddenRaidLogs, setHiddenRaidLogs] = useState<RaidLog[]>([]);
  const [karutaCards, setKarutaCards] = useState<KarutaCard[]>([]);
  const [karutaAlbums, setKarutaAlbums] = useState<KarutaAlbum[]>([]);
  const [karutaLoading, setKarutaLoading] = useState(false);
  const [karutaSection, setKarutaSection] = useState<KarutaSection>(
    () => parseLocationHash().karutaSection,
  );
  const [comunicadoSlug, setComunicadoSlug] = useState<string | null>(
    () => parseLocationHash().comunicadoSlug,
  );
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventTagFilter, setEventTagFilter] = useState<string[]>([]);
  // Filtros y buscadores de las listas (mismo mecanismo en todas).
  const [eventSearch, setEventSearch] = useState("");
  const [eventOrder, setEventOrder] = useState<ListOrder>("newest");
  const [comunicadoSearch, setComunicadoSearch] = useState("");
  const [comunicadoOrder, setComunicadoOrder] = useState<ListOrder>("newest");
  const [comunicadoTagFilter, setComunicadoTagFilter] = useState<string[]>([]);
  const [raidLogSearch, setRaidLogSearch] = useState("");
  const [raidLogOrder, setRaidLogOrder] = useState<ListOrder>("newest");
  const [karutaSearch, setKarutaSearch] = useState("");
  const [karutaRarity, setKarutaRarity] = useState<KarutaRarityFilter>("all");

  // Cuántas cartas hay de cada rareza (para los chips del filtro). Se calcula
  // con la misma función que dibuja cada tarjeta, así nunca se desincroniza.
  const karutaRarityCounts = useMemo(() => {
    const counts: Record<"normal" | "super" | "ultra", number> = {
      normal: 0,
      super: 0,
      ultra: 0,
    };
    for (const card of karutaCards) {
      counts[karutaCardTier(card, config) ?? "normal"] += 1;
    }
    return counts;
  }, [config, karutaCards]);

  // Cartas visibles: filtro por rareza + buscador por nombre y serie.
  const visibleKarutaCards = useMemo(() => {
    return karutaCards.filter((card) => {
      const tier = karutaCardTier(card, config) ?? "normal";
      if (karutaRarity !== "all" && tier !== karutaRarity) {
        return false;
      }
      return matchesSearch(
        `${card.cardName ?? ""} ${card.series ?? ""}`,
        karutaSearch,
      );
    });
  }, [config, karutaCards, karutaRarity, karutaSearch]);

  // Logs de raid visibles: buscador (título o código) + orden. Se filtra antes
  // de agrupar, así las partes de una misma noche siguen viajando juntas.
  const visibleRaidLogs = useMemo(() => {
    const filtered = raidLogs.filter((log) =>
      matchesSearch(`${log.title ?? ""} ${log.reportCode}`, raidLogSearch),
    );
    return sortByOrder(
      filtered,
      raidLogOrder,
      (log) => log.firstFightAt ?? log.createdAt,
      (log) => log.title ?? log.reportCode,
    );
  }, [raidLogOrder, raidLogSearch, raidLogs]);

  // Etiquetas usadas en la guild: alimentan el filtro y las sugerencias.
  const eventTagOptions = useMemo(() => {
    const byLabel = new Map<string, EventTag>();
    for (const event of events) {
      for (const tag of event.tags ?? []) {
        const key = tag.label.toLowerCase();
        if (!byLabel.has(key)) {
          byLabel.set(key, tag);
        }
      }
    }
    return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [events]);
  const untaggedEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.status !== "completed" && (event.tags?.length ?? 0) === 0,
      ).length,
    [events],
  );
  const filteredEvents = useMemo(() => {
    // Los completados viven en Admin → Historial de eventos (con su roster):
    // la grilla es solo lo activo/próximo.
    const active = events.filter((event) => event.status !== "completed");
    const byTag =
      eventTagFilter.length === 0
        ? active
        : active.filter((event) => {
            const tags = event.tags ?? [];
            if (tags.length === 0) {
              return eventTagFilter.includes(EVENT_TAG_NONE);
            }
            return tags.some((tag) =>
              eventTagFilter.includes(tag.label.toLowerCase()),
            );
          });
    const searched = byTag.filter((event) =>
      matchesSearch(
        `${event.title} ${event.description ?? ""} ${(event.tags ?? [])
          .map((tag) => tag.label)
          .join(" ")}`,
        eventSearch,
      ),
    );
    return sortByOrder(
      searched,
      eventOrder,
      (event) => event.startsAt,
      (event) => event.title,
    );
  }, [eventOrder, eventSearch, eventTagFilter, events]);
  // Etiquetas del filtro: solo de los eventos activos (los del historial ya no
  // se pueden filtrar desde acá).
  const activeTagOptions = useMemo(() => {
    const byLabel = new Map<string, EventTag>();
    for (const event of events) {
      if (event.status === "completed") {
        continue;
      }
      for (const tag of event.tags ?? []) {
        const key = tag.label.toLowerCase();
        if (!byLabel.has(key)) {
          byLabel.set(key, tag);
        }
      }
    }
    return [...byLabel.values()];
  }, [events]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  // Indica que el form abrió en modo "duplicar" (para el título del form).
  const [duplicatingEvent, setDuplicatingEvent] = useState(false);
  const [eventForm, setEventForm] = useState<{
    characterEnabled: boolean;
    discord: {
      createScheduledEvent: boolean;
      entityType: "voice" | "external";
      location: string;
      publishChannelId: string;
      publishMessage: boolean;
      recurrence: "none" | "daily" | "weekly" | "biweekly";
      voiceChannelId: string;
    };
    discordCleanupOnComplete: boolean;
    durationMinutes: string;
    // Juego del evento (clave de la lista de juegos).
    game: string;
    imageUrl: string;
    paused: boolean;
    recurrenceEnabled: boolean;
    recurrenceEveryDays: string;
    recurrencePublishDaysBefore: string;
    reminderHours: number[];
    requiredRoleId: string;
    signupDeadline: string;
    startsAt: string;
    status: string;
    tags: EventTag[];
    title: string;
    type: string;
  }>({
    characterEnabled: true,
    discord: defaultEventDiscord(),
    discordCleanupOnComplete: false,
    durationMinutes: "",
    game: "",
    imageUrl: "",
    paused: false,
    recurrenceEnabled: false,
    recurrenceEveryDays: "",
    recurrencePublishDaysBefore: "3",
    reminderHours: [],
    requiredRoleId: "",
    signupDeadline: "",
    startsAt: "",
    status: "scheduled",
    tags: [],
    title: "",
    type: "raid",
  });
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventImages, setEventImages] = useState<EventImage[]>([]);
  const [eventImagesLoading, setEventImagesLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Juegos del módulo de eventos (WoW, LoL, …): cada uno trae sus roles de
  // inscripción. El evento elige juego y de ahí salen sus roles + catálogo.
  const [eventGames, setEventGames] = useState<EventGameOption[]>([]);
  // Catálogo de specs de inscripción (estilo Raid Helper) + editor.
  const [eventSpecs, setEventSpecs] = useState<RaidSpec[]>([]);
  const [eventSpecsLoading, setEventSpecsLoading] = useState(false);
  const [showSpecEditor, setShowSpecEditor] = useState(false);
  // Tipo de evento que se está editando en "Configuración de eventos"
  // (roles + catálogo). Las claves internas son las de las plantillas
  // (wow/lol/…) o las que configure la guild.
  const [adminGameKey, setAdminGameKey] = useState("");
  const [guildEmojis, setGuildEmojis] = useState<GuildEmoji[]>([]);
  const [guildEmojisLoading, setGuildEmojisLoading] = useState(false);
  const [specDraft, setSpecDraft] = useState<{
    animated?: boolean;
    className: string;
    emojiId?: string;
    emojiName?: string;
    // Juego al que pertenece la fila que se está editando.
    game?: string;
    id?: string;
    role: string;
    specName: string;
  }>({ className: "", role: "", specName: "" });
  const [savingAction, setSavingAction] = useState<
    | "config"
    | "xp"
    | "panel"
    | "daily"
    | "eventRoles"
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

  // Etiquetas usadas en los comunicados publicados (alimentan el filtro).
  const publishedTagOptions = useMemo(() => {
    const byLabel = new Map<string, { color?: string; label: string }>();
    for (const comm of published) {
      const label = comm.tagLabel?.trim();
      if (label && !byLabel.has(label.toLowerCase())) {
        byLabel.set(label.toLowerCase(), { color: comm.tagColor, label });
      }
    }
    return [...byLabel.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "es"),
    );
  }, [published]);

  // Comunicados visibles: filtro por etiqueta + buscador + orden.
  const visiblePublished = useMemo(() => {
    const filtered = published.filter((comm) => {
      const label = comm.tagLabel?.trim().toLowerCase() ?? "";
      if (comunicadoTagFilter.length > 0) {
        if (label === "") {
          if (!comunicadoTagFilter.includes(EVENT_TAG_NONE)) {
            return false;
          }
        } else if (!comunicadoTagFilter.includes(label)) {
          return false;
        }
      }
      return matchesSearch(`${comm.title} ${comm.content}`, comunicadoSearch);
    });
    return sortByOrder(
      filtered,
      comunicadoOrder,
      (comm) => comm.publishedAt,
      (comm) => comm.title,
    );
  }, [comunicadoOrder, comunicadoSearch, comunicadoTagFilter, published]);
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
    tagColor?: string;
    tagLabel?: string;
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

  // Roles asignados a cada rango, para la vista por jerarquía. Los que tienen
  // permisos sueltos (no el rango completo) van a "custom": así el resumen no
  // esconde a nadie que sí tenga acceso al panel.
  const staffByTier: Record<"admin" | "officer" | "custom", GuildRole[]> = {
    admin: [],
    officer: [],
    custom: [],
  };
  for (const role of guildRoles) {
    const rule = (config.adminRoleModules ?? []).find(
      (entry) => entry.roleId === role.id,
    );
    const modules = rule?.modules ?? [];
    if (modules.length === 0) {
      continue;
    }
    staffByTier[tierForModules(modules) ?? "custom"].push(role);
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
      setKarutaCards([]);
      setKarutaAlbums([]);
      setKarutaLoading(false);
      return;
    }
    let cancelled = false;

    const refreshKaruta = (): Promise<void> => {
      return Promise.allSettled([
        getKarutaCards(selectedGuildId),
        getKarutaAlbums(selectedGuildId),
      ]).then(([cards, albums]) => {
        if (cancelled) {
          return;
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
    const adminEvents = activeTab === "admin" && canAccess("eventos");
    if (!selectedGuildId || (activeTab !== "eventos" && !adminEvents)) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedGuildId]);

  // El catálogo de roles/specs se carga donde se usa: en la tab Eventos
  // (selector de inscripción y roster) o en Admin → Configuración de eventos.
  useEffect(() => {
    const adminOpen =
      activeTab === "admin" && showSpecEditor && canAccess("config");
    if (!selectedGuildId || (activeTab !== "eventos" && !adminOpen)) {
      setEventSpecs([]);
      setEventSpecsLoading(false);
      return;
    }
    let cancelled = false;
    setEventSpecsLoading(true);
    getEventSpecs(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setEventSpecs(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setEventSpecsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId, showSpecEditor]);

  // Tipos de evento (roles de cada uno): los usa el selector del formulario de
  // evento, el roster y el editor del panel.
  useEffect(() => {
    const adminOpen =
      activeTab === "admin" && showSpecEditor && canAccess("config");
    if (!selectedGuildId || (activeTab !== "eventos" && !adminOpen)) {
      return;
    }
    let cancelled = false;
    getEventGames(selectedGuildId)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setEventGames(list);
        // Juego que se edita en el panel: el primero disponible.
        setAdminGameKey((current) => current || (list[0]?.key ?? ""));
        // Un evento nuevo arranca con el primer juego (normalmente WoW).
        setEventForm((current) =>
          current.game ? current : { ...current, game: list[0]?.key ?? "" },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId, showSpecEditor]);

  // Canales de texto/voz para el editor de publicación en Discord de un
  // evento (solo staff). Se cargan la primera vez que se abre el form; el
  // panel Admin usa su propia carga de canales.
  useEffect(() => {
    if (
      !selectedGuildId ||
      activeTab !== "eventos" ||
      !showEventForm ||
      !canAccess("eventos")
    ) {
      return;
    }
    const missingVoice = voiceChannels.length === 0;
    const missingText = textChannels.length === 0;
    const missingRoles = guildRoles.length === 0;
    if (!missingVoice && !missingText && !missingRoles) {
      return;
    }
    let cancelled = false;
    // Roles de la guild para el campo "Rol mínimo" del evento.
    if (missingRoles) {
      getGuildRoles(selectedGuildId)
        .then((roles) => {
          if (!cancelled) {
            setGuildRoles(roles);
          }
        })
        .catch(() => {});
    }
    const fetches: Array<Promise<GuildChannel[]>> = [];
    if (missingVoice) {
      fetches.push(getGuildVoiceChannels(selectedGuildId));
    }
    if (missingText) {
      fetches.push(getGuildTextChannels(selectedGuildId));
    }
    Promise.all(fetches)
      .then((lists) => {
        if (cancelled) {
          return;
        }
        if (missingVoice && lists[0]) {
          setVoiceChannels(lists[0]);
        }
        if (missingText && lists[1]) {
          setTextChannels(lists[1]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGuildId, activeTab, showEventForm]);

  // Roles de la guild: si hay eventos con rol requerido, cargamos los roles
  // para poder mostrar el nombre del rol en la tarjeta (y no "un rol").
  useEffect(() => {
    if (
      activeTab !== "eventos" ||
      !selectedGuildId ||
      guildRoles.length > 0 ||
      !events.some((entry) => entry.requiredRoleId)
    ) {
      return;
    }
    let cancelled = false;
    getGuildRoles(selectedGuildId)
      .then((roles) => {
        if (!cancelled) {
          setGuildRoles(roles);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedGuildId, events, guildRoles.length]);

  // Emojis custom de la guild, solo cuando se abre el editor de catálogo.
  useEffect(() => {
    if (!selectedGuildId || !showSpecEditor) {
      return;
    }
    let cancelled = false;
    setGuildEmojisLoading(true);
    getGuildEmojis(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setGuildEmojis(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuildEmojis([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGuildEmojisLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGuildId, showSpecEditor]);

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
      spec?: string;
      status: string;
      wowClass?: string;
    },
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const signup = await upsertEventSignup(selectedGuildId, eventId, input);
      const list = await getEvents(selectedGuildId);
      setEvents(list);
      if (input.status === "yes" && signup.status === "bench") {
        pushToast(
          "Sin el rol requerido, la inscripción queda como Bench (fuera del roster principal).",
          "success",
        );
      } else {
        pushToast("Inscripción guardada.", "success");
      }
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la inscripción.",
        "error",
      );
    }
  }

  // El staff corrige la inscripción de OTRO miembro (estado, rol, clase/spec,
  // personaje): misma información que la inscripción propia, pero para
  // cualquiera y sin pasar por el "rol mínimo" automático.
  async function handleStaffEventSignup(
    eventId: string,
    userId: string,
    input: {
      character?: string;
      notify?: boolean;
      role?: string;
      spec?: string;
      status: string;
      wowClass?: string;
    },
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const result = await upsertMemberEventSignup(
        selectedGuildId,
        eventId,
        userId,
        input,
      );
      setEvents(await getEvents(selectedGuildId));
      pushToast(
        result.notified
          ? "Inscripción actualizada y avisada por MD."
          : "Inscripción actualizada.",
        "success",
      );
      if (input.notify && result.notifyError) {
        pushToast(`No se pudo avisar: ${result.notifyError}`, "error");
      }
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la inscripción.",
        "error",
      );
    }
  }

  async function handleStaffRemoveEventSignup(
    eventId: string,
    userId: string,
    username: string,
    notify: boolean,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const result = await deleteMemberEventSignup(
        selectedGuildId,
        eventId,
        userId,
        notify,
      );
      setEvents(await getEvents(selectedGuildId));
      pushToast(
        result.notified
          ? `Inscripción de ${username} quitada y avisada por MD.`
          : `Inscripción de ${username} quitada.`,
        "success",
      );
      if (notify && result.notifyError) {
        pushToast(`No se pudo avisar: ${result.notifyError}`, "error");
      }
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo quitar la inscripción.",
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

  // Resetear la inscripción: borra la inscripción y el personaje recordado,
  // así la próxima vez se anota desde cero.
  async function handleResetEventSignup(eventId: string): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await resetMyEventSignup(selectedGuildId, eventId);
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
      pushToast("Registro reseteado: se borró tu inscripción.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo resetear el registro.",
        "error",
      );
    }
  }

  // Guarda los roles del TIPO DE EVENTO que se está editando en el panel
  // (cada tipo tiene los suyos). Es config de admin/super admin.
  async function handleSaveEventRoleConfig(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    setSavingAction("eventRoles");
    try {
      // Mandamos todos los juegos materializados en la config, con las
      // etiquetas ya recortadas (así guardar un juego no borra los otros).
      const games: EventGameConfig[] = (config.eventGames ?? []).map(
        (game) => ({
          key: game.key,
          label: game.label,
          roles: game.roles.map((role) => ({
            ...role,
            label: role.label.trim() || role.key,
          })),
        }),
      );
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        eventGames: games,
      });
      setConfig(nextConfig);
      setEventGames(await getEventGames(selectedGuildId));
      pushToast("Roles del tipo de evento guardados.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "No se pudo guardar.",
        "error",
      );
    } finally {
      setSavingAction(null);
    }
  }

  // Agrega o edita una clase/spec (rol + emoji) del catálogo del tipo de
  // evento que se está editando.
  async function handleSaveEventSpec(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    if (!specDraft.className.trim() || !specDraft.specName.trim()) {
      pushToast("Faltan datos del catálogo.", "error");
      return;
    }
    const game = specDraft.game || adminGameKey;
    // Rol: si el draft todavía no eligió uno, va el primero del tipo (es el que
    // muestra el select).
    const role = specDraft.role || adminRoles[0]?.key || "";
    if (!role) {
      pushToast("Ese tipo de evento no tiene roles configurados.", "error");
      return;
    }
    const editing = Boolean(specDraft.id);
    try {
      if (editing) {
        await updateEventSpec(selectedGuildId, specDraft.id!, {
          animated: specDraft.animated,
          className: specDraft.className.trim(),
          emojiId: specDraft.emojiId ?? null,
          emojiName: specDraft.emojiName ?? null,
          game,
          role,
          specName: specDraft.specName.trim(),
        });
      } else {
        await createEventSpec(selectedGuildId, {
          animated: specDraft.animated,
          className: specDraft.className.trim(),
          emojiId: specDraft.emojiId,
          emojiName: specDraft.emojiName,
          game,
          role,
          specName: specDraft.specName.trim(),
        });
      }
      setEventSpecs(await getEventSpecs(selectedGuildId));
      setSpecDraft({ className: "", game, role, specName: "" });
      pushToast(
        editing ? "Cambios guardados." : "Clase/spec agregada.",
        "success",
      );
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "No se pudo guardar.",
        "error",
      );
    }
  }

  // Carga una clase/spec existente en el formulario para editarla.
  function handleEditEventSpec(spec: RaidSpec): void {
    setSpecDraft({
      animated: spec.animated,
      className: spec.className,
      emojiId: spec.emojiId,
      emojiName: spec.emojiName,
      game: spec.game,
      id: spec.id,
      role: spec.role,
      specName: spec.specName,
    });
  }

  function handleDeleteEventSpec(spec: RaidSpec): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Quitar de la configuración de eventos",
      message: `¿Quitar "${spec.specName}" (${spec.className}) de la configuración de eventos? Las inscripciones existentes conservan su texto pero pierden el emoji.`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteEventSpec(selectedGuildId, spec.id);
            setEventSpecs((current) =>
              current.filter((entry) => entry.id !== spec.id),
            );
            pushToast("Spec quitada del catálogo.", "success");
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo quitar la spec.",
              "error",
            );
          }
        })();
      },
    });
  }

  function handleDeleteEvent(event: HubEvent): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar evento",
      message: event.recurrenceEnabled
        ? `¿Eliminar "${event.title}" y todas sus inscripciones? Es el molde de una serie: si lo eliminás, no se crean más ocurrencias (las que ya existen quedan).`
        : `¿Eliminar "${event.title}" y todas sus inscripciones?`,
      onConfirm: () => {
        void (async () => {
          try {
            const result = await deleteEvent(selectedGuildId, event.id);
            // El API puede responder ok sin haber borrado nada (id que no es de
            // esta guild). Antes la lista lo sacaba igual y el evento
            // "volvía" al recargar, sin ningún aviso.
            if (!result.deleted) {
              pushToast("El servidor no borró el evento.", "error");
              setEvents(await getEvents(selectedGuildId));
              return;
            }
            setEvents((current) =>
              current.filter((entry) => entry.id !== event.id),
            );
            if (result.discordFailed?.length) {
              pushToast(
                `Evento eliminado, pero Discord no dejó borrar: ${result.discordFailed.join(" | ")}`,
                "error",
              );
            } else {
              pushToast("Evento eliminado.", "success");
            }
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

  // Limpia la ocurrencia de una serie: se va el rastro de esa fecha en Discord
  // (aviso, recordatorios y evento agendado) y sus inscripciones; el molde
  // queda con su config y la serie avanza a la próxima fecha.
  function handleResetOccurrence(event: HubEvent): void {
    if (!selectedGuildId) {
      return;
    }
    setConfirmDialog({
      kind: "danger",
      title: "Limpiar ocurrencia",
      message: `Se borra en Discord el aviso y los recordatorios de "${event.title}", su roster queda archivado en el historial y la serie avanza a su próxima fecha (el molde se conserva).`,
      onConfirm: () => {
        void (async () => {
          try {
            const result = await resetEventOccurrence(
              selectedGuildId,
              event.id,
            );
            setEvents(await getEvents(selectedGuildId));
            const fecha = formatDateTime24(result.event.startsAt);
            if (result.discordFailed?.length) {
              pushToast(
                `Ocurrencia limpiada y serie movida al ${fecha}, pero Discord no dejó borrar: ${result.discordFailed.join(" | ")}`,
                "error",
              );
            } else {
              pushToast(`Ocurrencia limpiada. Próxima: ${fecha}.`, "success");
            }
            if (result.discordError) {
              pushToast(
                `No se pudo publicar la próxima ocurrencia: ${result.discordError}`,
                "error",
              );
            }
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo limpiar la ocurrencia.",
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
    setDuplicatingEvent(false);
    setEventForm({
      characterEnabled: true,
      discord: defaultEventDiscord(),
      discordCleanupOnComplete: false,
      durationMinutes: "",
      // Arranca con el primer juego disponible (normalmente WoW).
      game: eventGames[0]?.key ?? "",
      imageUrl: "",
      paused: false,
      recurrenceEnabled: false,
      recurrenceEveryDays: "",
      recurrencePublishDaysBefore: "3",
      reminderHours: [],
      requiredRoleId: "",
      signupDeadline: "",
      startsAt: "",
      status: "scheduled",
      tags: [],
      title: "",
      type: "raid",
    });
  }

  function handleEditEvent(event: HubEvent): void {
    setEditingEventId(event.id);
    setDuplicatingEvent(false);
    setEventForm({
      characterEnabled: event.characterEnabled !== false,
      discord: {
        createScheduledEvent:
          event.discordEventConfig?.createScheduledEvent ??
          Boolean(event.discordEventId),
        entityType: event.discordEventConfig?.entityType ?? "voice",
        location: event.discordEventConfig?.location ?? "",
        publishChannelId: event.publishChannelId ?? "",
        publishMessage:
          event.discordEventConfig?.publishMessage ??
          (event.discordMessageIds?.length ?? 0) > 0,
        recurrence: event.discordEventConfig?.recurrence ?? "none",
        voiceChannelId: event.voiceChannelId ?? "",
      },
      discordCleanupOnComplete: event.discordCleanupOnComplete ?? false,
      durationMinutes:
        event.durationMinutes != null ? String(event.durationMinutes) : "",
      game: event.game ?? "",
      imageUrl: event.imageUrl ?? "",
      paused: event.paused ?? false,
      recurrenceEnabled: event.recurrenceEnabled ?? false,
      recurrenceEveryDays:
        event.recurrenceEveryDays != null
          ? String(event.recurrenceEveryDays)
          : "",
      recurrencePublishDaysBefore:
        event.recurrencePublishDaysBefore != null
          ? String(event.recurrencePublishDaysBefore)
          : "3",
      reminderHours: event.reminderHours ?? [],
      requiredRoleId: event.requiredRoleId ?? "",
      signupDeadline: event.signupDeadline
        ? toDateTimeLocal(event.signupDeadline)
        : "",
      startsAt: toDateTimeLocal(event.startsAt),
      status: event.status,
      tags: event.tags ?? [],
      title: event.title,
      type: event.type,
    });
    setShowEventForm(true);
  }

  // Duplica la configuración de un evento como uno NUEVO (sin inscripciones)
  // para "re-publicarlo": se abre el form en modo creación con los datos
  // copiados (fecha editable, inscripciones abiertas, mismo canal/imagen).
  function handleDuplicateEvent(event: HubEvent): void {
    setEditingEventId(null);
    setDuplicatingEvent(true);
    setEventForm({
      characterEnabled: event.characterEnabled !== false,
      discord: {
        createScheduledEvent:
          event.discordEventConfig?.createScheduledEvent ??
          Boolean(event.discordEventId),
        entityType: event.discordEventConfig?.entityType ?? "voice",
        location: event.discordEventConfig?.location ?? "",
        publishChannelId: event.publishChannelId ?? "",
        publishMessage:
          event.discordEventConfig?.publishMessage ??
          (event.discordMessageIds?.length ?? 0) > 0,
        // La recurrencia de Discord no se copia: cada corrida se arma aparte.
        recurrence: "none",
        voiceChannelId: event.voiceChannelId ?? "",
      },
      discordCleanupOnComplete: event.discordCleanupOnComplete ?? false,
      durationMinutes:
        event.durationMinutes != null ? String(event.durationMinutes) : "",
      game: event.game ?? "",
      imageUrl: event.imageUrl ?? "",
      // La copia no hereda pausa ni recurrencia (evita dos series andando).
      paused: false,
      recurrenceEnabled: false,
      recurrenceEveryDays: "",
      recurrencePublishDaysBefore: "3",
      reminderHours: event.reminderHours ?? [],
      requiredRoleId: event.requiredRoleId ?? "",
      signupDeadline: "",
      startsAt: toDateTimeLocal(event.startsAt),
      status: "scheduled",
      tags: event.tags ?? [],
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

  // Crea o actualiza un evento, sincronizándolo con Discord si se pidió
  // (scheduled event y/o aviso en canal). Si Discord falla se avisa, pero
  // el evento local queda guardado igual.
  async function handleSaveEvent(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    if (!eventForm.title.trim() || !eventForm.startsAt) {
      pushToast("Faltan título o fecha/hora.", "error");
      return;
    }
    // Fecha/hora y cierre viajan como instante absoluto (UTC): el form trabaja
    // en hora local y el API en UTC, así que mandamos el ISO de la conversión
    // para que la hora elegida sea la misma en los dos lados.
    const startsAtIso = toIsoInstant(eventForm.startsAt);
    if (!startsAtIso) {
      pushToast("La fecha/hora no es válida.", "error");
      return;
    }
    const signupDeadlineIso = toIsoInstant(eventForm.signupDeadline);

    const discordPayload: EventDiscordOptions = {
      createScheduledEvent: eventForm.discord.createScheduledEvent,
      entityType: eventForm.discord.entityType,
      location: eventForm.discord.location.trim() || undefined,
      publishChannelId: eventForm.discord.publishChannelId || undefined,
      publishMessage: eventForm.discord.publishMessage,
      recurrence: eventForm.discord.recurrence,
      voiceChannelId: eventForm.discord.voiceChannelId || undefined,
    };

    const notifyDiscordError = (discordError?: string): void => {
      if (discordError) {
        pushToast(`⚠️ Evento guardado, pero Discord: ${discordError}`, "error");
      }
    };

    setCreatingEvent(true);
    try {
      if (editingEventId) {
        const result = await updateEvent(selectedGuildId, editingEventId, {
          characterEnabled: eventForm.characterEnabled,
          discord: discordPayload,
          durationMinutes: eventForm.durationMinutes
            ? Number(eventForm.durationMinutes)
            : null,
          discordCleanupOnComplete: eventForm.discordCleanupOnComplete,
          game: eventForm.game || undefined,
          imageUrl: eventForm.imageUrl || undefined,
          paused: eventForm.paused,
          recurrenceEnabled: eventForm.recurrenceEnabled,
          recurrenceEveryDays: eventForm.recurrenceEnabled
            ? Number(eventForm.recurrenceEveryDays) || undefined
            : undefined,
          recurrencePublishDaysBefore: eventForm.recurrenceEnabled
            ? Number(eventForm.recurrencePublishDaysBefore) || undefined
            : undefined,
          reminderHours: [...eventForm.reminderHours],
          requiredRoleId: eventForm.requiredRoleId.trim() || undefined,
          signupDeadline: signupDeadlineIso ?? null,
          startsAt: startsAtIso,
          status: eventForm.status,
          tags: eventForm.tags,
          title: eventForm.title.trim(),
          type: eventForm.type,
        });
        setEvents((current) =>
          current
            .map((entry) =>
              entry.id === result.event.id ? result.event : entry,
            )
            .sort(
              (a, b) =>
                new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
            ),
        );
        pushToast("Evento actualizado.", "success");
        notifyDiscordError(result.discordError);
      } else {
        const result = await createEvent(selectedGuildId, {
          characterEnabled: eventForm.characterEnabled,
          discord: discordPayload,
          durationMinutes: eventForm.durationMinutes
            ? Number(eventForm.durationMinutes)
            : undefined,
          discordCleanupOnComplete: eventForm.discordCleanupOnComplete,
          game: eventForm.game || undefined,
          imageUrl: eventForm.imageUrl || undefined,
          recurrenceEnabled: eventForm.recurrenceEnabled,
          recurrenceEveryDays: eventForm.recurrenceEnabled
            ? Number(eventForm.recurrenceEveryDays) || undefined
            : undefined,
          recurrencePublishDaysBefore: eventForm.recurrenceEnabled
            ? Number(eventForm.recurrencePublishDaysBefore) || undefined
            : undefined,
          reminderHours: [...eventForm.reminderHours],
          requiredRoleId: eventForm.requiredRoleId.trim() || undefined,
          signupDeadline: signupDeadlineIso,
          startsAt: startsAtIso,
          tags: eventForm.tags,
          title: eventForm.title.trim(),
          type: eventForm.type,
        });
        setEvents((current) =>
          [...current, result.event].sort(
            (a, b) =>
              new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
          ),
        );
        pushToast("Evento creado.", "success");
        notifyDiscordError(result.discordError);
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
    ? (published.find((comm) => slugifyTitle(comm.title) === comunicadoSlug) ??
      null)
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
          tagColor: commEditor.tagColor ?? "",
          tagLabel: commEditor.tagLabel ?? "",
          title: commEditor.title,
          content: commEditor.content,
          channelId: commEditor.channelId,
        });
        pushToast("Plantilla actualizada.", "success");
      } else {
        await createCommunication(selectedGuildId, {
          ...commEditor,
          tagColor: commEditor.tagColor ?? "",
          tagLabel: commEditor.tagLabel ?? "",
        });
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
          tagColor: instanceEditor.tagColor ?? "",
          tagLabel: instanceEditor.tagLabel ?? "",
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
      // OJO: guardado parcial (el API fusiona con la config actual). Si un
      // campo del formulario no se manda acá, su valor editado se pierde y el
      // input vuelve al valor guardado.
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        karutaWatchEnabled: config.karutaWatchEnabled,
        karutaChannelId: config.karutaChannelId,
        karutaRarePrintMax: config.karutaRarePrintMax,
        karutaRareWishlistMin: config.karutaRareWishlistMin,
        karutaSuperRarePrintMax: config.karutaSuperRarePrintMax,
        karutaSuperRareWishlistMin: config.karutaSuperRareWishlistMin,
        karutaUltraRarePrintMax: config.karutaUltraRarePrintMax,
        karutaUltraRareWishlistMin: config.karutaUltraRareWishlistMin,
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
      // Arrancamos de la lista guardada, pero normalizada: el alias viejo
      // "muro" pasa a ser "karuta" y se descartan claves que ya no existen
      // como módulo (ej. "memes"), así la config no acumula basura.
      const known = new Set<string>(HUB_MODULES.map((mod) => mod.key));
      const base =
        current.enabledModules && current.enabledModules.length > 0
          ? current.enabledModules.map((saved) =>
              saved === "muro" ? "karuta" : saved,
            )
          : HUB_MODULES.map((mod) => mod.key);
      const enabled = new Set(base.filter((saved) => known.has(saved)));
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

  // ── Permisos de staff ───────────────────────────────────────────
  // Se guardan AL INSTANTE: dar o quitar un permiso es una acción puntual y
  // pedir un "Guardar" después de cada una hacía la pantalla confusa.
  async function applyAdminRoleModules(
    next: NonNullable<GuildConfig["adminRoleModules"]>,
    message: string,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    setSavingPermission(true);
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        adminRoleModules: next,
      });
      setConfig(nextConfig);
      pushToast(message, "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar el permiso.", "error");
    } finally {
      setSavingPermission(false);
    }
  }

  // Da o quita UN permiso a UN rol.
  async function setRolePermission(
    roleId: string,
    moduleKey: string,
    grant: boolean,
  ): Promise<void> {
    const rules = (config.adminRoleModules ?? []).map((rule) => ({
      ...rule,
      modules: [...rule.modules],
    }));
    const index = rules.findIndex((rule) => rule.roleId === roleId);
    if (grant) {
      if (index >= 0) {
        if (!rules[index].modules.includes(moduleKey)) {
          rules[index].modules.push(moduleKey);
        }
      } else {
        rules.push({ modules: [moduleKey], roleId });
      }
    } else if (index >= 0) {
      rules[index].modules = rules[index].modules.filter(
        (entry) => entry !== moduleKey,
      );
      if (rules[index].modules.length === 0) {
        rules.splice(index, 1);
      }
    }

    const roleName =
      guildRoles.find((role) => role.id === roleId)?.name ?? "El rol";
    const label =
      STAFF_PERMISSIONS.find((entry) => entry.key === moduleKey)?.label ??
      moduleKey;
    await applyAdminRoleModules(
      rules,
      grant
        ? `${roleName}: acceso a ${label}.`
        : `${roleName}: sin acceso a ${label}.`,
    );
  }

  // Atajo por rango: asigna (o saca) varios permisos de una sola vez.
  async function applyStaffTier(
    roleId: string,
    tier: StaffTier | null,
  ): Promise<void> {
    const rules = (config.adminRoleModules ?? [])
      .filter((rule) => rule.roleId !== roleId)
      .map((rule) => ({ ...rule, modules: [...rule.modules] }));
    if (tier) {
      rules.push({ modules: [...STAFF_TIERS[tier].modules], roleId });
    }
    const roleName =
      guildRoles.find((role) => role.id === roleId)?.name ?? "El rol";
    await applyAdminRoleModules(
      rules,
      tier
        ? `${roleName}: acceso ${STAFF_TIERS[tier].label}.`
        : `${roleName}: sin acceso al panel.`,
    );
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
        result.error
          ? `Log agregado, pero Warcraft Logs respondió: ${result.error}`
          : "Log agregado como borrador. Revisalo y publicalo.",
        result.error ? "error" : "success",
      );
      await refreshRaidLogs();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al agregar el log.",
        "error",
      );
    }
  }

  // Oculta la entrada completa: el watcher no la vuelve a capturar.
  async function handleHideRaidLog(group: RaidLog[]): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      for (const log of group) {
        await hideRaidLog(selectedGuildId, log.id);
      }
      const hidden = new Set(group.map((log) => log.id));
      setRaidLogs((current) =>
        current.filter((entry) => !hidden.has(entry.id)),
      );
      pushToast("Log eliminado. No se va a volver a capturar.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al eliminar el log.",
        "error",
      );
    }
  }

  function requestHideRaidLog(group: RaidLog[]): void {
    setConfirmDialog({
      kind: "danger",
      title: "Eliminar log de raid",
      message: `¿Eliminar "${group[0]?.title || group[0]?.reportCode}"? Se saca de la lista y el watcher no lo vuelve a capturar. Se puede recuperar desde el panel Admin → Logs de Raid.`,
      onConfirm: () => {
        void handleHideRaidLog(group);
      },
    });
  }

  // Publica el log (todas las partes de esa noche en un solo mensaje).
  async function handlePublishRaidLog(log: RaidLog): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const result = await publishRaidLog(selectedGuildId, log.id);
      setRaidLogs(result.logs);
      pushToast("Log publicado en Discord.", "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "No se pudo publicar el log.",
        "error",
      );
    }
  }

  // Re-escanea y edita el mensaje ya publicado si el log creció.
  async function handleUpdateRaidLog(log: RaidLog): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const result = await updateRaidLogMessage(selectedGuildId, log.id);
      setRaidLogs(result.logs);
      pushToast(
        result.updated
          ? "Log actualizado en Discord."
          : "Sin cambios: no hay datos nuevos en Warcraft Logs.",
        "success",
      );
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el log.",
        "error",
      );
    }
  }

  // Escaneo manual: no hace falta esperar al scheduler.
  async function handleScanRaidLogs(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    setScanningRaidLogs(true);
    try {
      const result = await scanRaidLogs(selectedGuildId);
      setRaidLogs(result.logs);
      pushToast(
        result.detected > 0
          ? `Escaneo listo: ${result.detected} report/s nuevo/s.`
          : "Escaneo listo: no hay reports nuevos.",
        "success",
      );
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "No se pudo escanear.",
        "error",
      );
    } finally {
      setScanningRaidLogs(false);
    }
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
      title: "Sincronizar todo",
      message:
        "Se van a re-sincronizar los roles y prefijos de nombre de todos los miembros según su nivel actual, y se van a quitar del ranking los perfiles de quienes ya no están en el servidor. ¿Continuar?",
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
      const { removed } = await requestXpSync(selectedGuildId);
      pushToast(
        removed > 0
          ? `Sincronización encolada. Se quitaron ${removed} perfil${removed === 1 ? "" : "es"} de gente que ya no está. El bot aplicará roles y prefijos en unos segundos.`
          : "Sincronización encolada. No había perfiles de gente que ya no está. El bot aplicará roles y prefijos en unos segundos.",
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

  // Roles de inscripción de cada juego, ya resueltos (el endpoint /games trae
  // las plantillas del código cuando la guild no personalizó ese juego).
  const gameRolesMap = useMemo(() => {
    const map = new Map<string, EventRoleOption[]>();
    for (const game of eventGames) {
      map.set(
        game.key,
        game.roles.length > 0 ? game.roles : DEFAULT_EVENT_ROLES,
      );
    }
    return map;
  }, [eventGames]);

  // Roles del juego de un evento (o del primero disponible si todavía no
  // cargaron los juegos). Devuelve siempre la misma referencia por juego.
  function rolesForGame(game?: string): EventRoleOption[] {
    return (
      gameRolesMap.get(game ?? "") ??
      gameRolesMap.values().next().value ??
      DEFAULT_EVENT_ROLES
    );
  }

  // El catálogo del evento es el de su juego.
  function specsForGame(game?: string): RaidSpec[] {
    return eventSpecs.filter((spec) => spec.game === (game ?? ""));
  }

  // ── Panel: edición por juego ────────────────────────────────────
  // El juego que se edita puede venir solo de la plantilla (no estar en la
  // config guardada). Para poder editarlo y guardarlo, lo "materializamos" en
  // la config local con los roles de la plantilla; recién se persiste cuando
  // el staff toca "Guardar roles".
  useEffect(() => {
    if (!adminGameKey || eventGames.length === 0) {
      return;
    }
    setConfig((current) => {
      if (
        (current.eventGames ?? []).some((game) => game.key === adminGameKey)
      ) {
        return current;
      }
      const fromList = eventGames.find((game) => game.key === adminGameKey);
      if (!fromList) {
        return current;
      }
      return {
        ...current,
        eventGames: [
          ...(current.eventGames ?? []),
          { key: fromList.key, label: fromList.label, roles: fromList.roles },
        ],
      };
    });
  }, [adminGameKey, eventGames]);

  // Aplica un cambio a los roles del juego que se está editando en el panel.
  function editAdminGameRoles(
    updater: (roles: EventRoleOption[]) => EventRoleOption[],
  ): void {
    const fromList = eventGames.find((game) => game.key === adminGameKey);
    setConfig((current) => {
      const games = current.eventGames ?? [];
      const base = games.some((game) => game.key === adminGameKey)
        ? games
        : fromList
          ? [
              ...games,
              {
                key: fromList.key,
                label: fromList.label,
                roles: fromList.roles,
              },
            ]
          : games;
      return {
        ...current,
        eventGames: base.map((game) =>
          game.key === adminGameKey
            ? { ...game, roles: updater(game.roles) }
            : game,
        ),
      };
    });
  }

  // Roles y catálogo del juego que se está editando en el panel.
  const adminRoles = resolveEventRoles(config, adminGameKey);
  const adminSpecs = eventSpecs.filter((spec) => spec.game === adminGameKey);

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
              {/* La tab Eventos arma su propia cabecera (título + botón de
                  nuevo evento): no mostramos el título/descripción genérico
                  para evitar duplicar "Eventos" y descentrar el contenido. */}
              {activeTab === "eventos" ? null : (
                <div className="section-header">
                  <div>
                    <h2>{panelTitle(activeTab)}</h2>
                    {panelDesc ? <p>{panelDesc}</p> : null}
                  </div>
                </div>
              )}

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
                                Detecta cartas raras y colecciones
                                automáticamente
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
                          </div>
                          <div className="karuta-threshold-group">
                            <h4 className="karuta-threshold-title">
                              Por print
                            </h4>
                            <div className="form-grid">
                              <label>
                                <span>Print máximo "rara"</span>
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
                                <span>Print máximo "súper rara"</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10000}
                                  value={config.karutaSuperRarePrintMax ?? 3}
                                  onChange={(event) => {
                                    const raw = event.target.value;
                                    editConfig(
                                      (current) => ({
                                        ...current,
                                        karutaSuperRarePrintMax:
                                          raw === "" ? undefined : Number(raw),
                                      }),
                                      "karuta",
                                    );
                                  }}
                                />
                              </label>
                              <label>
                                <span>Print máximo "ultra rara"</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10000}
                                  value={config.karutaUltraRarePrintMax ?? 1}
                                  onChange={(event) => {
                                    const raw = event.target.value;
                                    editConfig(
                                      (current) => ({
                                        ...current,
                                        karutaUltraRarePrintMax:
                                          raw === "" ? undefined : Number(raw),
                                      }),
                                      "karuta",
                                    );
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          <div className="karuta-threshold-group">
                            <h4 className="karuta-threshold-title">
                              Por wishlist
                            </h4>
                            <div className="form-grid">
                              <label>
                                <span>Wishlists mínimas "rara"</span>
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
                              <label>
                                <span>Wishlists mínimas "súper rara"</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={100000}
                                  value={
                                    config.karutaSuperRareWishlistMin ?? 10
                                  }
                                  onChange={(event) => {
                                    const raw = event.target.value;
                                    editConfig(
                                      (current) => ({
                                        ...current,
                                        karutaSuperRareWishlistMin:
                                          raw === "" ? undefined : Number(raw),
                                      }),
                                      "karuta",
                                    );
                                  }}
                                />
                              </label>
                              <label>
                                <span>Wishlists mínimas "ultra rara"</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={100000}
                                  value={
                                    config.karutaUltraRareWishlistMin ?? 25
                                  }
                                  onChange={(event) => {
                                    const raw = event.target.value;
                                    editConfig(
                                      (current) => ({
                                        ...current,
                                        karutaUltraRareWishlistMin:
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
                              <StaffRoleControls
                                assigned={staffByTier.admin}
                                disabled={savingPermission}
                                guildRoles={guildRoles}
                                label="Admin"
                                onAdd={(roleId) =>
                                  void applyStaffTier(roleId, "admin")
                                }
                                onRemove={(roleId) =>
                                  void applyStaffTier(roleId, null)
                                }
                              />
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
                              <StaffRoleControls
                                assigned={staffByTier.officer}
                                disabled={savingPermission}
                                guildRoles={guildRoles}
                                label="Officer"
                                onAdd={(roleId) =>
                                  void applyStaffTier(roleId, "officer")
                                }
                                onRemove={(roleId) =>
                                  void applyStaffTier(roleId, null)
                                }
                              />
                            </div>
                          </div>
                          {staffByTier.custom.length > 0 ? (
                            <div className="staff-hierarchy-tier custom">
                              <span
                                className="staff-hierarchy-icon"
                                aria-hidden="true"
                              >
                                🔷
                              </span>
                              <div className="staff-hierarchy-info">
                                <strong>Personalizado</strong>
                                <small>
                                  Permisos asignados uno por uno, sin el rango
                                  completo.
                                </small>
                                <StaffRoleControls
                                  assigned={staffByTier.custom}
                                  disabled={savingPermission}
                                  guildRoles={guildRoles}
                                  label="Personalizado"
                                  onRemove={(roleId) =>
                                    void applyStaffTier(roleId, null)
                                  }
                                />
                              </div>
                            </div>
                          ) : null}
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
                        <div className="staff-permission-list">
                          {STAFF_PERMISSIONS.map((permission) => {
                            const assigned = (
                              config.adminRoleModules ?? []
                            ).filter((rule) =>
                              rule.modules.includes(permission.key),
                            );
                            return (
                              <div
                                className="staff-permission-row"
                                key={permission.key}
                              >
                                <div className="staff-permission-info">
                                  <strong>{permission.label}</strong>
                                  <small>{permission.description}</small>
                                </div>
                                <StaffRoleControls
                                  assigned={assigned.map((rule) => ({
                                    id: rule.roleId,
                                    name:
                                      guildRoles.find(
                                        (item) => item.id === rule.roleId,
                                      )?.name ?? rule.roleId,
                                  }))}
                                  disabled={savingPermission}
                                  guildRoles={guildRoles}
                                  label={permission.label}
                                  onAdd={(roleId) =>
                                    void setRolePermission(
                                      roleId,
                                      permission.key,
                                      true,
                                    )
                                  }
                                  onRemove={(roleId) =>
                                    void setRolePermission(
                                      roleId,
                                      permission.key,
                                      false,
                                    )
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>

                      </div>
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
                                tagColor: "",
                                tagLabel: "",
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
                                  <ComunicadoTag
                                    color={comm.tagColor}
                                    label={comm.tagLabel}
                                  />
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
                                        tagColor: comm.tagColor ?? "",
                                        tagLabel: comm.tagLabel ?? "",
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
                                        {formatDateTime24(instance.publishedAt)}
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
                                className="primary-button"
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
                                className="primary-button"
                                onClick={addXpMultiplier}
                                type="button"
                              >
                                + Agregar multiplicador
                              </button>
                            </div>

                            <div className="import-export">
                              <button
                                className="primary-button"
                                onClick={() => void handleExportXp()}
                                type="button"
                              >
                                Exportar XP
                              </button>
                              <button
                                className="primary-button"
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
                                className="primary-button"
                                onClick={requestSyncRoles}
                                type="button"
                              >
                                Sincronizar todo
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
                                    {formatDateTime24(entry.createdAt)}
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
                  {canAccess("config") ? (
                    <details
                      className="admin-card admin-card-acc admin-card--admin"
                      onToggle={(event) =>
                        setShowSpecEditor(event.currentTarget.open)
                      }
                    >
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Configuración de eventos{" "}
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
                        <div className="admin-card-hint-row">
                          <label className="event-role-field">
                            <span>Tipo de evento</span>
                            <select
                              className="select"
                              value={adminGameKey}
                              onChange={(event) => {
                                const next = event.target.value;
                                setAdminGameKey(next);
                                const nextRoles =
                                  eventGames.find((game) => game.key === next)
                                    ?.roles ?? [];
                                setSpecDraft({
                                  className: "",
                                  game: next,
                                  role: nextRoles[0]?.key ?? "",
                                  specName: "",
                                });
                              }}
                            >
                              {eventGames.length === 0 ? (
                                <option value={adminGameKey}>
                                  {adminGameKey || "Cargando…"}
                                </option>
                              ) : (
                                eventGames.map((game) => (
                                  <option key={game.key} value={game.key}>
                                    {game.label}
                                  </option>
                                ))
                              )}
                            </select>
                          </label>
                        </div>

                        {/* Roles del tipo elegido (label + emoji), en acordeones
                            para que la sección no crezca hacia abajo. */}
                        <h4 className="karuta-threshold-title">
                          Roles del tipo de evento
                        </h4>
                        <div className="event-role-editor">
                          {adminRoles.map((entry, index) => (
                            <details
                              className="event-role-row"
                              key={`${entry.key}-${index}`}
                            >
                              <summary className="event-role-summary">
                                <EventRoleEmoji
                                  role={entry.key}
                                  roles={adminRoles}
                                  size={22}
                                />
                                <strong>{entry.label}</strong>
                                <span
                                  className="admin-acc-chevron"
                                  aria-hidden="true"
                                >
                                  ▸
                                </span>
                              </summary>
                              <div className="event-role-body">
                                <label className="event-role-field">
                                  <span>Etiqueta</span>
                                  <input
                                    className="input"
                                    value={entry.label}
                                    maxLength={24}
                                    onChange={(event) =>
                                      editAdminGameRoles((roles) =>
                                        roles.map((role, position) =>
                                          position === index
                                            ? {
                                                ...role,
                                                label: event.target.value,
                                              }
                                            : role,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                                <div className="spec-emoji-picker">
                                  <span className="label">
                                    Emoji (del servidor)
                                  </span>
                                  {guildEmojisLoading ? (
                                    <span className="muted-text">
                                      Cargando…
                                    </span>
                                  ) : guildEmojis.length === 0 ? (
                                    <span className="muted-text">
                                      No hay emojis custom en este servidor.
                                    </span>
                                  ) : (
                                    <div className="spec-emoji-grid">
                                      {guildEmojis.map((emoji) => {
                                        const selected =
                                          entry.emojiId === emoji.id;
                                        return (
                                          <button
                                            className={`spec-emoji-option${selected ? " active" : ""}`}
                                            key={emoji.id}
                                            onClick={() =>
                                              editAdminGameRoles((roles) =>
                                                roles.map((role, position) =>
                                                  position === index
                                                    ? selected
                                                      ? {
                                                          ...role,
                                                          animated: false,
                                                          emojiId: undefined,
                                                          emojiName: undefined,
                                                        }
                                                      : {
                                                          ...role,
                                                          animated:
                                                            emoji.animated,
                                                          emojiId: emoji.id,
                                                          emojiName: emoji.name,
                                                        }
                                                    : role,
                                                ),
                                              )
                                            }
                                            title={`:${emoji.name}:`}
                                            type="button"
                                          >
                                            <DiscordEmojiImage
                                              animated={emoji.animated}
                                              emojiId={emoji.id}
                                              name={emoji.name}
                                              size={22}
                                            />
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </details>
                          ))}
                        </div>
                        <div className="spec-cat-form-actions">
                          <button
                            className="primary-button"
                            onClick={() => void handleSaveEventRoleConfig()}
                            disabled={savingAction !== null}
                            type="button"
                          >
                            {savingAction === "eventRoles"
                              ? "Guardando…"
                              : "Guardar roles"}
                          </button>
                        </div>

                        <h4 className="karuta-threshold-title">
                          Catálogo (Clase · Spec)
                        </h4>
                        {eventSpecsLoading ? (
                          <span className="muted-text">Cargando…</span>
                        ) : adminSpecs.length === 0 ? (
                          <div className="event-signup-no-catalog">
                            Este tipo de evento todavía no tiene clases/specs
                            cargadas. Agregá abajo cada una con su emoji.
                          </div>
                        ) : (
                          adminRoles.map((roleOption) => {
                            const roleSpecs = adminSpecs.filter(
                              (entry) => entry.role === roleOption.key,
                            );
                            if (roleSpecs.length === 0) {
                              return null;
                            }
                            return (
                              <div
                                className="spec-cat-role"
                                key={roleOption.key}
                              >
                                <strong>
                                  <EventRoleEmoji
                                    role={roleOption.key}
                                    roles={adminRoles}
                                  />{" "}
                                  {roleOption.label}
                                </strong>
                                <div className="spec-cat-list">
                                  {roleSpecs.map((spec) => (
                                    <span
                                      className="spec-cat-chip"
                                      key={spec.id}
                                    >
                                      {spec.emojiId ? (
                                        <img
                                          alt=""
                                          className="signup-spec-emoji"
                                          src={discordEmojiUrl(
                                            spec.emojiId,
                                            spec.animated,
                                            20,
                                          )}
                                        />
                                      ) : (
                                        <span aria-hidden="true">❔ </span>
                                      )}
                                      {spec.className} · {spec.specName}
                                      <button
                                        className="spec-cat-chip-delete"
                                        onClick={() =>
                                          handleEditEventSpec(spec)
                                        }
                                        title="Editar"
                                        type="button"
                                      >
                                        ✏️
                                      </button>
                                      <button
                                        className="spec-cat-chip-delete"
                                        onClick={() =>
                                          handleDeleteEventSpec(spec)
                                        }
                                        title="Quitar"
                                        type="button"
                                      >
                                        ✕
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )}
                        <div className="spec-cat-form">
                          <strong>
                            {specDraft.id
                              ? "Editar clase/spec"
                              : "Agregar clase/spec"}
                          </strong>
                          <div className="form-grid">
                            <label>
                              <span>Rol</span>
                              <select
                                className="select"
                                value={
                                  adminRoles.some(
                                    (role) => role.key === specDraft.role,
                                  )
                                    ? specDraft.role
                                    : (adminRoles[0]?.key ?? "")
                                }
                                onChange={(event) =>
                                  setSpecDraft((current) => ({
                                    ...current,
                                    role: event.target.value,
                                  }))
                                }
                              >
                                {adminRoles.map((roleOption) => (
                                  <option
                                    key={roleOption.key}
                                    value={roleOption.key}
                                  >
                                    {roleOption.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>Clase</span>
                              <input
                                className="input"
                                value={specDraft.className}
                                onChange={(event) =>
                                  setSpecDraft((current) => ({
                                    ...current,
                                    className: event.target.value,
                                  }))
                                }
                                maxLength={40}
                              />
                            </label>
                            <label>
                              <span>Spec</span>
                              <input
                                className="input"
                                value={specDraft.specName}
                                onChange={(event) =>
                                  setSpecDraft((current) => ({
                                    ...current,
                                    specName: event.target.value,
                                  }))
                                }
                                maxLength={40}
                              />
                            </label>
                          </div>
                          <div className="spec-emoji-picker">
                            <span className="label">Emoji custom</span>
                            {guildEmojisLoading ? (
                              <span className="muted-text">Cargando…</span>
                            ) : guildEmojis.length === 0 ? (
                              <span className="muted-text">
                                No hay emojis custom en este servidor.
                              </span>
                            ) : (
                              <div className="spec-emoji-grid">
                                {guildEmojis.map((emoji) => {
                                  const selected =
                                    specDraft.emojiId === emoji.id;
                                  return (
                                    <button
                                      className={`spec-emoji-option${selected ? " active" : ""}`}
                                      key={emoji.id}
                                      onClick={() =>
                                        setSpecDraft((current) =>
                                          current.emojiId === emoji.id
                                            ? {
                                                ...current,
                                                animated: false,
                                                emojiId: undefined,
                                                emojiName: undefined,
                                              }
                                            : {
                                                ...current,
                                                animated: emoji.animated,
                                                emojiId: emoji.id,
                                                emojiName: emoji.name,
                                              },
                                        )
                                      }
                                      title={`:${emoji.name}:`}
                                      type="button"
                                    >
                                      <img
                                        alt={emoji.name}
                                        src={discordEmojiUrl(
                                          emoji.id,
                                          emoji.animated,
                                          24,
                                        )}
                                      />
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="spec-cat-form-actions">
                            <button
                              className="primary-button"
                              onClick={() => void handleSaveEventSpec()}
                              type="button"
                            >
                              {specDraft.id ? "Guardar cambios" : "Agregar"}
                            </button>
                            {specDraft.id ? (
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  setSpecDraft({
                                    className: "",
                                    game: adminGameKey,
                                    role: specDraft.role,
                                    specName: "",
                                  })
                                }
                                type="button"
                              >
                                Cancelar
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </details>
                  ) : null}
                  {canAccess("eventos") ? (
                    <details className="admin-card admin-card-acc admin-card--officer">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Historial de eventos{" "}
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
                        {events.filter((entry) => entry.status === "completed")
                          .length === 0 ? (
                          <p className="muted-text">
                            Todavía no hay eventos completados. Cuando un evento
                            se marca como "Completado" queda archivado acá con
                            su roster final.
                          </p>
                        ) : (
                          <div className="event-history-list">
                            {events
                              .filter((entry) => entry.status === "completed")
                              .sort(
                                (a, b) =>
                                  new Date(b.startsAt).getTime() -
                                  new Date(a.startsAt).getTime(),
                              )
                              .map((finished) => (
                                <details
                                  className="event-history-item"
                                  key={finished.id}
                                >
                                  <summary className="event-history-head">
                                    <strong>{finished.title}</strong>
                                    <span className="event-history-date">
                                      {formatDateTime24(finished.startsAt)}
                                    </span>
                                  </summary>
                                  <div className="event-history-body">
                                    {finished.signups.length === 0 ? (
                                      <p className="muted-text">
                                        Sin inscripciones.
                                      </p>
                                    ) : (
                                      (
                                        [
                                          ["yes", "✅", "Asistieron"],
                                          ["bench", "🪑", "Bench"],
                                          ["late", "⏰", "Tarde"],
                                          ["no", "❌", "No asistieron"],
                                        ] as const
                                      ).map(([st, emoji, label]) => {
                                        const members = finished.signups.filter(
                                          (signup) => signup.status === st,
                                        );
                                        if (members.length === 0) {
                                          return null;
                                        }
                                        return (
                                          <div
                                            className="event-history-group"
                                            key={st}
                                          >
                                            <span className="event-roster-role">
                                              {emoji} {label} ({members.length})
                                            </span>
                                            <span className="event-history-names">
                                              {members.map((signup) => (
                                                <span
                                                  className="event-roster-member"
                                                  key={signup.id}
                                                >
                                                  {signup.username}
                                                  {signup.character
                                                    ? ` (${signup.character})`
                                                    : ""}
                                                </span>
                                              ))}
                                            </span>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                </details>
                              ))}
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
                          <>
                            <div className="raid-log-toolbar">
                              {canAccess("raids") ? (
                                <button
                                  className="primary-button"
                                  disabled={scanningRaidLogs}
                                  onClick={() => void handleScanRaidLogs()}
                                  type="button"
                                >
                                  {scanningRaidLogs
                                    ? "Escaneando…"
                                    : "Escanear Warcraft Logs"}
                                </button>
                              ) : null}
                              {raidLogs.length > 0 ? (
                                <ListFilterBar
                                  onOrderChange={setRaidLogOrder}
                                  onSearchChange={setRaidLogSearch}
                                  order={raidLogOrder}
                                  placeholder="Buscar log…"
                                  search={raidLogSearch}
                                />
                              ) : null}
                            </div>
                            {raidLogs.length > 0 &&
                            visibleRaidLogs.length === 0 ? (
                              <div className="empty-state">
                                Ningún log coincide con el filtro.
                              </div>
                            ) : null}
                            <RaidLogsList
                              logs={visibleRaidLogs}
                              onHide={
                                canAccess("raids")
                                  ? requestHideRaidLog
                                  : undefined
                              }
                              onPublish={
                                canAccess("raids")
                                  ? handlePublishRaidLog
                                  : undefined
                              }
                              onUpdate={
                                canAccess("raids")
                                  ? handleUpdateRaidLog
                                  : undefined
                              }
                            />
                          </>
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
                              📅 Desde {formatDate24(profile.joinedAt)}
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
                        <span
                          aria-hidden="true"
                          className="comunicado-back-arrow"
                        >
                          ←
                        </span>
                        Todos los comunicados
                      </button>
                      <article className="comunicado-card">
                        <div className="comunicado-detail-head">
                          <h3>{currentComunicado.title}</h3>
                          <ComunicadoTag
                            color={currentComunicado.tagColor}
                            label={currentComunicado.tagLabel}
                          />
                          {currentComunicado.publishedAt ? (
                            <span className="comunicado-date">
                              {formatDate24(currentComunicado.publishedAt)}
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
                                    tagColor: currentComunicado.tagColor ?? "",
                                    tagLabel: currentComunicado.tagLabel ?? "",
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
                    <>
                      <ListFilterBar
                        onOrderChange={setComunicadoOrder}
                        onSearchChange={setComunicadoSearch}
                        order={comunicadoOrder}
                        placeholder="Buscar comunicado…"
                        search={comunicadoSearch}
                      >
                        <button
                          className={`event-filter-chip${comunicadoTagFilter.length === 0 ? " active" : ""}`}
                          onClick={() => setComunicadoTagFilter([])}
                          type="button"
                        >
                          Todas
                        </button>
                        {publishedTagOptions.map((tag) => {
                          const key = tag.label.toLowerCase();
                          return (
                            <EventTagFilterChip
                              active={comunicadoTagFilter.includes(key)}
                              color={tag.color ?? "#6aa8ff"}
                              key={tag.label}
                              label={tag.label}
                              onToggle={() =>
                                setComunicadoTagFilter((current) =>
                                  current.includes(key)
                                    ? current.filter((entry) => entry !== key)
                                    : [...current, key],
                                )
                              }
                            />
                          );
                        })}
                        {published.some((comm) => !comm.tagLabel?.trim()) ? (
                          <button
                            className={`event-filter-chip${comunicadoTagFilter.includes(EVENT_TAG_NONE) ? " active" : ""}`}
                            onClick={() =>
                              setComunicadoTagFilter((current) =>
                                current.includes(EVENT_TAG_NONE)
                                  ? current.filter(
                                      (entry) => entry !== EVENT_TAG_NONE,
                                    )
                                  : [...current, EVENT_TAG_NONE],
                              )
                            }
                            type="button"
                          >
                            Sin etiqueta
                          </button>
                        ) : null}
                      </ListFilterBar>
                      {visiblePublished.length === 0 ? (
                        <div className="empty-state">
                          Ningún comunicado coincide con el filtro.
                        </div>
                      ) : null}
                      {visiblePublished.map((comm) => {
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
                                <ComunicadoTag
                                  color={comm.tagColor}
                                  label={comm.tagLabel}
                                />
                                {comm.publishedAt ? (
                                  <span className="comunicado-date">
                                    {formatDate24(comm.publishedAt)}
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
                                    onClick={() =>
                                      void copyComunicadoLink(comm)
                                    }
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
                                          tagColor: comm.tagColor ?? "",
                                          tagLabel: comm.tagLabel ?? "",
                                        })
                                      }
                                      type="button"
                                    >
                                      Editar
                                    </button>
                                    <button
                                      className="ghost-button danger"
                                      onClick={() =>
                                        requestDeleteInstance(comm)
                                      }
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
                      })}
                    </>
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
                  ) : karutaSection === "raras" ? (
                    <section className="karuta-section">
                      {karutaCards.length === 0 ? (
                        <div className="empty-state">
                          Todavía no hay cartas registradas.
                        </div>
                      ) : (
                        <>
                          <div className="karuta-filters">
                            <input
                              className="input list-search"
                              onChange={(event) =>
                                setKarutaSearch(event.target.value)
                              }
                              placeholder="Buscar carta…"
                              type="search"
                              value={karutaSearch}
                            />
                            <div className="event-tag-filter">
                              {(
                                [
                                  ["all", "Todas"],
                                  ["normal", "Raras"],
                                  ["super", "Súper raras"],
                                  ["ultra", "Ultra raras"],
                                ] as const
                              ).map(([key, label]) => (
                                <button
                                  className={`event-filter-chip${karutaRarity === key ? " active" : ""}`}
                                  key={key}
                                  onClick={() => setKarutaRarity(key)}
                                  type="button"
                                >
                                  {label} (
                                  {key === "all"
                                    ? karutaCards.length
                                    : karutaRarityCounts[key]}
                                  )
                                </button>
                              ))}
                            </div>
                          </div>
                          {visibleKarutaCards.length === 0 ? (
                            <div className="empty-state">
                              Ninguna carta coincide con el filtro.
                            </div>
                          ) : null}
                          <div className="karuta-drops-grid">
                            {visibleKarutaCards.map((card) => {
                              const tier = karutaCardTier(card, config);
                              const tierClass =
                                tier === "ultra"
                                  ? " karuta-ultra-rare"
                                  : tier === "super"
                                    ? " karuta-super-rare"
                                    : "";
                              return (
                                <article
                                  className={`karuta-drop-card${tierClass}`}
                                  key={card.id}
                                  onPointerEnter={handleKarutaCardPointerEnter}
                                  onPointerLeave={handleKarutaCardPointerLeave}
                                  onPointerMove={handleKarutaCardPointerMove}
                                >
                                  <div className="karuta-card-art-wrap">
                                    {tier === "ultra" ? (
                                      <span className="karuta-tier-badge karuta-ultra-badge">
                                        💎 Ultra rara
                                      </span>
                                    ) : tier === "super" ? (
                                      <span className="karuta-tier-badge karuta-super-badge">
                                        ✨ Súper rara
                                      </span>
                                    ) : null}
                                    <KarutaCardArt
                                      name={card.cardName}
                                      url={
                                        card.imageUrl
                                          ? apiAssetUrl(card.imageUrl)
                                          : undefined
                                      }
                                    />
                                    {/* Solo las ultra raras llevan el foil: es
                                      lo que las hace sentir distintas. */}
                                    {tier === "ultra" ? (
                                      <span
                                        aria-hidden="true"
                                        className="karuta-card-glare"
                                      />
                                    ) : null}
                                  </div>
                                  <div className="karuta-drop-body">
                                    <strong>{card.cardName ?? "Carta"}</strong>
                                    {card.series ? (
                                      <span className="karuta-drop-series">
                                        {card.series}
                                      </span>
                                    ) : null}
                                    <span className="karuta-drop-user">
                                      {card.ownerUsername ?? "Desconocido"}{" "}
                                      posee la carta
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
                                        onClick={() =>
                                          handleDeleteKarutaCard(card)
                                        }
                                        type="button"
                                      >
                                        Quitar
                                      </button>
                                    ) : null}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </>
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
                            <KarutaAlbumCard
                              album={album}
                              canDelete={canAccess("config")}
                              key={album.id}
                              onDelete={handleDeleteKarutaAlbum}
                            />
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
                  <div className="event-list-header">
                    <h2>Eventos</h2>
                    {canAccess("eventos") ? (
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
                    ) : null}
                  </div>

                  {showEventForm ? (
                    <div className="event-form-card">
                      <h3 className="event-form-title">
                        {editingEventId
                          ? "Editar evento"
                          : duplicatingEvent
                            ? "Duplicar evento"
                            : "Nuevo evento"}
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
                            maxLength={120}
                          />
                        </label>
                        {/* Tipo de evento: define los roles de inscripción y el
                            catálogo que se ofrecen en este evento. */}
                        <label>
                          <span>Tipo de evento</span>
                          <select
                            className="select"
                            value={eventForm.game}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                game: event.target.value,
                              }))
                            }
                          >
                            {eventGames.length === 0 ? (
                              <option value={eventForm.game}>
                                {eventForm.game || "Cargando…"}
                              </option>
                            ) : (
                              eventGames.map((game) => (
                                <option key={game.key} value={game.key}>
                                  {game.label}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <div className="event-form-wide event-tag-field">
                          <span className="event-tag-title">Etiquetas</span>
                          <EventTagsField
                            onChange={(tags) =>
                              setEventForm((current) => ({
                                ...current,
                                tags,
                              }))
                            }
                            suggestions={eventTagOptions.map(
                              (tag) => tag.label,
                            )}
                            tags={eventForm.tags}
                          />
                        </div>
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
                        <div className="event-date-field">
                          <span>Fecha y hora</span>
                          <EventDateTimeField
                            value={eventForm.startsAt}
                            onChange={(value) =>
                              setEventForm((current) => ({
                                ...current,
                                startsAt: value,
                              }))
                            }
                          />
                        </div>
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
                          />
                        </label>
                        <div className="event-date-field">
                          <span>Cierre de inscripciones</span>
                          <EventDateTimeField
                            value={eventForm.signupDeadline}
                            onChange={(value) =>
                              setEventForm((current) => ({
                                ...current,
                                signupDeadline: value,
                              }))
                            }
                          />
                        </div>
                        <label>
                          <span>Rol mínimo para el roster (opcional)</span>
                          <select
                            className="select"
                            value={eventForm.requiredRoleId}
                            onChange={(event) =>
                              setEventForm((current) => ({
                                ...current,
                                requiredRoleId: event.target.value,
                              }))
                            }
                          >
                            <option value="">Sin requisitos</option>
                            {guildRoles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {/* OJO: el estado visual del switch lo da la clase
                            "checked" en el label (el input está oculto). */}
                        <label
                          className={`module-toggle event-reminder-toggle${
                            eventForm.characterEnabled ? " checked" : ""
                          }`}
                        >
                          <span className="module-toggle-text">
                            <strong>Pedir nombre de personaje</strong>
                          </span>
                          <span className="module-switch">
                            <input
                              type="checkbox"
                              checked={eventForm.characterEnabled}
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  characterEnabled: event.target.checked,
                                }))
                              }
                            />
                            <span
                              className="module-switch-track"
                              aria-hidden="true"
                            >
                              <span className="module-switch-thumb" />
                            </span>
                          </span>
                        </label>
                        <div className="event-form-wide event-reminders">
                          <span className="event-reminders-title">
                            Recordatorios de asistencia
                          </span>
                          <div className="event-reminders-options">
                            {REMINDER_HOUR_OPTIONS.map((option) => {
                              const checked = eventForm.reminderHours.includes(
                                option.hours,
                              );
                              const disabled = !eventForm.requiredRoleId.trim();
                              return (
                                <label
                                  className={`module-toggle event-reminder-toggle${checked ? " checked" : ""}${disabled ? " disabled" : ""}`}
                                  key={option.hours}
                                >
                                  <span className="module-toggle-text">
                                    <strong>⏰ {option.label}</strong>
                                  </span>
                                  <span className="module-switch">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={() =>
                                        setEventForm((current) => ({
                                          ...current,
                                          reminderHours: checked
                                            ? current.reminderHours.filter(
                                                (hours) =>
                                                  hours !== option.hours,
                                              )
                                            : [
                                                ...current.reminderHours,
                                                option.hours,
                                              ],
                                        }))
                                      }
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
                        <div className="event-form-wide event-recurrence">
                          <span className="event-reminders-title">
                            Repetición y estado
                          </span>
                          <div className="event-recurrence-options">
                            <label
                              className={`module-toggle event-reminder-toggle${eventForm.recurrenceEnabled ? " checked" : ""}`}
                            >
                              <span className="module-toggle-text">
                                <strong>🔁 Repetir automáticamente</strong>
                              </span>
                              <span className="module-switch">
                                <input
                                  type="checkbox"
                                  checked={eventForm.recurrenceEnabled}
                                  onChange={(event) =>
                                    setEventForm((current) => ({
                                      ...current,
                                      recurrenceEnabled: event.target.checked,
                                      recurrenceEveryDays:
                                        event.target.checked &&
                                        !current.recurrenceEveryDays
                                          ? "7"
                                          : current.recurrenceEveryDays,
                                    }))
                                  }
                                />
                                <span
                                  className="module-switch-track"
                                  aria-hidden="true"
                                >
                                  <span className="module-switch-thumb" />
                                </span>
                              </span>
                            </label>
                            {editingEventId ? (
                              <label
                                className={`module-toggle event-reminder-toggle${eventForm.paused ? " checked" : ""}`}
                              >
                                <span className="module-toggle-text">
                                  <strong>⏸️ Pausar evento</strong>
                                </span>
                                <span className="module-switch">
                                  <input
                                    type="checkbox"
                                    checked={eventForm.paused}
                                    onChange={(event) =>
                                      setEventForm((current) => ({
                                        ...current,
                                        paused: event.target.checked,
                                      }))
                                    }
                                  />
                                  <span
                                    className="module-switch-track"
                                    aria-hidden="true"
                                  >
                                    <span className="module-switch-thumb" />
                                  </span>
                                </span>
                              </label>
                            ) : null}
                          </div>
                          {eventForm.recurrenceEnabled ? (
                            <div className="event-recurrence-days-row">
                              <label className="event-recurrence-days">
                                <span>Cada (días)</span>
                                <input
                                  className="input"
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={eventForm.recurrenceEveryDays}
                                  onChange={(event) =>
                                    setEventForm((current) => ({
                                      ...current,
                                      recurrenceEveryDays: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <label className="event-recurrence-days">
                                <span>Publicar (días antes)</span>
                                <input
                                  className="input"
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={eventForm.recurrencePublishDaysBefore}
                                  onChange={(event) =>
                                    setEventForm((current) => ({
                                      ...current,
                                      recurrencePublishDaysBefore:
                                        event.target.value,
                                    }))
                                  }
                                />
                              </label>
                            </div>
                          ) : null}
                        </div>
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
                              placeholder="URL o imagen"
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
                      </div>
                      <div className="event-form-wide event-discord-editor">
                        <span className="event-image-editor-label">
                          📢 Publicar en Discord
                        </span>
                        <label
                          className={`module-toggle event-discord-toggle${eventForm.discord.createScheduledEvent ? " checked" : ""}`}
                        >
                          <span className="module-toggle-text">
                            <strong>Crear Scheduled Event</strong>
                            <small>
                              Aparece en el panel Eventos de Discord, con RSVP
                              nativo.
                            </small>
                          </span>
                          <span className="module-switch">
                            <input
                              type="checkbox"
                              checked={eventForm.discord.createScheduledEvent}
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  discord: {
                                    ...current.discord,
                                    createScheduledEvent: event.target.checked,
                                  },
                                }))
                              }
                            />
                            <span
                              className="module-switch-track"
                              aria-hidden="true"
                            >
                              <span className="module-switch-thumb" />
                            </span>
                          </span>
                        </label>
                        {eventForm.discord.createScheduledEvent ? (
                          <div className="event-discord-row">
                            <div className="event-signup-role-row">
                              <button
                                className={`event-status-btn role${eventForm.discord.entityType === "voice" ? " active" : ""}`}
                                onClick={() =>
                                  setEventForm((current) => ({
                                    ...current,
                                    discord: {
                                      ...current.discord,
                                      entityType: "voice",
                                    },
                                  }))
                                }
                                type="button"
                              >
                                🔉 Sala de voz
                              </button>
                              <button
                                className={`event-status-btn role${eventForm.discord.entityType === "external" ? " active" : ""}`}
                                onClick={() =>
                                  setEventForm((current) => ({
                                    ...current,
                                    discord: {
                                      ...current.discord,
                                      entityType: "external",
                                    },
                                  }))
                                }
                                type="button"
                              >
                                📍 Externo (con ubicación)
                              </button>
                            </div>
                            {eventForm.discord.entityType === "voice" ? (
                              <label>
                                <span>Sala de voz del evento</span>
                                <select
                                  className="select"
                                  value={eventForm.discord.voiceChannelId}
                                  onChange={(event) =>
                                    setEventForm((current) => ({
                                      ...current,
                                      discord: {
                                        ...current.discord,
                                        voiceChannelId: event.target.value,
                                      },
                                    }))
                                  }
                                >
                                  <option value="">
                                    Seleccionar sala de voz…
                                  </option>
                                  {voiceChannels.map((channel) => (
                                    <option key={channel.id} value={channel.id}>
                                      {channel.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <label>
                                <span>
                                  Ubicación (ej: en juego, sala de Raid…)
                                </span>
                                <input
                                  className="input"
                                  value={eventForm.discord.location}
                                  onChange={(event) =>
                                    setEventForm((current) => ({
                                      ...current,
                                      discord: {
                                        ...current.discord,
                                        location: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Ej: World of Warcraft"
                                  maxLength={100}
                                />
                              </label>
                            )}
                          </div>
                        ) : null}
                        <label
                          className={`module-toggle event-discord-toggle${eventForm.discord.publishMessage ? " checked" : ""}`}
                        >
                          <span className="module-toggle-text">
                            <strong>Publicar un aviso</strong>
                            <small>
                              Publica un embed del evento en un canal de texto.
                            </small>
                          </span>
                          <span className="module-switch">
                            <input
                              type="checkbox"
                              checked={eventForm.discord.publishMessage}
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  discord: {
                                    ...current.discord,
                                    publishMessage: event.target.checked,
                                  },
                                }))
                              }
                            />
                            <span
                              className="module-switch-track"
                              aria-hidden="true"
                            >
                              <span className="module-switch-thumb" />
                            </span>
                          </span>
                        </label>
                        {eventForm.discord.publishMessage ? (
                          <label>
                            <span>Canal donde publicar</span>
                            <select
                              className="select"
                              value={eventForm.discord.publishChannelId}
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  discord: {
                                    ...current.discord,
                                    publishChannelId: event.target.value,
                                  },
                                }))
                              }
                            >
                              <option value="">
                                Seleccionar canal de texto…
                              </option>
                              {textChannels.map((channel) => (
                                <option key={channel.id} value={channel.id}>
                                  {channel.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {eventForm.discord.createScheduledEvent ||
                        eventForm.discord.publishMessage ? (
                          <label
                            className={`module-toggle event-reminder-toggle${eventForm.discordCleanupOnComplete ? " checked" : ""}`}
                          >
                            <span className="module-toggle-text">
                              <strong>
                                🧹 Eliminar ocurrencia al completar
                              </strong>
                            </span>
                            <span className="module-switch">
                              <input
                                type="checkbox"
                                checked={eventForm.discordCleanupOnComplete}
                                onChange={(event) =>
                                  setEventForm((current) => ({
                                    ...current,
                                    discordCleanupOnComplete:
                                      event.target.checked,
                                  }))
                                }
                              />
                              <span
                                className="module-switch-track"
                                aria-hidden="true"
                              >
                                <span className="module-switch-thumb" />
                              </span>
                            </span>
                          </label>
                        ) : null}
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
                  ) : (
                    <>
                      {events.length > 0 ? (
                        <ListFilterBar
                          onOrderChange={setEventOrder}
                          onSearchChange={setEventSearch}
                          order={eventOrder}
                          placeholder="Buscar evento…"
                          search={eventSearch}
                        />
                      ) : null}
                      {activeTagOptions.length > 0 || untaggedEvents > 0 ? (
                        <div className="event-tag-filter">
                          <button
                            className={`event-filter-chip${eventTagFilter.length === 0 ? " active" : ""}`}
                            onClick={() => setEventTagFilter([])}
                            type="button"
                          >
                            Todas
                          </button>
                          {activeTagOptions.map((tag) => {
                            const key = tag.label.toLowerCase();
                            return (
                              <EventTagFilterChip
                                active={eventTagFilter.includes(key)}
                                color={tag.color}
                                key={tag.label}
                                label={tag.label}
                                onToggle={() =>
                                  setEventTagFilter((current) =>
                                    current.includes(key)
                                      ? current.filter((entry) => entry !== key)
                                      : [...current, key],
                                  )
                                }
                              />
                            );
                          })}
                          {untaggedEvents > 0 ? (
                            <button
                              className={`event-filter-chip${eventTagFilter.includes(EVENT_TAG_NONE) ? " active" : ""}`}
                              onClick={() =>
                                setEventTagFilter((current) =>
                                  current.includes(EVENT_TAG_NONE)
                                    ? current.filter(
                                        (entry) => entry !== EVENT_TAG_NONE,
                                      )
                                    : [...current, EVENT_TAG_NONE],
                                )
                              }
                              type="button"
                            >
                              Sin etiqueta
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {filteredEvents.length === 0 ? (
                        <div className="empty-state">
                          {eventTagFilter.length > 0 || eventSearch.trim()
                            ? "Ningún evento coincide con el filtro."
                            : events.length > 0
                              ? "No hay eventos próximos. Las ocurrencias cerradas quedan en Admin → Historial de eventos."
                              : "Todavía no hay eventos."}
                        </div>
                      ) : (
                        <div className="events-grid">
                          {filteredEvents.map((event) => (
                            <EventCard
                              canManage={canAccess("eventos")}
                              config={config}
                              event={event}
                              guildRoles={guildRoles}
                              key={event.id}
                              meId={me?.id}
                              onDelete={handleDeleteEvent}
                              onDuplicate={handleDuplicateEvent}
                              onEdit={handleEditEvent}
                              onRemoveSignup={handleRemoveEventSignup}
                              onResetOccurrence={handleResetOccurrence}
                              onResetSignup={handleResetEventSignup}
                              onSignup={handleEventSignup}
                              onStaffRemoveSignup={handleStaffRemoveEventSignup}
                              onStaffSignup={handleStaffEventSignup}
                              gameRoles={rolesForGame(event.game)}
                              specs={specsForGame(event.game)}
                            />
                          ))}
                        </div>
                      )}
                    </>
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
              <ComunicadoTagFields
                color={commEditor.tagColor ?? ""}
                label={commEditor.tagLabel ?? ""}
                onColor={(tagColor) =>
                  setCommEditor((current) =>
                    current ? { ...current, tagColor } : current,
                  )
                }
                onLabel={(tagLabel) =>
                  setCommEditor((current) =>
                    current ? { ...current, tagLabel } : current,
                  )
                }
              />
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
              <ComunicadoTagFields
                color={instanceEditor.tagColor ?? ""}
                label={instanceEditor.tagLabel ?? ""}
                onColor={(tagColor) =>
                  setInstanceEditor((current) =>
                    current ? { ...current, tagColor } : current,
                  )
                }
                onLabel={(tagLabel) =>
                  setInstanceEditor((current) =>
                    current ? { ...current, tagLabel } : current,
                  )
                }
              />
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
