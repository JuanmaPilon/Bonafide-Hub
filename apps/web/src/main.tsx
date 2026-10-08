import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { RaidLogsBoard } from "./RaidLogsBoard";
import { copyToClipboard } from "./clipboard";
import { hoursFromMinutes, minutesFromHours } from "./duration";
import { createMarquee } from "./marquee";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  createCommunication,
  createDailyMessage,
  createRaidLog,
  deleteCommunication,
  reorderCommunications,
  deleteDailyMessage,
  deleteRaidLogPermanent,
  exportXpData,
  getAuditLogs,
  getEventReportCsv,
  getEventRoster,
  getGuildBoosters,
  getGuildGameActivity,
  getGuildConfig,
  getGuildRoles,
  getGuilds,
  getGuildTextChannels,
  getGuildVoiceChannels,
  getGuildWidgetStatus,
  getRaidLogAnalysis,
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
  saveGuildMappings,
  saveXpConfig,
  submitSuggestion,
  updateCommunication,
  updateDailyMessage,
  EVENT_TYPES,
  classColor,
  classEmoji,
  createEvent,
  createGuildRole,
  deleteMemberRosterProfile,
  deleteEvent,
  deleteEventImage,
  deleteGuildRole,
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
  getEventTemplates,
  getEvents,
  getGuildEmojis,
  getGuildMappings,
  getGuildRolesDetailed,
  getGuildRoster,
  publishRaidLog,
  ROLE_META,
  resetEventOccurrence,
  saveMemberRosterProfile,
  saveMyRosterProfile,
  removeRosterMember,
  setRosterRank,
  scanRaidLogs,
  updateEvent,
  updateGuildRole,
  updateRaidLogMessage,
  uploadEventImage,
  upsertEventSignup,
  upsertMemberEventSignup,
  type ApiGuild,
  type AdminAccess,
  type AuditLogEntry,
  type Communication,
  type CommunicationInput,
  type DailyMessage,
  type GuildBooster,
  type GuildChannel,
  type GuildConfig,
  type GuildEmoji,
  type GuildGameActivity,
  type GuildRole,
  type MappingGroup,
  type MappingEmoji,
  type GuildRoleDetail,
  type GuildRoster,
  type GuildWidgetStatus,
  type LeaderboardEntry,
  type MemberProfile,
  type PublicLeaderboardEntry,
  type RaidLog,
  type RaidLogAnalysis,
  type KarutaCard,
  type KarutaAlbum,
  type XpConfig,
  type XpImportEntry,
  type XpRoleMultiplier,
  type XpRoleRule,
  type RaidSpec,
  type EventGameOption,
  type EventRoleOption,
  type EventTemplateSummary,
  type EventDiscordOptions,
  type EventSignup,
  type EventRoster,
  type EventImage,
  type EventTag,
  type HubEvent,
  type RosterAlt,
  type RosterMember,
  type RosterProfile,
  type RosterProfileInput,
  type RosterRankKey,
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

// Rangos de staff, de mayor a menor: cada uno tiene un set de módulos fijo
// definido acá (desde el código); el owner solo elige qué rango darle a cada
// rol de Discord. Los COLORES de cada rango viven en styles.css (--tier-*).
//
// El chip de cada tarjeta del panel es el rango MÁS BAJO que puede usar su
// módulo: si un módulo entra o sale de un rango, hay que mover también el chip
// (y la clase admin-card--*) de esa tarjeta. Hoy: comunicados/eventos/raids →
// Sub Officer; daily/karuta → Officer; config/xp → Admin.
type StaffTier = "admin" | "officer" | "subofficer";
type AccessTier = "owner" | StaffTier;
const ACCESS_TIER_ORDER: Record<AccessTier, number> = {
  owner: 0,
  admin: 1,
  officer: 2,
  subofficer: 3,
};

function accessTierLabel(tier: AccessTier): string {
  return tier === "subofficer"
    ? "Sub Officer"
    : tier[0].toUpperCase() + tier.slice(1);
}

// ¿El refresco trae lo mismo que ya está en pantalla? El dashboard se refresca
// solo cada minuto: sin esta comparación, un payload idéntico igual provoca un
// objeto nuevo y React vuelve a renderizar todo (incluido el carrusel).
function samePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
  subofficer: {
    label: "Sub Officer",
    description: "Base: comunicados, eventos y logs de raid.",
    modules: ["comunicados", "eventos", "raids"],
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
  if (sortKey(modules) === sortKey(STAFF_TIERS.subofficer.modules)) {
    return "subofficer";
  }
  return null;
}

// Un rol mostrado como chip: nombre para mostrar y su color de Discord para
// pintarlo (con degradado si el rol tiene dos colores).
type StaffRoleChip = {
  color?: number;
  id: string;
  name: string;
  secondaryColor?: number;
};

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
        <span
          className={roleChipClass(role)}
          key={role.id}
          style={roleChipStyle(role)}
        >
          <span className="role-chip-name">{role.name}</span>
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

// Slugs de URL de las páginas de Karuta (se mantienen para no romper los
// enlaces que ya se compartieron).
const KARUTA_SECTION_SLUGS: Record<KarutaSection, string> = {
  raras: "raras",
  coleccion: "coleccion",
  guia: "guia-de-comandos",
};

// Slug de URL de una sub-página. Por defecto es la clave de la sección
// (#/raids/roster, #/raids/logs).
function sectionSlug(tab: HubTab, key: string): string {
  if (tab === "karuta") {
    return KARUTA_SECTION_SLUGS[key as KarutaSection] ?? key;
  }
  return key;
}

// Clave de la sección a partir del slug de la URL (lo que va después de la
// pestaña).
function sectionFromSlug(tab: HubTab, slug: string): string | null {
  const sections = TAB_SECTIONS[tab];
  if (!sections) {
    return null;
  }
  return (
    sections.find((section) => sectionSlug(tab, section.key) === slug)?.key ??
    null
  );
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

// Descarga un texto como archivo (lo usa el informe de asistencia en CSV).
function downloadCsvFile(name: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Parsea el hash:
//   #/raids/logs → tab "raids" + sección "logs"
//   #/karuta/guia-de-comandos → tab "karuta" + sección "guia"
//   #/comunicados/sistema-de-loot-y-addons → tab "comunicados" + slug
function parseLocationHash(): {
  section: string | null;
  tab: HubTab;
  comunicadoSlug: string | null;
} {
  const raw = window.location.hash.replace(/^#\/?/, "").trim().toLowerCase();
  const parts = raw.split("/").filter(Boolean);
  const tab = (VALID_TABS as string[]).includes(parts[0])
    ? (parts[0] as HubTab)
    : "home";
  const section = parts[1] ? sectionFromSlug(tab, parts[1]) : null;
  const comunicadoSlug = tab === "comunicados" && parts[1] ? parts[1] : null;
  return { comunicadoSlug, section, tab };
}

function tabFromHash(): HubTab {
  return parseLocationHash().tab;
}

// Resumen para la tarjeta del board: saca el marcado más obvio para que el
// texto se lea como prosa. El comunicado completo se ve en el modal.
function comunicadoExcerpt(content: string, max = 170): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
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
function normalizeHexColor(
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

// Componentes RGB del color del tag (base para el texto de contraste y para
// los tintes del chip de filtro).
function tagRgb(hex: string): [number, number, number] {
  const h = normalizeHexColor(hex).replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

// Texto legible sobre el color pleno del tag (blanco u oscuro según luminancia).
function tagTextColor(hex: string): string {
  const [r, g, b] = tagRgb(hex);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 150 ? "#141b2b" : "#ffffff";
}

// Selector de color COMPARTIDO (roles de Discord, etiquetas de eventos y
// comunicados): la paleta nativa + el HEX escrito a mano. La paleta sirve para
// tantear, el HEX para cuando ya se sabe el color exacto o se copia de afuera.
//
// El color solo se propaga cuando el HEX está completo. Mientras se escribe
// "#a1" no hay color válido que mandar: avisar con cada tecla rompería la vista
// previa y, en el rol, lo que se manda al API.
function ColorControl({
  compact,
  label,
  onChange,
  value,
}: {
  compact?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  // El input nativo exige #rrggbb: con un valor a medias el navegador lo pinta
  // negro, así que el cuadrado siempre recibe un color válido.
  const safe = normalizeHexColor(value, "#000000");
  const [draft, setDraft] = useState(value);

  // Si el color cambia desde afuera (la paleta, o el valor que llegó del API)
  // el texto acompaña. Se compara contra el borrador normalizado: así el
  // #rrggbb que se acaba de confirmar no pisa lo que la persona sigue
  // escribiendo (al tipear "#abc" el valor ya es "#aabbcc" y el cursor quedaría
  // saltando).
  useEffect(() => {
    setDraft((current) =>
      normalizeHexColor(current, "") === value ? current : value,
    );
  }, [value]);

  function commit(next: string): void {
    setDraft(next);
    const normalized = normalizeHexColor(next, "");
    if (normalized) {
      onChange(normalized);
    }
  }

  return (
    <div className={`color-control${compact ? " color-control--compact" : ""}`}>
      <span className="color-control-swatch" style={{ backgroundColor: safe }}>
        <input
          aria-label={`${label}: paleta`}
          className="color-control-native"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={safe}
        />
      </span>
      <input
        aria-label={`${label}: HEX`}
        className="input color-control-hex"
        maxLength={7}
        onBlur={() => setDraft(value)}
        onChange={(event) => commit(event.target.value)}
        placeholder="#rrggbb"
        spellCheck={false}
        value={draft}
      />
    </div>
  );
}

// El mismo color con transparencia: fondo tenido del chip sin seleccionar.
// Se calcula acá (y no con color-mix en CSS) para que funcione en cualquier
// navegador y se vea igual en los dos temas.
function tagTint(hex: string, alpha: number): string {
  const [r, g, b] = tagRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Colores de roles de Discord (chips del perfil) ──────────────────
// Un rol puede venir sin color (0), con un color pleno o con DOS colores:
// los degradados de Discord llegan en `colors` y el legacy `color` solo trae
// el principal (y en algunos roles viene en 0).
function roleColorHex(value: number | undefined): string | null {
  if (!value) {
    return null;
  }
  return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}

// ¿El color es tan claro que sobre el fondo claro no se leería (blanco,
// amarillo pálido)? El JS solo marca el caso; el tema lo resuelve el CSS
// (.profile-role--pale). El umbral es alto a propósito: los colores vivos
// (el verde de Rank 5, el dorado de Gold) se dejan tal cual.
function isPaleRoleColor(hex: string): boolean {
  const [r, g, b] = tagRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 190;
}

// El caso simétrico: un color casi negro (los grises de Discord, ej. Unrank)
// desaparece sobre el fondo oscuro del tema dark.
function isDarkRoleColor(hex: string): boolean {
  const [r, g, b] = tagRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
}

// Color de TEXTO de un rango (título de tarjeta, nombre en la plaquita): el
// color del rol, ajustado para que se lea sobre el fondo del tema en uso — es
// el equivalente por rol de los --tier-*-text de la paleta fija (que tiene un
// valor para cada tema).
function tierTextColor(hex: string, theme: "dark" | "light"): string {
  const [r, g, b] = tagRgb(hex);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // En claro, cualquier color claro se oscurece; en oscuro, los casi negros
  // (los grises de Discord) se aclaran.
  const factor =
    theme === "light"
      ? luminance > 100
        ? 100 / luminance
        : 1
      : luminance < 60
        ? 1.9
        : 1;
  if (factor === 1) {
    return hex;
  }
  return `#${[r, g, b]
    .map((channel) =>
      Math.min(255, Math.round(channel * factor))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function roleChipClass(role: {
  color?: number;
  secondaryColor?: number;
}): string {
  const primary = roleColorHex(role.color);
  if (!primary) {
    return "role-chip";
  }
  const secondary = roleColorHex(role.secondaryColor);
  return [
    "role-chip",
    "role-chip--colored",
    secondary && secondary !== primary ? "role-chip--gradient" : null,
    isPaleRoleColor(primary) ? "role-chip--pale" : null,
    isDarkRoleColor(primary) ? "role-chip--dark" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function roleChipStyle(role: {
  color?: number;
  secondaryColor?: number;
}): CSSProperties | undefined {
  const primary = roleColorHex(role.color);
  if (!primary) {
    return undefined;
  }
  const secondaryRaw = roleColorHex(role.secondaryColor);
  const secondary =
    secondaryRaw && secondaryRaw !== primary ? secondaryRaw : null;
  return {
    "--role-border": tagTint(primary, 0.5),
    "--role-color": primary,
    "--role-color-2": secondary ?? primary,
    "--role-tint": tagTint(primary, 0.16),
    "--role-tint-2": tagTint(secondary ?? primary, 0.16),
  } as CSSProperties;
}

// Chip del tag: si no hay etiqueta no renderiza nada (uso seguro en cards).
function ComunicadoTag({ color, label }: { color?: string; label?: string }) {
  const text = label?.trim();
  if (!text) {
    return null;
  }
  const background = normalizeHexColor(color);
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

const MAX_TAGS = 6;
// Valor del filtro "eventos sin ninguna etiqueta".
const EVENT_TAG_NONE = "__none__";

// ── Registro de auditoría (Admin → Registros) ─────────────────────
// Cada acción del panel se guarda con una clave técnica ("update:guild-config")
// y un detalle de qué cambió. Acá se traduce la clave a algo legible: la clave
// queda como title del elemento, para no perder la traza.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "create:communication": "Comunicado creado",
  "daily-message:create": "Frase del loro creada",
  "daily-message:delete": "Frase del loro borrada",
  "daily-message:update": "Frase del loro editada",
  "delete:communication": "Comunicado eliminado",
  "event:auto-complete": "Evento cerrado automáticamente",
  "event:create": "Evento creado",
  "event:delete": "Evento eliminado",
  "event:occurrence-reset": "Ocurrencia de evento cerrada",
  "event:signup-edit": "Inscripción editada a mano",
  "event:signup-remove": "Inscripción quitada a mano",
  "event:template-apply": "Plantilla de evento aplicada",
  "event:update": "Evento editado",
  "karuta-album:delete": "Álbum de Karuta eliminado",
  "karuta-card:delete": "Carta de Karuta eliminada",
  "publish:communication": "Comunicado publicado en Discord",
  "raid-log:create": "Log de raid agregado",
  "raid-log:delete": "Log de raid borrado",
  "raid-log:hide": "Log de raid ocultado",
  "raid-log:publish": "Log de raid publicado",
  "raid-log:restore": "Log de raid restaurado",
  "role:create": "Rol creado",
  "role:delete": "Rol eliminado",
  "role:template-delete": "Plantilla de rol eliminada",
  "role:template-save": "Plantilla de rol guardada",
  "role:update": "Rol editado",
  "update:communication": "Comunicado editado",
  "update:guild-config": "Configuración general actualizada",
  "update:xp-config": "Configuración de XP actualizada",
  "xp:import": "XP importada",
  "xp:reset-all": "XP reseteada",
  "xp:sync": "Roles de XP re-sincronizados",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

// ── Filtros de listas (comunicados, eventos, raids, cartas) ─────────
// Todas las listas comparten el mecanismo: buscador, orden por fecha o
// alfabético y, donde haya etiquetas, chips para filtrar.
type ListOrder = "az" | "board" | "newest" | "oldest" | "za";
type KarutaRarityFilter = "all" | "normal" | "super" | "ultra";

const LIST_ORDER_OPTIONS: Array<{ key: ListOrder; label: string }> = [
  { key: "newest", label: "Más recientes" },
  { key: "oldest", label: "Más antiguos" },
  { key: "az", label: "A-Z" },
  { key: "za", label: "Z-A" },
];

// El tablero de comunicados tiene un orden propio: el que arma el staff
// arrastrando las tarjetas. Solo tiene sentido ahí, por eso no está en la lista
// compartida.
const COMUNICADO_ORDER_OPTIONS: Array<{ key: ListOrder; label: string }> = [
  { key: "board", label: "Orden del tablero" },
  ...LIST_ORDER_OPTIONS,
];

// Chips del filtro de rareza de Karuta: cada uno lleva el MATERIAL de su
// rareza (acero la rara, dorado la súper, holográfico la ultra), el mismo que
// usan las cartas. `modifier` es la clase que define ese material.
const KARUTA_RARITY_FILTERS: Array<{
  key: KarutaRarityFilter;
  label: string;
  modifier: string;
}> = [
  { key: "all", label: "Todas", modifier: "karuta-rarity-chip--all" },
  { key: "normal", label: "Raras", modifier: "karuta-rarity-chip--normal" },
  { key: "super", label: "Súper raras", modifier: "karuta-rarity-chip--super" },
  { key: "ultra", label: "Ultra raras", modifier: "karuta-rarity-chip--ultra" },
];

function matchesSearch(value: string, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle.length === 0 || value.toLowerCase().includes(needle);
}

// Una entrada de etiqueta por texto (sin repetir, case-insensitive) con su
// color: alimenta los chips de filtro de cualquier lista con etiquetas.
function tagOptionsFrom(
  items: Array<{ tags?: EventTag[] }>,
): Array<{ color?: string; label: string }> {
  const byLabel = new Map<string, { color?: string; label: string }>();
  for (const item of items) {
    for (const tag of item.tags ?? []) {
      const label = tag.label.trim();
      if (label && !byLabel.has(label.toLowerCase())) {
        byLabel.set(label.toLowerCase(), { color: tag.color, label });
      }
    }
  }
  return [...byLabel.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es"),
  );
}

// ¿Pasa el filtro de etiquetas? Coincide si tiene ALGUNA de las seleccionadas;
// "sin etiqueta" (EVENT_TAG_NONE) es una opción más.
function matchesTagFilter(tags: EventTag[], filter: string[]): boolean {
  if (filter.length === 0) {
    return true;
  }
  if (tags.length === 0) {
    return filter.includes(EVENT_TAG_NONE);
  }
  return tags.some((tag) => filter.includes(tag.label.trim().toLowerCase()));
}

// Alterna un valor en un filtro de selección múltiple.
function toggleInList(list: string[], key: string): string[] {
  return list.includes(key)
    ? list.filter((entry) => entry !== key)
    : [...list, key];
}

// Estados del roster para el filtro: mismas etiquetas que la tarjeta.
const ROSTER_STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "raid", label: "Activo" },
  { key: "bench", label: "Bench" },
  { key: "inactivo", label: "Inactivo" },
];

function sortByOrder<T>(
  items: T[],
  order: ListOrder,
  dateOf: (item: T) => string | undefined,
  labelOf: (item: T) => string,
): T[] {
  const time = (value?: string): number =>
    value ? new Date(value).getTime() : 0;
  // "board": sin reordenar. Deja el orden con el que llegó la lista, que en los
  // comunicados es el del tablero (lo que el staff acomodó arrastrando).
  if (order === "board") {
    return [...items];
  }
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
// que cada lista muestre los suyos. Sin `order` la barra queda solo con el
// buscador (listas que ya tienen su propio orden natural, como el ranking).
function ListFilterBar({
  children,
  onOrderChange,
  onSearchChange,
  order,
  orderOptions,
  placeholder,
  search,
}: {
  children?: ReactNode;
  onOrderChange?: (order: ListOrder) => void;
  // Opciones de orden propias de la lista (ej: el tablero de comunicados).
  orderOptions?: Array<{ key: ListOrder; label: string }>;
  onSearchChange: (value: string) => void;
  order?: ListOrder;
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
      {onOrderChange ? (
        <select
          aria-label="Ordenar"
          className="select list-order"
          onChange={(event) => onOrderChange(event.target.value as ListOrder)}
          value={order ?? "newest"}
        >
          {(orderOptions ?? LIST_ORDER_OPTIONS).map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {children}
    </div>
  );
}

// Editor de etiquetas (lo usan los eventos y los comunicados): se agregan de a
// una (texto + color) y se ven como chips con su ✕. Sugiere textos ya usados.
function TagsField({
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
    if (!text || tags.length >= MAX_TAGS) {
      return;
    }
    if (tags.some((tag) => tag.label.toLowerCase() === text.toLowerCase())) {
      setLabel("");
      return;
    }
    onChange([...tags, { color: normalizeHexColor(color), label: text }]);
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
      {tags.length < MAX_TAGS ? (
        <div className="event-tag-add">
          <input
            className="event-tag-input"
            list="tag-suggestions"
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
          <ColorControl
            compact
            label="Color de la etiqueta"
            onChange={setColor}
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
      <datalist id="tag-suggestions">
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
  color?: string;
  label: string;
  onToggle: () => void;
}) {
  // Mismo criterio de color que la tarjeta del evento/comunicado (ComunicadoTag):
  // si la etiqueta no tiene color guardado, los dos caen al mismo default, así
  // el filtro y la tarjeta nunca muestran colores distintos.
  const background = normalizeHexColor(color);
  return (
    <button
      className={`event-filter-chip event-filter-chip--tag${active ? " active" : ""}`}
      onClick={onToggle}
      style={
        {
          "--chip-border": tagTint(background, 0.7),
          "--chip-color": background,
          "--chip-text": tagTextColor(background),
          "--chip-tint": tagTint(background, 0.22),
        } as CSSProperties
      }
      type="button"
    >
      {active ? "✓ " : ""}
      {label}
    </button>
  );
}

// Etiquetas de un comunicado: puede tener varias, así que se pintan todas con
// el mismo chip que usan los eventos. Van dentro de su propio contenedor para
// que en un padre grid no hereden el ancho completo (chip estirado).
function ComunicadoTags({ tags }: { tags: EventTag[] }) {
  if (tags.length === 0) {
    return null;
  }
  return (
    <span className="comunicado-tags">
      {tags.map((tag) => (
        <ComunicadoTag color={tag.color} key={tag.label} label={tag.label} />
      ))}
    </span>
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

// ── Roster de raids ─────────────────────────────────────────────────
// Lista actual de la guild: cada rango se llena con los miembros que tienen el
// rol de Discord mapeado en el panel, y cada uno carga su ficha (clase, spec
// actual y las off que domina). Las claves de la ficha son las del catálogo
// RaidSpec, que es de donde salen los emojis.
function rosterSpecKey(
  game: string,
  className: string,
  specName: string,
): string {
  return `${game}|${className}|${specName}`;
}

// Panel de la ficha: clase + spec actual + las off que domina (solo specs de
// esa clase).
function RosterSheet({
  alts: initialAlts,
  canDelete,
  games,
  memberName,
  onClose,
  onDelete,
  onSave,
  profile,
  saving,
  specs,
}: {
  alts: RosterAlt[];
  canDelete: boolean;
  games: Array<{ key: string; label: string }>;
  memberName: string;
  onClose: () => void;
  onDelete: () => void;
  onSave: (input: RosterProfileInput) => void;
  profile: RosterProfile | null;
  saving: boolean;
  specs: RaidSpec[];
}) {
  const [game] = useState("wow");
  const classes = useMemo(
    () => [
      ...new Set(
        specs
          .filter((spec) => spec.game === game)
          .map((spec) => spec.className),
      ),
    ],
    [game, specs],
  );
  const [className, setClassName] = useState(
    profile?.game === "wow" ? profile.className : (classes[0] ?? ""),
  );
  const classSpecs = useMemo(
    () =>
      specs.filter(
        (spec) => spec.game === game && spec.className === className,
      ),
    [className, game, specs],
  );
  const [specName, setSpecName] = useState(
    profile?.game === "wow"
      ? profile.specName
      : (classSpecs[0]?.specName ?? ""),
  );
  const [offSpecs, setOffSpecs] = useState<string[]>(
    profile?.game === "wow" ? profile.offSpecs : [],
  );
  // Clases secundarias del mazo: la que se elija como main sale de acá y la
  // principal entra en su lugar. Nunca se repite la clase principal.
  const [alts, setAlts] = useState<RosterAlt[]>(() =>
    initialAlts.filter((alt) => alt.game === undefined || alt.game === "wow"),
  );

  function altSpecsFor(target: string): RaidSpec[] {
    return specs.filter(
      (spec) => spec.game === game && spec.className === target,
    );
  }

  function addAlt(): void {
    const used = new Set([className, ...alts.map((alt) => alt.className)]);
    const next = classes.find((entry) => !used.has(entry));
    if (!next) {
      return;
    }
    setAlts((current) => [
      ...current,
      {
        className: next,
        specName: altSpecsFor(next)[0]?.specName ?? "",
      },
    ]);
  }

  function updateAltClass(index: number, next: string): void {
    setAlts((current) =>
      current.map((alt, position) =>
        position === index
          ? { className: next, specName: altSpecsFor(next)[0]?.specName ?? "" }
          : alt,
      ),
    );
  }

  function updateAltSpec(index: number, next: string): void {
    setAlts((current) =>
      current.map((alt, position) =>
        position === index ? { ...alt, specName: next } : alt,
      ),
    );
  }

  function removeAlt(index: number): void {
    setAlts((current) => current.filter((_, position) => position !== index));
  }

  function makeMain(index: number): void {
    const alt = alts[index];
    if (!alt) {
      return;
    }
    const previous: RosterAlt = { className, specName };
    setAlts((current) => [
      ...current.filter((_, position) => position !== index),
      previous,
    ]);
    setClassName(alt.className);
    setSpecName(alt.specName);
    setOffSpecs([]);
  }

  const unusedClasses = classes.filter(
    (entry) =>
      entry !== className && !alts.some((alt) => alt.className === entry),
  );

  function pickClass(next: string): void {
    setClassName(next);
    setSpecName(
      specs.find((spec) => spec.game === game && spec.className === next)
        ?.specName ?? "",
    );
    setOffSpecs([]);
  }

  function toggleOff(name: string): void {
    setOffSpecs((current) =>
      current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name],
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-modal="true"
        className="modal roster-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h4>{memberName}</h4>
        <label className="roster-sheet-field">
          <span>Juego</span>
          <select className="select" disabled value={game}>
            <option value="wow">World of Warcraft</option>
          </select>
        </label>
        <div className="roster-sheet-grid">
          <label className="roster-sheet-field">
            <span>Clase</span>
            <select
              className="select"
              onChange={(event) => pickClass(event.target.value)}
              value={className}
            >
              {classes.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="roster-sheet-field">
            <span>Spec actual</span>
            <select
              className="select"
              onChange={(event) => setSpecName(event.target.value)}
              value={specName}
            >
              {classSpecs.map((spec) => (
                <option key={spec.specName} value={spec.specName}>
                  {spec.specName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {classSpecs.length > 1 ? (
          <div className="roster-sheet-offs">
            <span>Off que domina</span>
            <div className="roster-off-picker">
              {classSpecs
                .filter((spec) => spec.specName !== specName)
                .map((spec) => (
                  <button
                    className={`roster-off-chip${offSpecs.includes(spec.specName) ? " roster-off-chip--on" : ""}`}
                    key={spec.specName}
                    onClick={() => toggleOff(spec.specName)}
                    type="button"
                  >
                    <DiscordEmojiImage
                      animated={spec.animated}
                      emojiId={spec.emojiId}
                      fallback={spec.emojiUnicode ?? classEmoji(spec.className)}
                      name={spec.specName}
                      size={16}
                    />
                    {spec.specName}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
        <div className="roster-sheet-alts">
          <span>Clases secundarias</span>
          {alts.map((alt, index) => (
            <div className="roster-alt-row" key={index}>
              <select
                className="select"
                onChange={(event) => updateAltClass(index, event.target.value)}
                value={alt.className}
              >
                {classes
                  .filter((entry) => entry !== className)
                  .filter(
                    (entry) =>
                      entry === alt.className ||
                      !alts.some((other) => other.className === entry),
                  )
                  .map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
              </select>
              <select
                className="select"
                onChange={(event) => updateAltSpec(index, event.target.value)}
                value={alt.specName}
              >
                {altSpecsFor(alt.className).map((spec) => (
                  <option key={spec.specName} value={spec.specName}>
                    {spec.specName}
                  </option>
                ))}
              </select>
              <button
                className="ghost-button roster-alt-action"
                onClick={() => makeMain(index)}
                title="Pasar esta clase a principal"
                type="button"
              >
                Hacer main
              </button>
              <button
                aria-label={`Quitar ${alt.className}`}
                className="ghost-button roster-alt-action"
                onClick={() => removeAlt(index)}
                type="button"
              >
                ✕
              </button>
            </div>
          ))}
          {unusedClasses.length > 0 && alts.length < 4 ? (
            <button
              className="ghost-button roster-alt-add"
              onClick={addAlt}
              type="button"
            >
              + Agregar clase
            </button>
          ) : null}
        </div>
        <div className="form-actions">
          <button
            className="primary-button"
            disabled={saving || !className || !specName}
            onClick={() =>
              onSave({
                alts,
                className,
                game,
                offSpecs,
                specName,
                tags: profile?.tags ?? [],
              })
            }
            type="button"
          >
            {saving ? "Guardando…" : "Guardar ficha"}
          </button>
          <button
            className="ghost-button cancel-button"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
        </div>
        {canDelete && profile ? (
          <button
            className="danger-button roster-delete-button"
            onClick={onDelete}
            type="button"
          >
            Eliminar ficha
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Etiqueta del estado del roster. `guild` (officer) no es un estado y se
// muestra aparte, así que acá no tiene etiqueta.
function rosterRankLabel(rank: RosterRankKey | null): string {
  if (rank === "raid") {
    return "Activo";
  }
  if (rank === "bench") {
    return "Bench";
  }
  return "Inactivo";
}

// Admin → Mapeo: relaciona una entidad de la app (un rango del roster, una
// clase) con su rol y/o emoji de Discord. El resto de los módulos lee de acá.
function AdminMappingsSection({
  guildId,
  notify,
}: {
  guildId: string;
  notify: (message: string, kind: "error" | "success") => void;
}) {
  const [groups, setGroups] = useState<MappingGroup[]>([]);
  const [roles, setRoles] = useState<GuildRoleDetail[]>([]);
  // Posición del rol más alto del bot: arriba de eso no puede asignar.
  const [botTopPosition, setBotTopPosition] = useState(0);
  const [emojis, setEmojis] = useState<GuildEmoji[]>([]);
  const [draft, setDraft] = useState<
    Record<string, { emojiId?: string; roleId?: string; unicode?: string }>
  >({});
  const [loading, setLoading] = useState(true);
  // El catálogo no cargó: guardar en ese estado borraría los mapeos.
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Fila con el selector de emojis abierto: solo una a la vez.
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([
      getGuildMappings(guildId),
      getGuildRolesDetailed(guildId),
      getGuildEmojis(guildId).catch(() => [] as GuildEmoji[]),
    ])
      .then(([nextGroups, rolesResponse, guildEmojis]) => {
        if (cancelled) {
          return;
        }
        setGroups(nextGroups);
        setRoles(rolesResponse.roles);
        setBotTopPosition(rolesResponse.botTopPosition);
        setEmojis(guildEmojis);
        setDraft(
          Object.fromEntries(
            nextGroups.flatMap((group) =>
              group.rows.map((row) => [
                row.key,
                {
                  emojiId: row.emoji?.emojiId,
                  roleId: row.roleId,
                  // Los emojis unicode se guardan tal cual: si no se
                  // conservan, guardar los borraba (quedaban como "sin emoji").
                  unicode: row.emoji?.unicode,
                },
              ]),
            ),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
          notify("No se pudieron cargar los mapeos.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [guildId, notify]);

  function patch(
    key: string,
    value: { emojiId?: string; roleId?: string; unicode?: string },
  ): void {
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], ...value },
    }));
  }

  // Por qué el hub no podría mover ese rol en Discord. Sin side effects: mira
  // la lista real de roles y hasta dónde llega el bot.
  function roleWarning(roleId: string | undefined): string | null {
    if (!roleId) {
      return null;
    }
    const role = roles.find((entry) => entry.id === roleId);
    if (!role) {
      return "Ese rol ya no existe en el servidor. Volvé a elegirlo.";
    }
    if (role.managed) {
      return "Es un rol de integración: Discord no deja asignarlo a mano.";
    }
    if (botTopPosition > 0 && role.position >= botTopPosition) {
      return "El rol del bot está más abajo: no puede asignarlo. Subí el rol del bot.";
    }
    return null;
  }

  async function save(): Promise<void> {
    const rows = Object.entries(draft);
    // El API reemplaza el catálogo entero: si llegara vacío, borraría todos los
    // mapeos de la guild. Un guardado sin nada cargado es un error, no un
    // "vaciar todo".
    if (rows.length === 0) {
      notify(
        "No hay mapeos cargados para guardar. Recargá la página.",
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      await saveGuildMappings(
        guildId,
        rows.map(([key, row]) => ({
          emoji: row.emojiId
            ? {
                emojiId: row.emojiId,
                emojiName:
                  emojis.find((emoji) => emoji.id === row.emojiId)?.name ??
                  "emoji",
              }
            : row.unicode
              ? { unicode: row.unicode }
              : undefined,
          key,
          roleId: row.roleId || undefined,
        })),
      );
      notify("Mapeos guardados.", "success");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No se pudieron guardar los mapeos.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingState label="Cargando mapeos…" />;
  }

  return (
    <details open className="admin-card admin-card-acc admin-card--admin">
      <summary className="admin-card-header admin-acc-header">
        <div>
          <h3>
            Mapeo <span className="admin-tier-badge tier-admin">Admin</span>
          </h3>
        </div>
        <span className="admin-acc-chevron" aria-hidden="true">
          ▸
        </span>
      </summary>
      <div className="admin-card-body">
        {groups.map((group) => (
          // Mismos sub-cards que usa el módulo de Eventos (`.event-template-picker`):
          // antes eran filas planas separadas por una línea y se veían como otra UI.
          // Todos arrancan colapsados: son 4 catálogos y abrirlos todos deja el
          // panel larguísimo.
          <details className="event-template-picker mapping-group" key={group.key}>
            <summary>
              <strong>{group.label}</strong>
              <span className="sub-card-count">
                {group.rows.filter((row) => draft[row.key]?.emojiId).length} de{" "}
                {group.rows.length} con emoji
              </span>
              <span className="admin-acc-chevron" aria-hidden="true">
                ▸
              </span>
            </summary>
            <div className="mapping-group-body">
              <div className="form-grid">
                {group.rows.map((row) => {
                  const emojiId = draft[row.key]?.emojiId;
                  const emoji = emojis.find((entry) => entry.id === emojiId);
                  const warning = roleWarning(draft[row.key]?.roleId);
                  return (
                    <div className="mapping-item" key={row.key}>
                      <label>
                        <span>{row.label}</span>
                        <div className="mapping-field">
                          <select
                            aria-label={`Rol de ${row.label}`}
                            className="select"
                            onChange={(event) =>
                              patch(row.key, { roleId: event.target.value })
                            }
                            value={draft[row.key]?.roleId ?? ""}
                          >
                            <option value="">Sin rol</option>
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className={`mapping-emoji-button${emoji ? " active" : ""}`}
                            onClick={() =>
                              setEmojiPickerFor((current) =>
                                current === row.key ? null : row.key,
                              )
                            }
                            title={emoji ? `:${emoji.name}:` : "Elegir emoji"}
                            type="button"
                          >
                            {emoji ? (
                              <DiscordEmojiImage
                                animated={emoji.animated}
                                emojiId={emoji.id}
                                name={emoji.name}
                                size={20}
                              />
                            ) : (
                              "＋"
                            )}
                          </button>
                        </div>
                      </label>
                      {warning ? (
                        <p className="mapping-warning">{warning}</p>
                      ) : null}
                      {emojiPickerFor === row.key ? (
                        <div className="spec-emoji-grid">
                          {emojis.map((entry) => {
                            const selected = emojiId === entry.id;
                            return (
                              <button
                                className={`spec-emoji-option${selected ? " active" : ""}`}
                                key={entry.id}
                                onClick={() =>
                                  patch(row.key, {
                                    emojiId: selected ? undefined : entry.id,
                                  })
                                }
                                title={
                                  selected
                                    ? `Quitar :${entry.name}:`
                                    : `:${entry.name}:`
                                }
                                type="button"
                              >
                                <DiscordEmojiImage
                                  animated={entry.animated}
                                  emojiId={entry.id}
                                  name={entry.name}
                                  size={22}
                                />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        ))}
      </div>
      <div className="admin-card-footer">
        {loadFailed ? (
          <p className="mapping-warning">
            El catálogo no cargó: guardar en este estado borra los mapeos.
            Recargá la página.
          </p>
        ) : null}
        <button
          className="primary-button"
          disabled={saving || loadFailed}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Guardando…" : "Guardar mapeos"}
        </button>
      </div>
    </details>
  );
}

function RosterSection({
  canEditOthers,
  guildId,
  guildRoles,
  meId,
  notify,
  onOpenProfile,
}: {
  canEditOthers: boolean;
  guildId: string;
  guildRoles: GuildRole[];
  meId?: string;
  notify: (message: string, kind: "error" | "success") => void;
  onOpenProfile: (userId: string) => void;
}) {
  const [roster, setRoster] = useState<GuildRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sheetFor, setSheetFor] = useState<{
    displayName: string;
    userId: string;
  } | null>(null);
  const [savingSheet, setSavingSheet] = useState(false);
  // Tarjeta con el menú de estado abierto: solo una a la vez.
  const [rankMenuFor, setRankMenuFor] = useState<string | null>(null);
  // Clase que está al frente en el mazo de cada persona (id -> className).
  // Ausente = la principal.
  const [frontSetByUser, setFrontSetByUser] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getGuildRoster(guildId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setRoster(data);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  // Cierra el menú de estado al clickear en cualquier otro lado.
  useEffect(() => {
    if (!rankMenuFor) {
      return;
    }
    const close = () => setRankMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [rankMenuFor]);

  const specsByKey = useMemo(() => {
    const map = new Map<string, RaidSpec>();
    for (const spec of roster?.specs ?? []) {
      map.set(rosterSpecKey(spec.game, spec.className, spec.specName), spec);
    }
    return map;
  }, [roster]);

  const query = search.trim().toLowerCase();
  const members = (roster?.members ?? []).filter(
    (member) =>
      member.rankKey === "raid" ||
      member.rankKey === "bench" ||
      member.isRaidOfficer ||
      (member.rankKey === null && member.profile),
  );

  // Color del rol de Raid Officer (el que se mapeó en Admin → Mapeo), para que
  // la etiqueta se vea como el rol en Discord.
  const raidOfficerColors = useMemo(() => {
    const roleId = (roster?.ranks ?? []).find(
      (rank) => rank.key === "guild",
    )?.roleId;
    const role = guildRoles.find((entry) => entry.id === roleId);
    return {
      primary: roleColorHex(role?.color) ?? "#c98a1b",
      secondary: roleColorHex(role?.secondaryColor),
    };
  }, [guildRoles, roster]);

  function memberRole(member: RosterMember): string {
    const profile = member.profile;
    if (!profile) {
      return "unknown";
    }
    return (
      specsByKey.get(
        rosterSpecKey(profile.game, profile.className, profile.specName),
      )?.role ?? "unknown"
    );
  }

  // Estado del filtro: los mismos tres que muestra la tarjeta. Sin ficha la
  // tarjeta está incompleta y no entra en el filtro de estado.
  function memberStatusKey(member: RosterMember): string | null {
    if (!member.profile) {
      return null;
    }
    return member.rankKey === "raid"
      ? "raid"
      : member.rankKey === "bench"
        ? "bench"
        : "inactivo";
  }

  const availableTags = tagOptionsFrom(
    members.map((member) => ({ tags: member.profile?.tags ?? [] })),
  ).sort((left, right) => left.label.localeCompare(right.label, "es"));
  const visible = members
    .filter(
      (member) =>
        roleFilter.length === 0 || roleFilter.includes(memberRole(member)),
    )
    .filter((member) => {
      if (statusFilter.length === 0) {
        return true;
      }
      const status = memberStatusKey(member);
      return status !== null && statusFilter.includes(status);
    })
    .filter((member) => matchesTagFilter(member.profile?.tags ?? [], tagFilter))
    .filter((member) => {
      if (!query) {
        return true;
      }
      return `${member.displayName} ${member.profile?.className ?? ""} ${member.profile?.specName ?? ""} ${(member.profile?.offSpecs ?? []).join(" ")} ${(member.alts ?? []).map((alt) => `${alt.className} ${alt.specName}`).join(" ")} ${(member.profile?.tags ?? []).map((tag) => tag.label).join(" ")}`
        .toLowerCase()
        .includes(query);
    });

  async function saveSheet(input: RosterProfileInput): Promise<void> {
    const target = sheetFor;
    if (!target) {
      return;
    }
    setSavingSheet(true);
    try {
      const saved =
        target.userId === meId
          ? await saveMyRosterProfile(guildId, input)
          : await saveMemberRosterProfile(guildId, target.userId, input);
      const profile = saved.profile;
      setRoster((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.userId === target.userId
                  ? { ...member, alts: saved.alts ?? [], profile }
                  : member,
              ),
            }
          : current,
      );
      // La carta que estaba al frente puede haber dejado de existir (o pasar a
      // ser la principal): se vuelve a la principal.
      setFrontSetByUser((current) => {
        const next = { ...current };
        delete next[target.userId];
        return next;
      });
      setSheetFor(null);
      notify(
        saved.roleSyncError
          ? `Ficha guardada, pero Discord: ${saved.roleSyncError}`
          : "Ficha guardada.",
        saved.roleSyncError ? "error" : "success",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "No se pudo guardar la ficha.",
        "error",
      );
    } finally {
      setSavingSheet(false);
    }
  }

  // Cambia el estado de la ficha. El estado ES el rol de Discord del miembro,
  // así que la tarjeta se actualiza con el rango que devuelve el API.
  async function changeProfileRank(
    member: RosterMember,
    rank: RosterRankKey | null,
  ): Promise<void> {
    if (!canEditOthers) {
      return;
    }
    try {
      const result = await setRosterRank(guildId, member.userId, rank);
      setRoster((current) =>
        current
          ? {
              ...current,
              members: current.members.map((row) =>
                row.userId === member.userId
                  ? { ...row, rankKey: result.rank }
                  : row,
              ),
            }
          : current,
      );
      const label = `Estado: ${rosterRankLabel(result.rank)}.`;
      notify(
        result.roleSyncError
          ? `${label} Pero Discord: ${result.roleSyncError}`
          : label,
        result.roleSyncError ? "error" : "success",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No se pudo cambiar el estado.",
        "error",
      );
    }
  }

  // Quitar del roster: saca los roles de estado en Discord y deja la ficha
  // inactiva, así la tarjeta desaparece de la lista (la clase/spec quedan
  // guardadas y vuelven si se le pone un rol de estado otra vez).
  async function removeFromRoster(member: RosterMember): Promise<void> {
    if (!canEditOthers) {
      return;
    }
    try {
      const result = await removeRosterMember(guildId, member.userId);
      setRoster((current) =>
        current
          ? {
              ...current,
              members: current.members.filter(
                (row) => row.userId !== member.userId,
              ),
            }
          : current,
      );
      notify(
        result.roleSyncError
          ? `Quitado del roster. Pero Discord: ${result.roleSyncError}`
          : "Quitado del roster.",
        result.roleSyncError ? "error" : "success",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No se pudo quitar del roster.",
        "error",
      );
    }
  }

  async function deleteProfile(): Promise<void> {
    const target = sheetFor;
    if (!target || !canEditOthers) {
      return;
    }
    if (!window.confirm("¿Eliminar esta ficha del roster?")) {
      return;
    }
    try {
      await deleteMemberRosterProfile(guildId, target.userId);
      setRoster((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.userId === target.userId
                  ? { ...member, profile: null }
                  : member,
              ),
            }
          : current,
      );
      setSheetFor(null);
      notify("Ficha eliminada.", "success");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la ficha.",
        "error",
      );
    }
  }

  function renderMember(member: RosterMember) {
    const profile = member.profile;
    // Mazo de cartas: la principal (RosterProfile) y sus clases secundarias.
    // Los alters son la misma persona, así que no suman a ningún total.
    const sets = profile
      ? [
          {
            className: profile.className,
            game: profile.game,
            isMain: true,
            offSpecs: profile.offSpecs,
            specName: profile.specName,
          },
          ...(member.alts ?? []).map((alt) => ({
            className: alt.className,
            game: alt.game ?? profile.game,
            isMain: false,
            offSpecs: alt.offSpecs ?? [],
            specName: alt.specName,
          })),
        ]
      : [];
    const frontSet =
      sets.find((set) => set.className === frontSetByUser[member.userId]) ??
      sets[0] ??
      null;
    const backSets = sets.filter((set) => set !== frontSet);
    const main = frontSet
      ? specsByKey.get(
          rosterSpecKey(frontSet.game, frontSet.className, frontSet.specName),
        )
      : undefined;
    // Emoji de la clase desde el registro central (Admin → Mapeo).
    const classEmojiMeta = frontSet
      ? roster?.classEmojis?.[frontSet.className]
      : undefined;
    const isRaidOfficer = member.isRaidOfficer;
    // El estado va con la ficha, sin importar si es Raid Officer: son cosas
    // distintas y se puede ser Raid Officer e inactivo a la vez.
    const rosterStatus = profile ? rosterRankLabel(member.rankKey) : null;
    const canToggleStatus = canEditOthers && rosterStatus !== null;
    // La tarjeta entera abre la edición: el lápiz flotante quedaba descolgado
    // en el medio cuando la tarjeta era ancha.
    const canEditCard = canEditOthers || member.userId === meId;
    const rosterStatusClass = rosterStatus
      ? rosterStatus.toLowerCase().replaceAll(" ", "-")
      : "";
    return (
      <div
        // Con el menú abierto el mazo sube de capa: si no, la tarjeta de la fila
        // de abajo (se pinta después) le tapa las últimas opciones.
        className={`roster-stack${rankMenuFor === member.userId ? " roster-stack--menu-open" : ""}`}
        key={member.userId}
      >
        {backSets.map((set, index) => (
          <button
            aria-label={`Traer al frente: ${set.className} ${set.specName}`}
            className={`roster-member roster-member--back roster-member--back-${index + 1}`}
            key={set.className}
            onClick={(event) => {
              event.stopPropagation();
              setFrontSetByUser((current) => ({
                ...current,
                [member.userId]: set.className,
              }));
            }}
            style={
              {
                "--roster-class-color": classColor(set.className) ?? "#6aa8ff",
              } as CSSProperties
            }
            type="button"
          />
        ))}
        <article
          className={`roster-member roster-member--front${member.rankKey ? "" : " roster-member--inactive"}${canEditCard ? " roster-member--editable" : ""}`}
          onClick={
            canEditCard
              ? () =>
                  setSheetFor({
                    displayName:
                      member.userId === meId ? "Mi ficha" : member.displayName,
                    userId: member.userId,
                  })
              : undefined
          }
          title={canEditCard ? "Editar ficha" : undefined}
          style={
            {
              "--roster-class-color":
                classColor(frontSet?.className) ?? "#6aa8ff",
            } as CSSProperties
          }
        >
        {isRaidOfficer ? (
          <span
            className="roster-officer-flag"
            style={
              {
                "--roster-officer-color": raidOfficerColors.primary,
                "--roster-officer-color-2":
                  raidOfficerColors.secondary ?? raidOfficerColors.primary,
              } as CSSProperties
            }
          >
            Raid Officer
          </span>
        ) : null}
        <div className="roster-member-main">
          <button
            className="member-link roster-member-name"
            onClick={(event) => {
              // La tarjeta entera edita: el nombre sigue abriendo el perfil.
              event.stopPropagation();
              onOpenProfile(member.userId);
            }}
            type="button"
          >
            {member.displayName}
          </button>
          {frontSet ? (
            <span className="roster-member-spec">
              {main || classEmojiMeta ? (
                <DiscordEmojiImage
                  animated={
                    main?.emojiId
                      ? main.animated
                      : Boolean(classEmojiMeta?.animated)
                  }
                  emojiId={main?.emojiId ?? classEmojiMeta?.emojiId}
                  fallback={
                    classEmojiMeta?.unicode ?? classEmoji(frontSet.className)
                  }
                  name={main?.specName ?? frontSet.className}
                  size={18}
                />
              ) : null}
              {frontSet.specName}
              {frontSet.isMain ? null : (
                <span className="roster-alt-badge">Alter</span>
              )}
            </span>
          ) : (
            <span className="roster-member-spec">Sin ficha</span>
          )}
        </div>
        {frontSet && frontSet.offSpecs.length > 0 ? (
          <div className="roster-member-offs">
            {frontSet.offSpecs.map((off) => {
              const spec = specsByKey.get(
                rosterSpecKey(frontSet.game, frontSet.className, off),
              );
              return (
                <span className="roster-off" key={off}>
                  {spec ? (
                    <DiscordEmojiImage
                      animated={spec.animated}
                      emojiId={spec.emojiId}
                      fallback={classEmoji(frontSet.className)}
                      name={off}
                      size={14}
                    />
                  ) : null}
                  {off}
                </span>
              );
            })}
          </div>
        ) : null}
        {sets.length > 1 ? (
          <div className="roster-set-tabs">
            {sets.map((set) => {
              const spec = specsByKey.get(
                rosterSpecKey(set.game, set.className, set.specName),
              );
              const meta = roster?.classEmojis?.[set.className];
              return (
                <button
                  className={`roster-set-tab${set === frontSet ? " roster-set-tab--on" : ""}${set.isMain ? "" : " roster-set-tab--alter"}`}
                  key={set.className}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFrontSetByUser((current) => ({
                      ...current,
                      [member.userId]: set.className,
                    }));
                  }}
                  style={
                    {
                      "--roster-class-color":
                        classColor(set.className) ?? "#6aa8ff",
                    } as CSSProperties
                  }
                  title={`${set.className} ${set.specName}${set.isMain ? " (principal)" : " (alter)"}`}
                  type="button"
                >
                  <DiscordEmojiImage
                    animated={spec?.emojiId ? spec.animated : Boolean(meta?.animated)}
                    emojiId={spec?.emojiId ?? meta?.emojiId}
                    fallback={meta?.unicode ?? classEmoji(set.className)}
                    name={set.specName}
                    size={14}
                  />
                  {set.specName}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="roster-flags">
          {rosterStatus ? (
            canToggleStatus ? (
              <div className="roster-status-menu">
                <button
                  className={`roster-status-badge roster-status-badge--${rosterStatusClass}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRankMenuFor((current) =>
                      current === member.userId ? null : member.userId,
                    );
                  }}
                  title="Cambiar estado en el roster"
                  type="button"
                >
                  {rosterStatus}
                </button>
                {rankMenuFor === member.userId ? (
                  <div className="roster-status-options">
                    {(roster?.ranks ?? [])
                      .filter(
                        (rank) => rank.key === "raid" || rank.key === "bench",
                      )
                      .map((rank) => (
                        <button
                          className={`roster-status-option roster-status-option--${rosterRankLabel(rank.key).toLowerCase()}`}
                          key={rank.key}
                          onClick={(event) => {
                            event.stopPropagation();
                            setRankMenuFor(null);
                            void changeProfileRank(member, rank.key);
                          }}
                          type="button"
                        >
                          {rosterRankLabel(rank.key)}
                        </button>
                      ))}
                    <button
                      className="roster-status-option roster-status-option--inactivo"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRankMenuFor(null);
                        void changeProfileRank(member, null);
                      }}
                      type="button"
                    >
                      Inactivo
                    </button>
                    <span className="roster-status-separator" />
                    <button
                      className="roster-status-option roster-status-option--quitar"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRankMenuFor(null);
                        void removeFromRoster(member);
                      }}
                      title="Saca los roles de Raid y Bench en Discord y la ficha del roster (la clase y la spec quedan guardadas)"
                      type="button"
                    >
                      Quitar del roster
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <span
                className={`roster-status-badge roster-status-badge--${rosterStatusClass}`}
              >
                {rosterStatus}
              </span>
            )
          ) : null}
        </div>
        </article>
      </div>
    );
  }

  function renderMembers(rows: RosterMember[]) {
    const byRole = new Map<string, RosterMember[]>();
    for (const row of rows) {
      const role = memberRole(row);
      byRole.set(role, [...(byRole.get(role) ?? []), row]);
    }
    const roleOrder = ["melee", "ranged", "healer", "tank", "unknown"];
    return [...byRole.entries()]
      .sort(
        ([left], [right]) => roleOrder.indexOf(left) - roleOrder.indexOf(right),
      )
      .map(([role, roleRows]) => {
        const meta = roster?.roles.find((entry) => entry.key === role);
        const fallback = ROLE_META.find((entry) => entry.key === role);
        const label =
          role === "ranged"
            ? "Ranged"
            : (meta?.label ?? fallback?.label ?? "Sin rol");
        return (
          <div className="roster-role" key={role}>
            <span className="roster-role-title">
              <DiscordEmojiImage
                animated={meta?.animated ?? false}
                emojiId={meta?.emojiId}
                fallback={meta?.emoji ?? fallback?.emoji ?? "❔"}
                name={meta?.emojiName ?? label}
                size={20}
              />
              {label}
              <span className="roster-role-count">{roleRows.length}</span>
            </span>
            {roleRows.map((row) => renderMember(row))}
          </div>
        );
      });
  }

  return (
    <div className="roster-view">
      <div className="roster-toolbar">
        <button
          className="primary-button"
          disabled={!meId}
          onClick={() =>
            meId && setSheetFor({ displayName: "Mi ficha", userId: meId })
          }
          type="button"
        >
          Agregar ficha
        </button>
        <input
          className="list-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar jugador, clase o spec…"
          type="search"
          value={search}
        />
        <div className="roster-filter-chips">
          <div className="roster-filter-group">
            <span className="roster-filter-label">Estado</span>
            <button
              className={`event-filter-chip${statusFilter.length === 0 ? " active" : ""}`}
              onClick={() => setStatusFilter([])}
              type="button"
            >
              Todos
            </button>
            {ROSTER_STATUS_FILTERS.map((status) => (
              <button
                className={`event-filter-chip roster-status-chip roster-status-chip--${status.key}${statusFilter.includes(status.key) ? " active" : ""}`}
                key={status.key}
                onClick={() =>
                  setStatusFilter((current) =>
                    toggleInList(current, status.key),
                  )
                }
                type="button"
              >
                {status.label}
              </button>
            ))}
          </div>
          <div className="roster-filter-group">
            <span className="roster-filter-label">Rol</span>
            <button
              className={`event-filter-chip${roleFilter.length === 0 ? " active" : ""}`}
              onClick={() => setRoleFilter([])}
              type="button"
            >
              Todos
            </button>
            {(roster?.roles ?? ROLE_META).map((role) => (
              <button
                className={`event-filter-chip${roleFilter.includes(role.key) ? " active" : ""}`}
                key={role.key}
                onClick={() =>
                  setRoleFilter((current) => toggleInList(current, role.key))
                }
                type="button"
              >
                {role.label}
              </button>
            ))}
          </div>
          {availableTags.map((tag) => (
            <EventTagFilterChip
              active={tagFilter.includes(tag.label.toLowerCase())}
              color={tag.color}
              key={tag.label}
              label={tag.label}
              onToggle={() =>
                setTagFilter((current) =>
                  toggleInList(current, tag.label.toLowerCase()),
                )
              }
            />
          ))}
        </div>
        <span className="roster-total">
          {visible.length} de {members.length} jugadores
        </span>
      </div>

      {loading ? (
        <LoadingState label="Cargando roster…" />
      ) : failed ? (
        <p className="muted-text">No se pudo cargar el roster.</p>
      ) : (
        <>
          <div className="roster-list">
            {visible.length > 0 ? (
              renderMembers(visible)
            ) : (
              <p className="muted-text">
                No hay jugadores activos del core para mostrar.
              </p>
            )}
          </div>
        </>
      )}

      {sheetFor ? (
        <RosterSheet
          alts={
            members.find((member) => member.userId === sheetFor.userId)?.alts ??
            []
          }
          canDelete={canEditOthers}
          games={roster?.games ?? []}
          memberName={sheetFor.displayName}
          onClose={() => setSheetFor(null)}
          onDelete={() => void deleteProfile()}
          onSave={(input) => void saveSheet(input)}
          profile={
            members.find((member) => member.userId === sheetFor.userId)
              ?.profile ?? null
          }
          saving={savingSheet}
          specs={roster?.specs ?? []}
        />
      ) : null}
    </div>
  );
}

// ── Informe de asistencia (descarga en CSV o PDF) ───────────────────
type ReportFormat = "csv" | "pdf";

// Mismas etiquetas que usa el CSV del API y el informe del bot.
const REPORT_STATUS_LABELS: Record<string, string> = {
  bench: "Bench",
  late: "Llega tarde",
  no: "No asiste",
  yes: "Asiste",
};

// Orden de la lista: primero los que asisten (igual que el roster del hub).
const REPORT_STATUS_ORDER = ["yes", "bench", "late", "no"];

// La fuente estándar de un PDF (Helvetica) no tiene glifos de emoji: en el
// archivo saldrían como cuadraditos, así que se limpian antes de escribirlo.
function pdfPlainText(value: string): string {
  return value
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2100}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

// Arma el PDF del informe en el navegador (mismo contenido que el CSV: los
// anotados con su estado + quiénes tienen el rol mínimo y no se anotaron).
// jsPDF se importa recién al usarlo para que la librería no viaje en el bundle
// inicial.
async function downloadEventReportPdf(
  event: HubEvent,
  missing: string[],
  roleLabels: Map<string, string>,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const rowHeight = 6.4;
  const bottomLimit = pageHeight - 16;

  const columns = [
    { key: "name", label: "Nombre", width: 54 },
    { key: "status", label: "Estado", width: 24 },
    { key: "role", label: "Rol", width: 22 },
    { key: "class", label: "Clase", width: 24 },
    { key: "spec", label: "Spec", width: 26 },
    { key: "character", label: "Personaje", width: 36 },
  ];
  // La última columna absorbe lo que sobra para que la tabla cierre al borde.
  const fixedWidth = columns.reduce((sum, column) => sum + column.width, 0);
  columns[columns.length - 1].width += contentWidth - fixedWidth;

  // Recorta el texto al ancho de la celda (con puntos suspensivos) para que no
  // se monte sobre la columna de al lado.
  const fit = (value: string, width: number): string => {
    if (doc.getTextWidth(value) <= width) {
      return value;
    }
    let trimmed = value;
    while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > width) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
  };

  const rows = [...(event.signups ?? [])]
    .sort((left, right) => {
      // Un estado que no esté en la lista (dato viejo) va al final, no primero.
      const rank = (status: string): number => {
        const index = REPORT_STATUS_ORDER.indexOf(status);
        return index === -1 ? REPORT_STATUS_ORDER.length : index;
      };
      const leftRank = rank(left.status);
      const rightRank = rank(right.status);
      return leftRank === rightRank
        ? left.username.localeCompare(right.username)
        : leftRank - rightRank;
    })
    .map((signup) => [
      signup.username,
      REPORT_STATUS_LABELS[signup.status] ?? signup.status,
      signup.role ? (roleLabels.get(signup.role) ?? signup.role) : "",
      signup.wowClass ?? "",
      signup.spec ?? "",
      signup.character ?? "",
    ]);

  let y = 34;

  // Encabezado
  doc.setFillColor(15, 22, 41);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Informe de asistencia", marginX, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(fit(pdfPlainText(event.title), contentWidth), marginX, 20);

  doc.setTextColor(45, 55, 75);
  doc.setFontSize(10);
  doc.text(`Evento: ${formatDateTime24(event.startsAt)}`, marginX, y);
  y += 5.5;
  doc.text(
    `Anotados: ${rows.length}` +
      (missing.length > 0 ? ` · Sin anotarse: ${missing.length}` : ""),
    marginX,
    y,
  );
  y += 8;

  const drawTableHead = (): void => {
    doc.setFillColor(226, 232, 240);
    doc.rect(marginX, y - 4.6, contentWidth, rowHeight, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(31, 41, 55);
    let x = marginX;
    for (const column of columns) {
      doc.text(fit(column.label, column.width - 4), x + 2, y);
      x += column.width;
    }
    doc.setFont("helvetica", "normal");
    y += rowHeight;
  };

  const newPage = (): void => {
    doc.addPage();
    y = 20;
  };

  drawTableHead();
  doc.setFontSize(9);
  doc.setTextColor(45, 55, 75);

  if (rows.length === 0) {
    doc.text("Sin inscripciones.", marginX, y);
    y += rowHeight;
  }

  rows.forEach((row, index) => {
    if (y > bottomLimit) {
      newPage();
      drawTableHead();
      doc.setFontSize(9);
      doc.setTextColor(45, 55, 75);
    }
    if (index % 2 === 1) {
      doc.setFillColor(243, 245, 249);
      doc.rect(marginX, y - 4.6, contentWidth, rowHeight, "F");
    }
    let x = marginX;
    row.forEach((cell, cellIndex) => {
      const column = columns[cellIndex];
      doc.text(fit(pdfPlainText(cell), column.width - 4), x + 2, y);
      x += column.width;
    });
    y += rowHeight;
  });

  // Quiénes tienen el rol mínimo y no se anotaron.
  if (missing.length > 0) {
    if (y + 16 > bottomLimit) {
      newPage();
    }
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(31, 41, 55);
    doc.text(
      `No se anotaron (${missing.length} con el rol mínimo)`,
      marginX,
      y,
    );
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(45, 55, 75);
    const lines = doc.splitTextToSize(
      pdfPlainText(missing.join(" · ")),
      contentWidth,
    ) as string[];
    for (const line of lines) {
      if (y > bottomLimit) {
        newPage();
      }
      doc.text(line, marginX, y);
      y += 5;
    }
  }

  // Pie de página con el paginado (se recorre al final porque recién ahí se
  // sabe cuántas hojas tiene el informe).
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 140, 160);
    doc.text("Bonafide", marginX, pageHeight - 8);
    doc.text(
      `Página ${page} de ${pageCount}`,
      pageWidth - marginX,
      pageHeight - 8,
      { align: "right" },
    );
  }

  doc.save(`informe-${slugifyTitle(event.title) || "evento"}.pdf`);
}

// Elección del formato del informe. Es un modal y no un menú desplegable
// porque la tarjeta del evento tiene `overflow: hidden`: cualquier panel
// flotante adentro quedaría recortado.
function ReportFormatModal({
  busy,
  onClose,
  onSelect,
  title,
}: {
  busy: boolean;
  onClose: () => void;
  onSelect: (format: ReportFormat) => void;
  title: string;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-modal="true"
        className="modal report-format-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h4>Descargar informe</h4>
        <p className="confirm-message">{title}</p>
        <div className="report-format-options">
          <button
            className="report-format-option"
            disabled={busy}
            onClick={() => onSelect("csv")}
            type="button"
          >
            <span aria-hidden="true" className="report-format-icon">
              📄
            </span>
            <strong>CSV</strong>
          </button>
          <button
            className="report-format-option"
            disabled={busy}
            onClick={() => onSelect("pdf")}
            type="button"
          >
            <span aria-hidden="true" className="report-format-icon">
              📕
            </span>
            <strong>PDF</strong>
          </button>
        </div>
        <div className="form-actions">
          <button
            className="ghost-button cancel-button"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// Tarjeta de evento del Módulo X: muestra info, roster e inscripción del
// usuario logueado (clase, rol, personaje y estado).
function EventCard({
  canManage,
  config,
  event,
  // Evento de la plantilla de encuesta: la votación vive en Discord (poll
  // nativo), así que la tarjeta no muestra el bloque de inscripción.
  eventPoll,
  guildRoles,
  gameRoles,
  meId,
  onDelete,
  onDownloadReport,
  onDuplicate,
  onEdit,
  onOpenProfile,
  onRemoveSignup,
  onResetOccurrence,
  onResetSignup,
  onSignup,
  onStaffRemoveSignup,
  onStaffSignup,
  reportBusy = false,
  specs,
}: {
  canManage: boolean;
  config: GuildConfig;
  event: HubEvent;
  // true = el juego del evento publica una encuesta nativa en Discord.
  eventPoll?: boolean;
  guildRoles: GuildRole[];
  // Roles de inscripción del JUEGO del evento.
  gameRoles: EventRoleOption[];
  meId?: string;
  onDelete: (event: HubEvent) => void;
  // Descarga el informe de asistencia del evento (planilla o PDF).
  onDownloadReport: (event: HubEvent, format: ReportFormat) => void;
  onDuplicate: (event: HubEvent) => void;
  onEdit: (event: HubEvent) => void;
  // Abre el perfil del miembro clickeado en el roster.
  onOpenProfile: (userId: string) => void;
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
  // El informe de este evento se está generando (deja el botón en espera).
  reportBusy?: boolean;
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
  // Elección de formato del informe (modal con CSV / PDF).
  const [downloadOpen, setDownloadOpen] = useState(false);
  // Avisar por MD al miembro de qué le cambió (arranca encendido: es el
  // motivo por el que el staff abre el editor).
  const [staffNotify, setStaffNotify] = useState(true);
  // Control del roster: el contador "confirmados / esperados" (los que tienen
  // el rol mínimo del evento). La lista de los que faltan se pide recién al
  // abrir el modal: en la API es staff-only, así que si falla se avisa ahí.
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  async function openRoster(): Promise<void> {
    setRosterOpen(true);
    if (roster || rosterLoading) {
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      setRoster(await getEventRoster(event.guildId, event.id));
    } catch (error) {
      setRosterError(
        error instanceof Error ? error.message : "No se pudo cargar el roster.",
      );
    } finally {
      setRosterLoading(false);
    }
  }

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
  const isPoll = eventPoll === true;
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
  // Cuánto dura, en horas: va al lado de la hora de fin ("Termina 00:00 (3 hs)").
  const durationHours = event.durationMinutes
    ? `${hoursFromMinutes(event.durationMinutes)} hs`
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
    const specRow =
      specs.find(
        (row) =>
          row.role === signup.role &&
          row.className === signup.wowClass &&
          row.specName === (signup.spec ?? ""),
      ) ??
      // No eligió clase en el evento (p. ej. sólo marcó "no asisto"): se muestra
      // la del roster, que es la ficha que ya tiene cargada. Mismo emoji: no
      // cambia la columna ni la inscripción.
      (signup.rosterClass
        ? specs.find(
            (row) =>
              row.className === signup.rosterClass?.className &&
              row.specName === signup.rosterClass?.specName,
          )
        : undefined);
    return (
      <span className="event-roster-entry" key={signup.id}>
        <span className="event-roster-member">
          <DiscordEmojiImage
            animated={specRow?.animated}
            emojiId={specRow?.emojiId}
            fallback={specRow?.emojiUnicode}
            name={specRow?.specName}
          />
          <button
            className="member-link"
            onClick={() => onOpenProfile(signup.userId)}
            title="Ver perfil"
            type="button"
          >
            {signup.username}
            {signup.character ? ` (${signup.character})` : ""}
          </button>
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
              <span className="event-info-label">🏁 Termina</span>
              <span className="event-info-value">
                {endAt && durationHours
                  ? `${formatDateTime24(endAt)} (${durationHours})`
                  : "—"}
              </span>
            </div>{" "}
            {isPoll ? (
              <div className="event-info-item">
                <span className="event-info-label">📊 Encuesta</span>
                <span className="event-info-value">
                  {event.pollHours
                    ? `Abierta ${event.pollHours} h`
                    : "24 h (por defecto)"}
                </span>
              </div>
            ) : null}
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
              {/* El total lleva el contador de control cuando el evento tiene rol
                  mínimo: "confirmados (+tentativos) / esperados". Se clickea para
                  ver quiénes faltan (staff). */}
              {event.expectedCount && event.expectedCount > 0 ? (
                <button
                  className="event-count total roster-goal"
                  disabled={!canManage}
                  onClick={() => void openRoster()}
                  title={
                    canManage
                      ? "Ver quiénes faltan anotarse"
                      : "Control del roster (solo staff)"
                  }
                  type="button"
                >
                  👥 {counts.yes}
                  {counts.bench + counts.late > 0
                    ? ` (+${counts.bench + counts.late})`
                    : ""}
                  {` / ${event.expectedCount}`}
                </button>
              ) : (
                <span className="event-count total">
                  👥 {counts.yes}
                  {counts.bench + counts.late > 0
                    ? ` (+${counts.bench + counts.late})`
                    : ""}
                </span>
              )}
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

          {isPoll ? (
            <div className="event-form-note">
              📊 La votación se hace en la encuesta publicada en Discord (✅ SI
              · ❌ NO).
            </div>
          ) : null}
          {meId && !isPoll ? (
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
                            (Admin → Eventos).
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
                                          fallback={row.emojiUnicode}
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
                              fallback={
                                currentSpecRow?.emojiUnicode ??
                                classEmoji(wowClass)
                              }
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
              <button
                className="csv-button"
                disabled={reportBusy}
                onClick={() => setDownloadOpen(true)}
                type="button"
              >
                {reportBusy ? "Generando…" : "⬇️ Descargar informe"}
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

      {/* Elección del formato del informe: va acá afuera porque la tarjeta
          tiene overflow hidden y recortaría cualquier popover. */}
      {downloadOpen ? (
        <ReportFormatModal
          busy={reportBusy}
          onClose={() => setDownloadOpen(false)}
          onSelect={(format) => {
            setDownloadOpen(false);
            onDownloadReport(event, format);
          }}
          title={event.title}
        />
      ) : null}

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
                                  fallback={row.emojiUnicode}
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
                className="ghost-button cancel-button"
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

      {/* Control del roster: quiénes tienen el rol mínimo y todavía no
          respondieron (los que faltan anotarse). */}
      {rosterOpen ? (
        <div className="modal-overlay" onClick={() => setRosterOpen(false)}>
          <div
            className="modal modal-wide"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4>Roster de {event.title}</h4>
            {rosterLoading ? (
              <p className="modal-note">Cargando el roster…</p>
            ) : null}
            {rosterError ? <p className="modal-note">{rosterError}</p> : null}
            {roster ? (
              <>
                <div className="event-roster-summary">
                  <span className="event-count total">
                    👥 {roster.confirmedCount} confirmados
                  </span>
                  {roster.benchCount > 0 ? (
                    <span className="event-count bench">
                      🪑 {roster.benchCount} en bench
                    </span>
                  ) : null}
                  {roster.missing.length > 0 ? (
                    <span className="event-count late">
                      ⏳ Faltan {roster.missing.length}
                    </span>
                  ) : null}
                </div>
                {/* Si no falta nadie no se muestra nada: sin mensajes de relleno. */}
                {roster.missing.length > 0 ? (
                  <div className="event-roster-missing">
                    {roster.missing.map((member) => (
                      <button
                        className={`member-link${member.bench ? " roster-missing-bench" : ""}`}
                        key={member.userId}
                        onClick={() => {
                          setRosterOpen(false);
                          onOpenProfile(member.userId);
                        }}
                        title={
                          member.bench
                            ? "Ver su perfil (está en bench)"
                            : "Ver su perfil"
                        }
                        type="button"
                      >
                        {member.bench ? "🪑 " : ""}
                        {member.username}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setRosterOpen(false)}
                type="button"
              >
                Cerrar
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
}: {
  label: string;
  roles: GuildRole[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
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

// Sub-secciones de una pestaña: cada una es una página propia y el nav las
// ofrece en un submenú al pasar el mouse. Una pestaña sin entrada acá es una
// sola página.
const TAB_SECTIONS: Partial<
  Record<
    HubTab,
    Array<{ key: string; label: string; module?: string; tier?: AccessTier }>
  >
> = {
  raids: [
    { key: "roster", label: "Roster" },
    { key: "logs", label: "Logs" },
  ],
  karuta: [
    { key: "raras", label: "Raras" },
    { key: "coleccion", label: "Colecciones" },
    { key: "guia", label: "Comandos" },
  ],
  admin: [
    {
      key: "config",
      label: "Configuraciones",
      module: "config",
      tier: "admin",
    },
    { key: "mapeo", label: "Mapeo", module: "config", tier: "admin" },
    { key: "karuta", label: "Karuta", module: "karuta", tier: "officer" },
    { key: "modulos", label: "Módulos", module: "config", tier: "owner" },
    { key: "roles", label: "Roles", module: "config", tier: "admin" },
    {
      key: "permisos",
      label: "Permisos",
      module: "config",
      tier: "owner",
    },
    {
      key: "karpindomo",
      label: "Karpindomo",
      module: "daily",
      tier: "officer",
    },
    { key: "xp", label: "XP", module: "xp", tier: "admin" },
    {
      key: "registros",
      label: "Registros",
      module: "config",
      tier: "owner",
    },
    { key: "eventos", label: "Eventos", module: "eventos", tier: "subofficer" },
    {
      key: "historial",
      label: "Historial",
      module: "eventos",
      tier: "subofficer",
    },
  ],
};

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

// Título de la cabecera del módulo: el de la subsección actual, para que
// coincida con dónde estás parado (Roster, Logs de Raid, Raras, Colecciones…).
function currentSectionTitle(
  tab: HubTab,
  section: string,
  fallback: string,
): string {
  if (tab === "raids") {
    return section === "roster"
      ? "Roster"
      : section === "logs"
        ? "Logs de Raid"
        : fallback;
  }
  return (
    TAB_SECTIONS[tab]?.find((entry) => entry.key === section)?.label ?? fallback
  );
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
          <button
            className="ghost-button cancel-button"
            onClick={onClose}
            type="button"
          >
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

// Permisos que ofrece la tarjeta Roles: los que se usan de verdad (los ~50 de
// Discord no se entienden). OJO: al EDITAR un rol los bits que no están en esta
// lista se conservan, porque el formulario trabaja sobre el bitfield completo
// del rol y solo toca los permisos visibles.
const ROLE_PERMISSION_GROUPS: Array<{
  label: string;
  permissions: Array<{ bit: bigint; label: string }>;
}> = [
  {
    label: "General",
    permissions: [
      { bit: 1n << 3n, label: "Administrador (todo)" },
      { bit: 1n << 5n, label: "Gestionar el servidor" },
      { bit: 1n << 28n, label: "Gestionar roles" },
      { bit: 1n << 4n, label: "Gestionar canales" },
      { bit: 1n << 27n, label: "Gestionar apodos" },
      { bit: 1n << 29n, label: "Gestionar webhooks" },
      { bit: 1n << 33n, label: "Gestionar eventos" },
      { bit: 1n << 7n, label: "Ver la auditoría" },
      { bit: 1n << 0n, label: "Crear invitaciones" },
    ],
  },
  {
    label: "Miembros",
    permissions: [
      { bit: 1n << 1n, label: "Expulsar" },
      { bit: 1n << 2n, label: "Banear" },
      { bit: 1n << 40n, label: "Silenciar (timeout)" },
      { bit: 1n << 26n, label: "Cambiar su apodo" },
    ],
  },
  {
    label: "Mensajes",
    permissions: [
      { bit: 1n << 10n, label: "Ver canales" },
      { bit: 1n << 11n, label: "Escribir" },
      { bit: 1n << 6n, label: "Reaccionar" },
      { bit: 1n << 14n, label: "Insertar enlaces" },
      { bit: 1n << 15n, label: "Adjuntar archivos" },
      { bit: 1n << 16n, label: "Leer el historial" },
      { bit: 1n << 13n, label: "Gestionar mensajes" },
      { bit: 1n << 18n, label: "Emojis externos" },
      { bit: 1n << 31n, label: "Usar comandos" },
      { bit: 1n << 17n, label: "Mencionar @everyone" },
    ],
  },
  {
    label: "Voz",
    permissions: [
      { bit: 1n << 20n, label: "Conectarse" },
      { bit: 1n << 21n, label: "Hablar" },
      { bit: 1n << 9n, label: "Transmitir" },
      { bit: 1n << 8n, label: "Voz prioritaria" },
      { bit: 1n << 22n, label: "Silenciar a otros" },
      { bit: 1n << 23n, label: "Ensordecer a otros" },
      { bit: 1n << 24n, label: "Mover a otros" },
    ],
  },
];

function hexFromRoleColor(color?: number): string {
  return `#${((color ?? 0) & 0xffffff).toString(16).padStart(6, "0")}`;
}

// ── Roles del servidor (Admin → Roles) ───────────────────────────────
// Discord no deja duplicar un rol ni guardar plantillas: crear uno es tedioso
// (permisos uno por uno, color, posición). El hub lo hace por API con el bot.
function RolesCard({
  guildId,
  onConfirm,
  pushToast,
}: {
  guildId: string;
  onConfirm: (dialog: ConfirmDialog) => void;
  pushToast: (message: string, tone: "error" | "success") => void;
}) {
  const blankForm = {
    color: "#6aa8ff",
    hoist: false,
    mentionable: false,
    name: "",
    permissions: 0n,
  };
  const [roles, setRoles] = useState<GuildRoleDetail[]>([]);
  const [botTopPosition, setBotTopPosition] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [compareRoleId, setCompareRoleId] = useState("");
  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGuildRolesDetailed(guildId)
      .then((rolesResponse) => {
        if (cancelled) {
          return;
        }
        setRoles(rolesResponse.roles);
        setBotTopPosition(rolesResponse.botTopPosition);
      })
      .catch(() => {
        if (!cancelled) {
          pushToast("No se pudieron cargar los roles.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [guildId, pushToast]);

  async function reloadRoles(): Promise<void> {
    const response = await getGuildRolesDetailed(guildId);
    setRoles(response.roles);
    setBotTopPosition(response.botTopPosition);
  }

  function resetForm(): void {
    setEditingId(null);
    setForm(blankForm);
  }

  // Trae a un rol al formulario. `mode: "edit"` lo edita; `mode: "copy"` arma
  // una copia nueva (nombre + " (copia)") que se deja debajo del original.
  function loadRole(role: GuildRoleDetail, mode: "copy" | "edit"): void {
    setEditingId(mode === "edit" ? role.id : null);
    setForm({
      color: hexFromRoleColor(role.color),
      hoist: role.hoist,
      mentionable: role.mentionable,
      name: mode === "copy" ? `${role.name} (copia)` : role.name,
      permissions: BigInt(role.permissions || "0"),
    });
  }

  async function saveRole(): Promise<void> {
    const name = form.name.trim();
    if (!name) {
      pushToast("Falta el nombre del rol.", "error");
      return;
    }
    const payload = {
      color: form.color,
      hoist: form.hoist,
      mentionable: form.mentionable,
      name,
      // Se manda el bitfield completo: los permisos que la tarjeta no muestra
      // quedan como estaban (no se pierden al editar).
      permissions: form.permissions.toString(),
    };
    setSaving(true);
    try {
      if (editingId) {
        const result = await updateGuildRole(guildId, editingId, payload);
        pushToast("Rol actualizado.", "success");
        if (result.positionError) {
          pushToast(result.positionError, "error");
        }
      } else {
        const result = await createGuildRole(guildId, payload);
        pushToast("Rol creado.", "success");
        if (result.positionError) {
          pushToast(result.positionError, "error");
        }
      }
      resetForm();
      await reloadRoles();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "No se pudo guardar el rol.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeRole(role: GuildRoleDetail): Promise<void> {
    onConfirm({
      kind: "danger",
      message: `Se va a borrar el rol "${role.name}" de Discord. Los miembros que lo tengan lo pierden y los permisos que da en canales se van con él.`,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteGuildRole(guildId, role.id);
            if (editingId === role.id) {
              resetForm();
            }
            pushToast("Rol eliminado.", "success");
            await reloadRoles();
          } catch (error) {
            pushToast(
              error instanceof Error
                ? error.message
                : "No se pudo borrar el rol.",
              "error",
            );
          }
        })();
      },
      title: "Eliminar rol",
    });
  }

  const editable = (role: GuildRoleDetail): boolean =>
    !role.managed && (botTopPosition === 0 || role.position < botTopPosition);
  const compareRole = roles.find((role) => role.id === compareRoleId);

  return (
    <details open className="admin-card admin-card-acc admin-card--admin">
      <summary className="admin-card-header admin-acc-header">
        <div>
          <h3>
            Roles <span className="admin-tier-badge tier-admin">Admin</span>
          </h3>
        </div>
        <span className="admin-acc-chevron" aria-hidden="true">
          ▸
        </span>
      </summary>
      <div className="admin-card-body">
        {loading ? (
          <p className="admin-card-loading">Cargando roles…</p>
        ) : (
          <>
            <div className="role-editor">
              <div className="role-editor-head">
                <strong>
                  {editingId
                    ? `Editar ${roles.find((role) => role.id === editingId)?.name ?? "rol"}`
                    : "Nuevo rol"}
                </strong>
                {editingId || form.name ? (
                  <button
                    className="ghost-button small"
                    onClick={resetForm}
                    type="button"
                  >
                    Limpiar
                  </button>
                ) : null}
              </div>
              <div className="form-grid">
                <label>
                  <input
                    className="input"
                    maxLength={100}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Nombre del rol"
                    value={form.name}
                  />
                </label>
                <label>
                  <span>Color</span>
                  <ColorControl
                    label="Color del rol"
                    onChange={(color) =>
                      setForm((current) => ({ ...current, color }))
                    }
                    value={form.color}
                  />
                </label>
              </div>
              <div className="role-controls-row">
                {roles.length > 0 ? (
                  <div className="role-compare-toolbar">
                    <label htmlFor="role-permission-compare">
                      Comparar permisos
                    </label>
                    <select
                      className="select"
                      id="role-permission-compare"
                      onChange={(event) => setCompareRoleId(event.target.value)}
                      value={compareRoleId}
                    >
                      <option value="">Seleccionar otro rol</option>
                      {roles
                        .filter((role) => role.id !== editingId)
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <div className="role-permissions">
                <div className="role-permission-group">
                  <span className="role-permission-group-title">Opciones</span>
                  <div className="role-permission-list">
                    <label className="role-permission-check">
                      <input
                        checked={form.hoist}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            hoist: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <span>Mostrar aparte</span>
                    </label>
                    <label className="role-permission-check">
                      <input
                        checked={form.mentionable}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            mentionable: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <span>Se puede mencionar</span>
                    </label>
                  </div>
                </div>
                {ROLE_PERMISSION_GROUPS.map((group) => (
                  <div className="role-permission-group" key={group.label}>
                    <span className="role-permission-group-title">
                      {group.label}
                    </span>
                    <div className="role-permission-list">
                      {group.permissions.map((permission) => {
                        const checked =
                          (form.permissions & permission.bit) !== 0n;
                        return (
                          <label
                            className="role-permission-check"
                            key={permission.label}
                          >
                            <input
                              checked={checked}
                              onChange={() =>
                                setForm((current) => ({
                                  ...current,
                                  permissions: checked
                                    ? current.permissions & ~permission.bit
                                    : current.permissions | permission.bit,
                                }))
                              }
                              type="checkbox"
                            />
                            <span>{permission.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {compareRole ? (
                <div className="role-permission-compare">
                  <div className="role-compare-apply-row">
                    <button
                      aria-label={`Aplicar ${compareRole.name} al nuevo rol`}
                      className="role-compare-apply"
                      onClick={() =>
                        setForm({
                          color: hexFromRoleColor(compareRole.color),
                          hoist: compareRole.hoist,
                          mentionable: compareRole.mentionable,
                          name: compareRole.name,
                          permissions: BigInt(compareRole.permissions || "0"),
                        })
                      }
                      title="Copiar nombre, color, opciones y permisos al nuevo rol"
                      type="button"
                    >
                      <span>{form.name.trim() || "Nuevo rol"}</span>
                      <span
                        aria-hidden="true"
                        className="role-compare-apply-arrow"
                      >
                        ←
                      </span>
                      <strong>{compareRole.name}</strong>
                    </button>
                  </div>
                  <div className="role-permission-compare-columns">
                    <div className="role-permission-compare-column">
                      <strong>{form.name.trim() || "Nuevo rol"}</strong>
                      <span className="role-compare-color-line">
                        <i
                          className="role-compare-color"
                          style={{ backgroundColor: form.color }}
                        />
                        {form.color}
                      </span>
                      <span className="role-permission-compare-group">
                        Opciones
                      </span>
                      <span
                        className={`role-permission-compare-item${form.hoist ? " enabled" : ""}`}
                      >
                        <span aria-hidden="true">{form.hoist ? "✓" : "·"}</span>
                        Mostrar aparte
                      </span>
                      <span
                        className={`role-permission-compare-item${form.mentionable ? " enabled" : ""}`}
                      >
                        <span aria-hidden="true">
                          {form.mentionable ? "✓" : "·"}
                        </span>
                        Se puede mencionar
                      </span>
                      {ROLE_PERMISSION_GROUPS.map((group) => (
                        <div key={group.label}>
                          <span className="role-permission-compare-group">
                            {group.label}
                          </span>
                          {group.permissions.map((permission) => (
                            <span
                              className={`role-permission-compare-item${(form.permissions & permission.bit) !== 0n ? " enabled" : ""}`}
                              key={permission.label}
                            >
                              <span aria-hidden="true">
                                {(form.permissions & permission.bit) !== 0n
                                  ? "✓"
                                  : "·"}
                              </span>
                              {permission.label}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="role-permission-compare-column">
                      <strong>{compareRole.name}</strong>
                      <span className="role-compare-color-line">
                        <i
                          className="role-compare-color"
                          style={{
                            backgroundColor: hexFromRoleColor(
                              compareRole.color,
                            ),
                          }}
                        />
                        {hexFromRoleColor(compareRole.color)}
                      </span>
                      <span className="role-permission-compare-group">
                        Opciones
                      </span>
                      <span
                        className={`role-permission-compare-item${compareRole.hoist ? " enabled" : ""}`}
                      >
                        <span aria-hidden="true">
                          {compareRole.hoist ? "✓" : "·"}
                        </span>
                        Mostrar aparte
                      </span>
                      <span
                        className={`role-permission-compare-item${compareRole.mentionable ? " enabled" : ""}`}
                      >
                        <span aria-hidden="true">
                          {compareRole.mentionable ? "✓" : "·"}
                        </span>
                        Se puede mencionar
                      </span>
                      {ROLE_PERMISSION_GROUPS.map((group) => (
                        <div key={group.label}>
                          <span className="role-permission-compare-group">
                            {group.label}
                          </span>
                          {group.permissions.map((permission) => {
                            const comparePermissions = BigInt(
                              compareRole.permissions || "0",
                            );
                            const enabled =
                              (comparePermissions & permission.bit) !== 0n;
                            return (
                              <span
                                className={`role-permission-compare-item${enabled ? " enabled" : ""}`}
                                key={permission.label}
                              >
                                <span aria-hidden="true">
                                  {enabled ? "✓" : "·"}
                                </span>
                                {permission.label}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="role-editor-actions">
                <button
                  className="primary-button"
                  disabled={saving}
                  onClick={() => void saveRole()}
                  type="button"
                >
                  {saving
                    ? "Guardando…"
                    : editingId
                      ? "Guardar cambios"
                      : "Crear rol"}
                </button>
              </div>
            </div>

            <details className="role-list-panel">
              <summary className="role-list-summary">
                <span>Roles del servidor</span>
                <span className="role-list-summary-meta">
                  {roles.length} roles <span aria-hidden="true">▸</span>
                </span>
              </summary>
              <div className="role-list">
                {roles.map((role) => (
                  <div className="role-row" key={role.id}>
                    <span
                      className="role-color-dot"
                      style={{
                        background: role.secondaryColor
                          ? `linear-gradient(90deg, ${hexFromRoleColor(role.color)}, ${hexFromRoleColor(role.secondaryColor)})`
                          : hexFromRoleColor(role.color),
                      }}
                    />
                    <span className="role-row-name">{role.name}</span>
                    <span className="role-row-meta">
                      {role.unicodeEmoji ? `${role.unicodeEmoji} · ` : ""}
                      posición {role.position}
                      {role.hoist ? " · aparte" : ""}
                      {role.mentionable ? " · mencionable" : ""}
                      {role.managed ? " · bot" : ""}
                    </span>
                    <span className="role-row-actions">
                      <button
                        className="ghost-button small"
                        onClick={() => loadRole(role, "copy")}
                        title="Crear una copia con el mismo color y permisos"
                        type="button"
                      >
                        Duplicar
                      </button>
                      <button
                        className="ghost-button small"
                        disabled={!editable(role)}
                        onClick={() => loadRole(role, "edit")}
                        title={
                          editable(role)
                            ? "Editar nombre, color y permisos"
                            : "Discord no deja tocar este rol"
                        }
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="ghost-button small"
                        disabled={!editable(role)}
                        onClick={() => void removeRole(role)}
                        title={
                          editable(role)
                            ? "Eliminar el rol"
                            : "Discord no deja borrar este rol"
                        }
                        type="button"
                      >
                        🗑️
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </details>
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

// Etiqueta de cada puesto del podio. El color del puesto lo pone el CSS
// (`.podium-place-N`).
const PODIUM_LABELS = ["1ro", "2do", "3ro", "4to", "5to"];

// Cada cuánto se refresca solo el dashboard. El endpoint de conectados pega
// tres veces contra Discord, así que el intervalo no puede ser corto.
const DASHBOARD_REFRESH_MS = 60_000;

// El carrusel de juegos es un marquee, igual que el de la landing: el track se
// repite y se traslada la mitad de su ancho, así el bucle no tiene costura. Dos
// cuidados, porque si no el bucle da un salto chico en cada vuelta:
//   1. las repeticiones van de a pares, para que la mitad del track sea una
//      repetición exacta de la otra mitad (con una cantidad impar la mitad corta
//      una copia al medio y no coinciden);
//   2. la separación entre tarjetas es margen y no `gap` (ver styles.css): con
//      `gap` el ancho de la mitad queda 7px corto y se nota el salto.
// Se apunta a ~24 tarjetas para que la mitad del track (≥1656px) sea más ancha
// que la fila visible (~1224px), que es la condición para que el bucle no deje
// un hueco a la derecha.
const GAME_MARQUEE_TARGET_TILES = 24;
// Velocidad de crucero del carrusel, en px/s.
const GAME_MARQUEE_SPEED = 43;

// Cuántos juegos se marcan como "más jugados" en el carrusel (el 🔥 con la
// cantidad de jugadores). El ranking lo hace el API por jugadores distintos en
// la ventana consultada, así que acá solo se cortan los primeros. Se exigen al
// menos 2 jugadores: con uno solo no hay nada que distinguir (y el respaldo sin
// actividad registrada viene con todo en cero, o sea sin distintivo).
const GAME_HOT_COUNT = 3;
const GAME_HOT_MIN_PLAYERS = 2;

// Tarjetas fantasma del carrusel de juegos mientras llega la primera respuesta.
const GAME_SKELETON_TILES = [0, 1, 2, 3, 4, 5];

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
  onOpenProfile,
  username,
}: {
  boostCount: number | null;
  boosters: GuildBooster[];
  colorFor: (level: number) => CSSProperties | undefined;
  leaderboard: LeaderboardEntry[];
  loading: boolean;
  // Abre el perfil del miembro clickeado (podio y boosters).
  onOpenProfile: (userId: string) => void;
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
                <span className="podium-rank">
                  {PODIUM_LABELS[entry.rank - 1] ?? entry.rank}
                </span>
                {entry.avatarUrl ? (
                  <img className="podium-avatar" src={entry.avatarUrl} alt="" />
                ) : (
                  <span className="podium-avatar podium-avatar-placeholder">
                    ?
                  </span>
                )}
                <span className="podium-name" style={colorFor(entry.level)}>
                  <button
                    className="member-link"
                    onClick={() => onOpenProfile(entry.userId)}
                    title="Ver perfil"
                    type="button"
                  >
                    {entry.nickname || entry.username || `@${entry.userId}`}
                  </button>
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
                  <button
                    className="member-link"
                    onClick={() => onOpenProfile(booster.userId)}
                    title="Ver perfil"
                    type="button"
                  >
                    {booster.nickname || booster.username}
                  </button>
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
  // Perfil de OTRO miembro (null = el propio): se abre al clickear un nombre
  // en el dashboard, el podio, los boosters o el roster de un evento.
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
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
  const [comunicadoSlug, setComunicadoSlug] = useState<string | null>(
    () => parseLocationHash().comunicadoSlug,
  );
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  // Evento cuyo informe se está generando (estado del botón) y evento del que
  // se está eligiendo el formato de descarga.
  const [reportBusyEventId, setReportBusyEventId] = useState<string | null>(
    null,
  );
  const [reportDownloadEvent, setReportDownloadEvent] =
    useState<HubEvent | null>(null);
  const [eventTagFilter, setEventTagFilter] = useState<string[]>([]);
  // Filtros y buscadores de las listas (mismo mecanismo en todas).
  const [eventSearch, setEventSearch] = useState("");
  const [eventOrder, setEventOrder] = useState<ListOrder>("newest");
  const [comunicadoSearch, setComunicadoSearch] = useState("");
  const [comunicadoOrder, setComunicadoOrder] = useState<ListOrder>("board");
  const [comunicadoTagFilter, setComunicadoTagFilter] = useState<string[]>([]);
  const [karutaSearch, setKarutaSearch] = useState("");
  const [karutaCommandSearch, setKarutaCommandSearch] = useState("");
  const [karutaRarity, setKarutaRarity] = useState<KarutaRarityFilter>("all");
  // Listas del panel: mismas dos piezas que las tabs (buscador + orden).
  const [dailySearch, setDailySearch] = useState("");
  const [dailyOrder, setDailyOrder] = useState<ListOrder>("newest");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditOrder, setAuditOrder] = useState<ListOrder>("newest");
  const [eventHistorySearch, setEventHistorySearch] = useState("");
  const [eventHistoryOrder, setEventHistoryOrder] =
    useState<ListOrder>("newest");
  const [karutaAlbumSearch, setKarutaAlbumSearch] = useState("");
  const [karutaAlbumOrder, setKarutaAlbumOrder] = useState<ListOrder>("newest");
  const [leaderboardSearch, setLeaderboardSearch] = useState("");

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

  const visibleKarutaCommandGroups = useMemo(() => {
    if (!karutaCommandSearch.trim()) {
      return KARUTA_COMMAND_GROUPS;
    }
    return KARUTA_COMMAND_GROUPS.map((group) => ({
      ...group,
      commands: group.commands.filter((entry) =>
        matchesSearch(
          `${group.title} ${entry.command} ${entry.description}`,
          karutaCommandSearch,
        ),
      ),
    })).filter((group) => group.commands.length > 0);
  }, [karutaCommandSearch]);

  // Frases del loro: buscador por texto + orden (alfabético o por fecha).
  const visibleDailyMessages = useMemo(
    () =>
      sortByOrder(
        dailyMessages.filter((message) =>
          matchesSearch(message.content, dailySearch),
        ),
        dailyOrder,
        (message) => message.createdAt,
        (message) => message.content,
      ),
    [dailyMessages, dailyOrder, dailySearch],
  );

  // Historial de eventos: completados, con buscador + orden.
  const completedEvents = useMemo(
    () => events.filter((entry) => entry.status === "completed"),
    [events],
  );
  const visibleEventHistory = useMemo(
    () =>
      sortByOrder(
        completedEvents.filter((entry) =>
          matchesSearch(
            `${entry.title} ${entry.description ?? ""}`,
            eventHistorySearch,
          ),
        ),
        eventHistoryOrder,
        (entry) => entry.startsAt,
        (entry) => entry.title,
      ),
    [completedEvents, eventHistoryOrder, eventHistorySearch],
  );

  // Colecciones de Karuta: buscador por colección o dueño.
  const visibleKarutaAlbums = useMemo(
    () =>
      sortByOrder(
        karutaAlbums.filter((album) =>
          matchesSearch(
            `${album.albumName ?? ""} ${album.ownerUsername ?? ""}`,
            karutaAlbumSearch,
          ),
        ),
        karutaAlbumOrder,
        (album) => album.updatedAt,
        (album) => album.albumName ?? "",
      ),
    [karutaAlbumOrder, karutaAlbumSearch, karutaAlbums],
  );

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
    // Duración del evento en HORAS (el API guarda minutos: ver minutesFromHours).
    // Admite decimales para los casos raros que necesitan minutos (0.25 = 15 min).
    durationHours: string;
    // Juego del evento (clave de la lista de juegos).
    game: string;
    imageUrl: string;
    paused: boolean;
    // Duración de la encuesta de Discord en horas (solo juegos de encuesta).
    // Vacío = sin duración explícita: Discord la abre 24 h (su default).
    pollHours: string;
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
    durationHours: "",
    game: "",
    imageUrl: "",
    paused: false,
    pollHours: "",
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
  // Juego elegido en el formulario: dice si el evento publica una encuesta de
  // Discord (plantilla "encuesta") y por lo tanto si se pide su duración.
  const eventFormGame = eventGames.find((game) => game.key === eventForm.game);
  // Catálogo de specs de inscripción (estilo Raid Helper). Los roles de cada
  // tipo de evento salen del código (event-templates), no de la guild.
  const [eventSpecs, setEventSpecs] = useState<RaidSpec[]>([]);
  // Tipos de evento (solo lectura en el panel): qué roles y qué catálogo trae
  // cada uno. Los define el código.
  const [eventTemplates, setEventTemplates] = useState<EventTemplateSummary[]>(
    [],
  );
  const [classEmojis, setClassEmojis] = useState<Record<string, MappingEmoji>>(
    {},
  );
  // Tarjeta Configuraciones del panel Admin (ahí vive el informe de
  // asistencia, que necesita la lista de miembros de la guild).
  const [showMainConfig, setShowMainConfig] = useState(false);
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
  const [boostersLoading, setBoostersLoading] = useState(true);
  // Guild de los datos que están en pantalla: al cambiar de guild hay que
  // limpiar, al cambiar de pestaña no.
  const boostersGuildRef = useRef<string | null>(null);
  const [gamesLoading, setGamesLoading] = useState(true);
  const dashboardGuildRef = useRef<string | null>(null);
  const gameTrackRef = useRef<HTMLDivElement | null>(null);
  // Posición del carrusel de juegos: se guarda al desmontarlo para retomar donde
  // iba. Volver a cero se ve como un corte (la lista salta al principio).
  const gameMarqueeOffsetRef = useRef(0);
  const [gameActivity, setGameActivity] = useState<{
    days: number;
    games: GuildGameActivity[];
    source: "activity" | "configured";
  } | null>(null);
  // El marquee necesita el track repetido: ver GAME_MARQUEE_TARGET_TILES.
  const marqueeGames = useMemo(() => {
    const games = gameActivity?.games ?? [];
    if (games.length === 0) {
      return [];
    }
    // Pares: la mitad del track tiene que ser una copia exacta de la otra mitad.
    const pairs = Math.max(
      1,
      Math.ceil(GAME_MARQUEE_TARGET_TILES / (2 * games.length)),
    );
    return Array.from({ length: pairs * 2 }, () => games).flat();
  }, [gameActivity]);
  // Juegos "más jugados" (el 🔥 del carrusel): el ranking lo hace el API por
  // jugadores distintos, así que acá solo se cortan los primeros. Se marca por
  // juego y no por posición porque el track es la misma lista repetida.
  const hotGameKeys = useMemo(() => {
    const games = gameActivity?.games ?? [];
    return new Set(
      games
        .filter((game) => game.players >= GAME_HOT_MIN_PLAYERS)
        .slice(0, GAME_HOT_COUNT)
        .map((game) => game.applicationId ?? game.name),
    );
  }, [gameActivity]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [published, setPublished] = useState<Communication[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(true);

  // ── Listas del panel Admin, ranking y colecciones ─────────────────
  // Mismo mecanismo que las tabs, pero acá abajo porque dependen de estados
  // que se declaran en este bloque (leaderboard, auditoría, comunicados).

  // Borradores: solo los ve quien puede gestionar comunicados, porque
  // `communications` se pide únicamente con ese permiso (si no, queda vacía).
  // Se muestran arriba del tablero (son lo que falta publicar) y quedan fuera
  // del orden del tablero y del arrastre.
  const draftComunicados = useMemo(
    () => communications.filter((comm) => !comm.publishedAt),
    [communications],
  );

  // Busca por slug en todo lo que la persona puede ver: si no incluyera los
  // borradores, abrir uno desde el tablero no encontraría nada y el slug se
  // limpiaría solo.
  const slugComunicados = useMemo(
    () => [...draftComunicados, ...published],
    [draftComunicados, published],
  );

  // Registro de auditoría: buscador por autor/acción/detalle (la acción se
  // busca también por su etiqueta legible, que es lo que se ve).
  const visibleAuditLogs = useMemo(
    () =>
      sortByOrder(
        auditLogs.filter((entry) =>
          matchesSearch(
            `${entry.actorName ?? ""} ${entry.action} ${auditActionLabel(entry.action)} ${entry.details ?? ""}`,
            auditSearch,
          ),
        ),
        auditOrder,
        (entry) => entry.createdAt,
        (entry) => entry.actorName ?? "",
      ),
    [auditLogs, auditOrder, auditSearch],
  );

  // Ranking de XP: buscador por nombre (el orden lo da el propio ranking).
  const visibleLeaderboard = useMemo(
    () =>
      leaderboard.filter((entry) =>
        matchesSearch(
          `${entry.nickname ?? ""} ${entry.username ?? ""}`,
          leaderboardSearch,
        ),
      ),
    [leaderboard, leaderboardSearch],
  );

  // Etiquetas usadas en los comunicados del tablero (alimentan el filtro).
  const boardTagOptions = useMemo(
    () => tagOptionsFrom([...published, ...draftComunicados]),
    [draftComunicados, published],
  );

  // Comunicados del tablero que pasan el filtro de etiqueta y el buscador.
  const matchesComunicadoFilters = useMemo(() => {
    return (comm: Communication): boolean =>
      matchesTagFilter(comm.tags ?? [], comunicadoTagFilter) &&
      matchesSearch(`${comm.title} ${comm.content}`, comunicadoSearch);
  }, [comunicadoSearch, comunicadoTagFilter]);

  // Orden del tablero: el que el staff armó arrastrando (ya viene del API).
  const visiblePublished = useMemo(() => {
    const filtered = published.filter(matchesComunicadoFilters);
    return sortByOrder(
      filtered,
      comunicadoOrder,
      (comm) => comm.publishedAt,
      (comm) => comm.title,
    );
  }, [comunicadoOrder, matchesComunicadoFilters, published]);

  // Borradores con el mismo filtro. El orden propio del tablero (`position`) no
  // los toca: se listan por fecha, del más nuevo al más viejo.
  const visibleDrafts = useMemo(
    () =>
      sortByOrder(
        draftComunicados.filter(matchesComunicadoFilters),
        "newest",
        (comm) => comm.updatedAt,
        (comm) => comm.title,
      ),
    [draftComunicados, matchesComunicadoFilters],
  );
  const [landingPreview, setLandingPreview] = useState<
    PublicLeaderboardEntry[]
  >([]);
  const [commEditor, setCommEditor] = useState<
    (CommunicationInput & { id: string | null }) | null
  >(null);
  const [activeTab, setActiveTab] = useState<HubTab>(() => tabFromHash());
  // Sub-secciones de la pestaña abierta (la primera es la que se ve si no
  // elegiste ninguna). Arranca con la sección del hash para que un enlace
  // directo (#/raids/logs) abra esa página.
  const [tabSections, setTabSections] = useState<Record<string, string>>(() => {
    const { tab, section } = parseLocationHash();
    return section ? { [tab]: section } : {};
  });

  // Sección activa de una pestaña: la última elegida o la primera.
  function sectionFor(tab: HubTab): string {
    const sections = TAB_SECTIONS[tab];
    if (!sections || sections.length === 0) {
      return "";
    }
    const saved = tabSections[tab];
    return sections.some((section) => section.key === saved)
      ? (saved as string)
      : sections[0].key;
  }

  function goToSection(tab: HubTab, section: string): void {
    setTabSections((current) => ({ ...current, [tab]: section }));
    setActiveTab(tab);
  }
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

  const pushToast = useCallback(
    (message: string, kind: ToastKind = "success"): void => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current, { id, kind, message }]);
      setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4000);
    },
    [],
  );

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
  const canManageRaidLogs = canAccess("raids");

  // Rango efectivo del usuario logueado, para el chip (owner/admin/officer).
  const myTier: "owner" | StaffTier | null = isAdminOwner
    ? "owner"
    : tierForModules(adminAccessModules);

  // Roles asignados a cada rango, para la vista por jerarquía. Los que tienen
  // permisos sueltos (no el rango completo) van a "custom": así el resumen no
  // esconde a nadie que sí tenga acceso al panel. El orden de guildRoles (por
  // posición) deja primero el rol más alto de cada rango.
  const staffByTier = useMemo<Record<StaffTier | "custom", GuildRole[]>>(() => {
    const byTier: Record<StaffTier | "custom", GuildRole[]> = {
      admin: [],
      officer: [],
      subofficer: [],
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
      byTier[tierForModules(modules) ?? "custom"].push(role);
    }
    return byTier;
  }, [config.adminRoleModules, guildRoles]);

  // Los rangos del panel toman SU color de los roles de Discord que tienen
  // asignados (el primero de cada rango, o sea el de mayor posición): así las
  // plaquitas de la jerarquía, los chips de rango, las tarjetas del panel y el
  // chip de usuario quedan como un reflejo de Discord, con el DEGRADADO del rol
  // si tiene dos colores (los --tier-*-2-* son ese segundo color). Se escriben
  // como variables CSS en el <html>, encima de la paleta fija de styles.css:
  // esa paleta queda de valor por defecto para un rango sin roles, y el CSS
  // sigue eligiendo la variante de texto de cada tema (por eso el efecto
  // depende también de `theme`).
  useEffect(() => {
    const root = document.documentElement;
    const tierKeys = [
      "owner",
      "admin",
      "officer",
      "subofficer",
      "custom",
    ] as const;
    const properties = tierKeys.flatMap((tier) => [
      `--tier-${tier}`,
      `--tier-${tier}-2`,
      `--tier-${tier}-rgb`,
      `--tier-${tier}-2-rgb`,
      `--tier-${tier}-text`,
      `--tier-${tier}-2-text`,
    ]);
    for (const property of properties) {
      root.style.removeProperty(property);
    }

    const apply = (
      tier: (typeof tierKeys)[number],
      hex: string | null,
      secondary: string | null,
    ): void => {
      if (!hex) {
        return;
      }
      const [r, g, b] = tagRgb(hex);
      const [r2, g2, b2] = tagRgb(secondary ?? hex);
      root.style.setProperty(`--tier-${tier}`, hex);
      root.style.setProperty(`--tier-${tier}-rgb`, `${r}, ${g}, ${b}`);
      root.style.setProperty(`--tier-${tier}-text`, tierTextColor(hex, theme));
      root.style.setProperty(`--tier-${tier}-2`, secondary ?? hex);
      root.style.setProperty(`--tier-${tier}-2-rgb`, `${r2}, ${g2}, ${b2}`);
      root.style.setProperty(
        `--tier-${tier}-2-text`,
        tierTextColor(secondary ?? hex, theme),
      );
    };

    // Admin y "Super Admin" (la plaquita del owner) comparten color: en
    // Discord el rango máximo de staff es el mismo rol que da el panel.
    const adminRole = staffByTier.admin[0];
    const adminColor = roleColorHex(adminRole?.color);
    const adminSecondary = roleColorHex(adminRole?.secondaryColor);
    apply("admin", adminColor, adminSecondary);
    apply("owner", adminColor, adminSecondary);

    for (const tier of ["officer", "subofficer", "custom"] as const) {
      const role = staffByTier[tier][0];
      apply(
        tier,
        roleColorHex(role?.color),
        roleColorHex(role?.secondaryColor),
      );
    }
  }, [staffByTier, theme]);

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

  const canManageComunicados = canAccess("comunicados");

  useEffect(() => {
    // La lista completa (con borradores) la pide quien puede gestionarlos: es
    // la que alimenta los borradores del tablero del hub.
    if (!selectedGuildId || !canManageComunicados) {
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
    // `canAccess` se recrea en cada render: la dependencia es el booleano.
  }, [selectedGuildId, canManageComunicados]);

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

    return () => {
      cancelled = true;
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

  // El catálogo de specs de inscripción se carga en la tab Eventos, que es
  // donde se usa (selector de inscripción y roster).
  useEffect(() => {
    if (!selectedGuildId || activeTab !== "eventos") {
      setEventSpecs([]);
      return;
    }
    let cancelled = false;
    getEventSpecs(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setEventSpecs(list);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  // Tipos de evento: los roles de cada uno salen del código. Los usa el
  // selector del formulario de evento, el roster y los avisos.
  useEffect(() => {
    if (!selectedGuildId || activeTab !== "eventos") {
      return;
    }
    let cancelled = false;
    getEventGames(selectedGuildId)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setEventGames(list);
        // Un evento nuevo arranca con el primer juego (normalmente WoW).
        setEventForm((current) =>
          current.game ? current : { ...current, game: list[0]?.key ?? "" },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  // Tipos de evento disponibles en el módulo. Los ve el staff de eventos
  // (Sub Officer en adelante); los emojis de cada rol salen del registro de
  // mapeos, que es solo para quien configura (si no puede, van sin emoji).
  useEffect(() => {
    if (!selectedGuildId || activeTab !== "admin" || !canAccess("eventos")) {
      return;
    }
    let cancelled = false;
    const mappings = canAccess("config")
      ? getGuildMappings(selectedGuildId).catch(() => [] as MappingGroup[])
      : Promise.resolve([] as MappingGroup[]);
    Promise.all([getEventTemplates(selectedGuildId), mappings])
      .then(([templates, groups]) => {
        if (cancelled) {
          return;
        }
        setEventTemplates(
          templates.map((template) => {
            const roleGroup = groups.find(
              (group) => group.key === `role.${template.key}`,
            );
            return {
              ...template,
              roles: template.roles.map((role) => {
                const emoji = roleGroup?.rows.find(
                  (row) => row.key === `role.${template.key}.${role.key}`,
                )?.emoji;
                if (!emoji || (!emoji.emojiId && !emoji.unicode)) {
                  return role;
                }
                const hasCustomEmoji = Boolean(emoji.emojiId);
                return {
                  ...role,
                  animated: hasCustomEmoji && Boolean(emoji.animated),
                  emoji: hasCustomEmoji ? undefined : emoji.unicode,
                  emojiId: emoji.emojiId,
                  emojiName: emoji.emojiName,
                };
              }),
            };
          }),
        );
        const classRows =
          groups.find((group) => group.key === "class")?.rows ?? [];
        setClassEmojis(
          Object.fromEntries(
            classRows
              .filter((row) => row.emoji)
              .map((row) => [row.label, row.emoji as MappingEmoji]),
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedGuildId, adminAccess]);

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

  // Roles de la guild para CUALQUIER miembro: el ranking pinta el nombre con
  // el color del rol de nivel (con su degradado), así que los colores tienen
  // que estar cargados también para quien no es staff.
  useEffect(() => {
    if (!selectedGuildId) {
      setGuildRoles([]);
      return;
    }
    let cancelled = false;
    getGuildRoles(selectedGuildId)
      .then((roles) => {
        if (!cancelled) {
          setGuildRoles(roles);
        }
      })
      .catch(() => {
        // Sin roles el nombre queda sin color: no rompe la vista.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGuildId]);

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

  // Baja el informe de asistencia del evento (los anotados con su estado +
  // quiénes tienen el rol mínimo y no se anotaron). El CSV lo arma el API; el
  // PDF se arma en el navegador con los datos que ya tiene la tarjeta.
  async function handleDownloadEventReport(
    event: HubEvent,
    format: ReportFormat = "csv",
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    setReportBusyEventId(event.id);
    try {
      if (format === "csv") {
        const csv = await getEventReportCsv(selectedGuildId, event.id);
        downloadCsvFile(
          `informe-${slugifyTitle(event.title) || "evento"}.csv`,
          csv,
        );
      } else {
        // La lista de los que faltan es staff-only: si falla, el PDF sale
        // igual (sin esa sección) en vez de no bajar nada.
        const roster = await getEventRoster(selectedGuildId, event.id).catch(
          () => null,
        );
        await downloadEventReportPdf(
          event,
          roster?.missing.map((entry) => entry.username) ?? [],
          new Map(
            rolesForGame(event.game).map((role) => [role.key, role.label]),
          ),
        );
      }
      pushToast(
        format === "csv" ? "Informe descargado." : "PDF descargado.",
        "success",
      );
    } catch (error) {
      void error;
      pushToast("No se pudo generar el informe.", "error");
    } finally {
      setReportBusyEventId(null);
    }
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
      durationHours: "",
      // Arranca con el primer juego disponible (normalmente WoW).
      game: eventGames[0]?.key ?? "",
      imageUrl: "",
      paused: false,
      pollHours: "",
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
      durationHours:
        event.durationMinutes != null
          ? hoursFromMinutes(event.durationMinutes)
          : "",
      game: event.game ?? "",
      imageUrl: event.imageUrl ?? "",
      paused: event.paused ?? false,
      pollHours: event.pollHours != null ? String(event.pollHours) : "",
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
      durationHours:
        event.durationMinutes != null
          ? hoursFromMinutes(event.durationMinutes)
          : "",
      game: event.game ?? "",
      imageUrl: event.imageUrl ?? "",
      // La copia no hereda pausa ni recurrencia (evita dos series andando).
      paused: false,
      pollHours: event.pollHours != null ? String(event.pollHours) : "",
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
          durationMinutes: minutesFromHours(eventForm.durationHours) ?? null,
          discordCleanupOnComplete: eventForm.discordCleanupOnComplete,
          game: eventForm.game || undefined,
          imageUrl: eventForm.imageUrl || undefined,
          paused: eventForm.paused,
          // Horas de la encuesta: solo viajan si el juego publica encuesta.
          // null = sin duración explícita → Discord la abre 24 h.
          pollHours: eventFormGame?.poll
            ? eventForm.pollHours
              ? Number(eventForm.pollHours)
              : null
            : undefined,
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
          durationMinutes: minutesFromHours(eventForm.durationHours),
          discordCleanupOnComplete: eventForm.discordCleanupOnComplete,
          game: eventForm.game || undefined,
          imageUrl: eventForm.imageUrl || undefined,
          pollHours:
            eventFormGame?.poll && eventForm.pollHours
              ? Number(eventForm.pollHours)
              : undefined,
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
    getMemberProfile(selectedGuildId, profileUserId ?? me.id)
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
  }, [activeTab, profileUserId, selectedGuildId, me]);

  // Al cambiar de guild el perfil vuelve al propio: el miembro que estabamos
  // mirando puede no estar en la guild nueva.
  useEffect(() => {
    setProfileUserId(null);
  }, [selectedGuildId]);

  // Tab desde la que se abrió el perfil de otro miembro: el botón "Volver"
  // regresa ahí (antes decía "Mi perfil" y te dejaba en el perfil propio, que no
  // es de donde venías).
  const [profileReturnTab, setProfileReturnTab] = useState<HubTab>("dashboard");

  // Abre el perfil de un miembro en la tab Perfil (el propio si es uno mismo).
  function openMemberProfile(userId: string): void {
    if (activeTab !== "perfil") {
      setProfileReturnTab(activeTab);
    }
    setProfileUserId(userId === me?.id ? null : userId);
    setActiveTab("perfil");
    window.scrollTo({ top: 0 });
  }

  // Vuelve a la pantalla anterior (de donde se abrió el perfil).
  function closeMemberProfile(): void {
    setProfileUserId(null);
    setActiveTab(profileReturnTab);
    window.scrollTo({ top: 0 });
  }

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

  // Comunicado seleccionado por URL (#/comunicados/<slug>).
  const currentComunicado = comunicadoSlug
    ? (slugComunicados.find(
        (comm) => slugifyTitle(comm.title) === comunicadoSlug,
      ) ?? null)
    : null;

  // Si el editor está abierto sobre un comunicado ya publicado, el modal avisa
  // que al guardar también se actualiza el mensaje de Discord.
  const commEditorPublished = commEditor?.id
    ? (communications.find((comm) => comm.id === commEditor.id)?.publishedAt ??
        null) != null
    : false;

  async function copyComunicadoLink(comm: { title: string }): Promise<void> {
    const url = `${window.location.origin}${window.location.pathname}#/comunicados/${slugifyTitle(comm.title)}`;
    const ok = await copyToClipboard(url);
    pushToast(
      ok ? "Enlace del comunicado copiado." : "No se pudo copiar el enlace.",
      ok ? "success" : "error",
    );
  }

  // Copia el TEXTO del comunicado, que es lo que se publica en Discord (el
  // título es solo la etiqueta del hub): sirve para pegarlo rápido en otro lado.
  async function copyComunicadoContent(comm: { content: string }): Promise<void> {
    const ok = await copyToClipboard(comm.content);
    pushToast(
      ok ? "Mensaje copiado." : "No se pudo copiar el mensaje.",
      ok ? "success" : "error",
    );
  }

  // Abre el comunicado en el modal. El slug va a la URL, así el enlace se
  // puede compartir y al abrirlo vuelve a salir el mismo.
  function openComunicado(comm: Communication): void {
    setComunicadoSlug(slugifyTitle(comm.title));
  }

  function closeComunicado(): void {
    setComunicadoSlug(null);
  }

  // Un slug de la URL que no corresponde a ningún comunicado (enlace viejo, o
  // el comunicado que se acaba de borrar) vuelve a la lista en vez de dejar la
  // pestaña vacía. Se espera a que termine la carga: mientras la lista está
  // vacía ningún slug resuelve.
  useEffect(() => {
    if (!comunicadoSlug || publishedLoading) {
      return;
    }
    const exists = slugComunicados.some(
      (comm) => slugifyTitle(comm.title) === comunicadoSlug,
    );
    if (!exists) {
      setComunicadoSlug(null);
    }
  }, [comunicadoSlug, publishedLoading, slugComunicados]);

  // Arrastre de las tarjetas del tablero. Solo el staff reordena: el orden es
  // uno solo para toda la guild, no el de cada uno. Y solo con el orden del
  // tablero activo: con otro orden la tarjeta no queda donde se suelta.
  const canReorderCommunications =
    canManageComunicados && comunicadoOrder === "board";
  const [draggedComunicadoId, setDraggedComunicadoId] = useState<string | null>(
    null,
  );
  const [dragOverComunicadoId, setDragOverComunicadoId] = useState<
    string | null
  >(null);

  async function dropComunicado(targetId: string): Promise<void> {
    const draggedId = draggedComunicadoId;
    setDraggedComunicadoId(null);
    setDragOverComunicadoId(null);
    if (!draggedId || !selectedGuildId || draggedId === targetId) {
      return;
    }
    const from = published.findIndex((comm) => comm.id === draggedId);
    const to = published.findIndex((comm) => comm.id === targetId);
    if (from < 0 || to < 0) {
      return;
    }
    const next = [...published];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // Se pinta el orden nuevo ya mismo y se guarda detrás: el arrastre no
    // debería esperar a la red.
    setPublished(next);
    try {
      await reorderCommunications(
        selectedGuildId,
        next.map((comm) => comm.id),
      );
    } catch {
      pushToast("No se pudo guardar el orden del tablero.", "error");
      await refreshCommunications();
    }
  }

  // Escape cierra el comunicado abierto.
  useEffect(() => {
    if (!comunicadoSlug) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setComunicadoSlug(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comunicadoSlug]);

  // Tarjeta del tablero. Los borradores van sin arrastre: el orden del tablero
  // es el de lo publicado, y mover uno lo dejaría en un lugar que el resto no
  // ve.
  function renderComunicadoNote(comm: Communication, isDraft: boolean) {
    const draggable = canReorderCommunications && !isDraft;
    return (
      <button
        className={[
          "comunicado-note",
          draggable ? "comunicado-note--draggable" : "",
          isDraft ? "comunicado-note--draft" : "",
          draggedComunicadoId === comm.id ? "comunicado-note--dragging" : "",
          dragOverComunicadoId === comm.id && draggedComunicadoId !== comm.id
            ? "comunicado-note--over"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        draggable={draggable}
        key={comm.id}
        onClick={() => openComunicado(comm)}
        onDragEnd={() => {
          setDraggedComunicadoId(null);
          setDragOverComunicadoId(null);
        }}
        onDragOver={(event) => {
          if (!draggable) {
            return;
          }
          // Sin esto el navegador no permite soltar acá.
          event.preventDefault();
          setDragOverComunicadoId(comm.id);
        }}
        onDragStart={() => setDraggedComunicadoId(comm.id)}
        onDrop={(event) => {
          event.preventDefault();
          void dropComunicado(comm.id);
        }}
        type="button"
      >
        <span className="comunicado-note-title">{comm.title}</span>
        <ComunicadoTags tags={comm.tags ?? []} />
        <span className="comunicado-note-excerpt">
          {comunicadoExcerpt(comm.content)}
        </span>
        <span className="comunicado-note-foot">
          {isDraft ? (
            <>
              <span className="comunicado-note-draft">Borrador</span> ·{" "}
            </>
          ) : null}
          {[
            comm.publishedAt ? formatDate24(comm.publishedAt) : null,
            comm.authorName,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </button>
    );
  }

  const newComunicadoButton = canManageComunicados ? (
    <button
      className="primary-button comunicado-new"
      onClick={() =>
        setCommEditor({
          id: null,
          title: "",
          content: "",
          channelId: "",
          tags: [],
        })
      }
      type="button"
    >
      Nuevo comunicado
    </button>
  ) : null;

  // Abre el editor del comunicado desde el hub: es el mismo modal que usa el
  // panel Admin, así no hay que ir hasta Admin para corregir un comunicado.
  function openComunicadoEditor(comm: Communication): void {
    setCommEditor({
      id: comm.id,
      title: comm.title,
      content: comm.content,
      channelId: comm.channelId ?? "",
      tags: comm.tags ?? [],
    });
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
        const { discordError } = await updateCommunication(
          selectedGuildId,
          commEditor.id,
          {
            tags: commEditor.tags ?? [],
            title: commEditor.title,
            content: commEditor.content,
            channelId: commEditor.channelId,
          },
        );
        // El comunicado y lo publicado son lo mismo: el API edita el mensaje de
        // Discord en el mismo paso. Si Discord falla, el cambio queda guardado
        // en la web igual y se avisa.
        pushToast(
          discordError
            ? `Guardado en la web. Discord: ${discordError}`
            : "Comunicado actualizado.",
          discordError ? "error" : "success",
        );
      } else {
        await createCommunication(selectedGuildId, {
          ...commEditor,
          tags: commEditor.tags ?? [],
        });
        pushToast("Comunicado creado.", "success");
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
      const { updated } = await publishCommunication(selectedGuildId, id);
      const target = communications.find((comm) => comm.id === id);
      pushToast(
        updated
          ? "Mensaje actualizado en Discord."
          : target?.channelId
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
      title: "Eliminar comunicado",
      message:
        comm.discordMessageIds.length > 0
          ? `¿Eliminar "${comm.title}" y su mensaje en Discord? Esta acción no se puede deshacer.`
          : `¿Eliminar "${comm.title}"? Esta acción no se puede deshacer.`,
      onConfirm: () => {
        void handleDeleteCommunication(comm.id);
      },
    });
  }

  async function handleDeleteCommunication(id: string): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    const target = slugComunicados.find((comm) => comm.id === id);
    try {
      await deleteCommunication(selectedGuildId, id);
      pushToast("Comunicado eliminado.", "success");
      // Si el que estaba abierto era ese, se cierra: si no, el hash seguía
      // apuntando a un comunicado que ya no existe.
      if (target && comunicadoSlug === slugifyTitle(target.title)) {
        setComunicadoSlug(null);
      }
      await refreshCommunications();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al eliminar.",
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

  // Da o quita el rango completo de UN rol (los permisos de cada rango están
  // en STAFF_TIERS).
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
      pushToast("Faltan el título y el texto.", "error");
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
      pushToast("Falta la frase.", "error");
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

  // Oculta todos los reports de una noche hasta que se restauren.
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
      pushToast("Log ocultado.", "success");
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
      message: `¿Ocultar "${group[0]?.title || group[0]?.reportCode}"? Puedes restaurarlo desde Warcraft Logs.`,
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

  // Escaneo manual bajo demanda.
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
      message: `¿Borrar "${log.title || log.reportCode}" para siempre? Ya no podrás recuperarlo. Si el report sigue en Warcraft Logs, un próximo escaneo manual puede volver a detectarlo.`,
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
        logsChannelId: config.logsChannelId ?? "",
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
        logsWatchGuild: config.logsWatchGuild ?? "",
        logsWatchRegion: config.logsWatchRegion ?? "EU",
        logsWatchServer: config.logsWatchServer ?? "",
      });
      setConfig(nextConfig);
      clearDirty("logsWatch");
      pushToast("Fuente de Warcraft Logs guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar el vigilado de gremio.", "error");
    } finally {
      setSavingAction(null);
    }
  }

  // Informe de asistencia: guardado parcial del canal al que se publica.
  // El select manda "" para limpiar (JSON no lleva undefined) y el API traduce
  // ese "" a "borrar el valor".
  async function handleSaveEventReport(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("config");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, {
        eventReportChannelId: config.eventReportChannelId ?? "",
      });
      setConfig(nextConfig);
      clearDirty("eventReport");
      pushToast("Informe de asistencia guardado.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar el informe de asistencia.", "error");
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

  // Colores del rango: los del ROL de Discord (con su degradado, igual que el
  // chip del perfil). Si el rol no tiene color, el nombre queda sin pintar.
  function ruleColorsFor(rule: XpRoleRule): {
    color?: string;
    secondary?: string;
  } {
    const role = guildRoles.find((entry) => entry.id === rule.roleId);
    return {
      color: roleColorHex(role?.color) ?? undefined,
      secondary: roleColorHex(role?.secondaryColor) ?? undefined,
    };
  }

  function levelColorFor(
    level: number,
  ): { color: string; secondary?: string } | undefined {
    if (!xpConfig) {
      return undefined;
    }

    let match: XpRoleRule | undefined;
    for (const rule of xpConfig.levelRoles) {
      if (rule.level <= level && rule.roleId) {
        match = rule;
      }
    }

    if (!match) {
      return undefined;
    }

    const colors = ruleColorsFor(match);
    return colors.color
      ? { color: colors.color, secondary: colors.secondary }
      : undefined;
  }

  // El nombre del miembro según el color de su rango: un color pleno con
  // brillo, o un DEGRADADO si el rango tiene segundo color (el mismo efecto
  // que los roles con degradado de Discord). Se aplica al elemento que
  // contiene el texto, así el caso degradado puede recortarlo con
  // background-clip (el relleno transparente se hereda a los hijos).
  function levelColorsStyle(
    color: string | undefined,
    secondary: string | undefined,
    glow = true,
  ): CSSProperties | undefined {
    if (!color) {
      return undefined;
    }
    if (secondary && secondary !== color) {
      return {
        backgroundClip: "text",
        backgroundImage: `linear-gradient(90deg, ${color}, ${secondary})`,
        color: "transparent",
        // Con el relleno transparente, text-shadow no se ve: el brillo va con
        // drop-shadow, que sigue la forma del degradado.
        filter: glow
          ? `drop-shadow(0 0 3px ${tagTint(color, 0.7)}) drop-shadow(0 0 9px ${tagTint(color, 0.35)})`
          : undefined,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      };
    }
    return glow
      ? { color, textShadow: `0 0 6px ${color}, 0 0 14px ${color}66` }
      : { color };
  }

  function levelStyleFor(
    level: number,
    glow = true,
  ): CSSProperties | undefined {
    const match = levelColorFor(level);
    return match
      ? levelColorsStyle(match.color, match.secondary, glow)
      : undefined;
  }

  // Placa del nivel en el ranking: SOLO se destaca cuando el rango tiene rol con
  // color (los que brillan o tienen degradado). Antes todos llevaban un
  // circulito con `currentColor` y pasaba lo contrario: se veía en los rangos
  // bajos y desaparecía en los altos (el degradado pinta el texto con relleno
  // transparente). Los colores van como CSS vars y la placa se pinta en CSS.
  function levelPlaqueVars(level: number): CSSProperties {
    const colors = levelColorFor(level);
    if (!colors) {
      return {};
    }
    return {
      "--level-border": tagTint(colors.color, 0.45),
      "--level-glow": tagTint(colors.color, 0.35),
      "--level-tint": tagTint(colors.color, 0.16),
    } as CSSProperties;
  }

  function levelPlaqueClass(level: number): string {
    return levelColorFor(level)
      ? "leaderboard-level leaderboard-level--rich"
      : "leaderboard-level";
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
      // Lo de la sección anterior no puede quedar para la próxima sesión.
      setBoosters([]);
      setGameActivity(null);
      boostersGuildRef.current = null;
      dashboardGuildRef.current = null;
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
      const { tab, section, comunicadoSlug } = parseLocationHash();
      setActiveTab(tab);
      if (section) {
        setTabSections((current) =>
          current[tab] === section ? current : { ...current, [tab]: section },
        );
      }
      setComunicadoSlug(comunicadoSlug);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    const section = TAB_SECTIONS[activeTab] ? sectionFor(activeTab) : "";
    const target = section
      ? `#/${activeTab}/${sectionSlug(activeTab, section)}`
      : activeTab === "comunicados" && comunicadoSlug
        ? `#/comunicados/${comunicadoSlug}`
        : `#/${activeTab}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, [activeTab, comunicadoSlug, tabSections]);

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
      // guildRoles NO se limpia: los colores de los roles se usan fuera del
      // panel (el ranking pinta los nombres con ellos).
      setDailyMessages([]);
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

  // Declarado después del efecto de Admin: ese limpia los canales al salir de
  // su pestaña y este tiene que pisarlos al entrar a Raids → Logs.
  const inRaidLogs = activeTab === "raids" && sectionFor("raids") === "logs";
  useEffect(() => {
    if (!inRaidLogs || !selectedGuildId || !canManageRaidLogs) {
      setHiddenRaidLogs([]);
      return;
    }
    let cancelled = false;
    void getGuildTextChannels(selectedGuildId)
      .then((channels) => {
        if (!cancelled) {
          setTextChannels(channels);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTextChannels([]);
        }
      });
    void listHiddenRaidLogs(selectedGuildId)
      .then((logs) => {
        if (!cancelled) {
          setHiddenRaidLogs(logs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHiddenRaidLogs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManageRaidLogs, inRaidLogs, selectedGuildId]);

  // Boosters de Nitro. Al salir de Inicio NO se borran: borrarlos obligaba a
  // esperar la respuesta y el bloque aparecía de golpe (mostrando mientras
  // tanto el estado vacío, que además miente). Solo se limpian al cambiar de
  // guild, para no mostrar los de la guild anterior.
  useEffect(() => {
    if (activeTab !== "home" || !selectedGuildId) {
      return;
    }

    const sameGuild = boostersGuildRef.current === selectedGuildId;
    boostersGuildRef.current = selectedGuildId;
    if (!sameGuild) {
      setBoosters([]);
      setBoostersLoading(true);
    }

    let cancelled = false;
    getGuildBoosters(selectedGuildId)
      .then((boostersList) => {
        if (!cancelled) {
          setBoosters(boostersList);
        }
      })
      .catch(() => {
        if (!cancelled && !sameGuild) {
          setBoosters([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBoostersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  // Juegos del server: los mide el bot con las presencias. Un fallo acá deja
  // el dashboard sin las portadas, nada más.
  //
  // El dashboard es la primera sección que se refresca sola: conectados y
  // juegos cambian sin que el usuario haga nada. Se pausa con la pestaña del
  // navegador en segundo plano y se adelanta al volver a ella. El intervalo es
  // largo a propósito: /widget pega contra Discord (preview + guild + widget).
  useEffect(() => {
    if (activeTab !== "dashboard" || !selectedGuildId) {
      return;
    }

    // Igual que los boosters: al volver a la sección se muestra lo último que
    // hay y el refresco va detrás, sin que el carrusel aparezca de golpe.
    const sameGuild = dashboardGuildRef.current === selectedGuildId;
    dashboardGuildRef.current = selectedGuildId;
    if (!sameGuild) {
      setGameActivity(null);
      setGamesLoading(true);
    }

    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [status, activity] = await Promise.allSettled([
        getGuildWidgetStatus(selectedGuildId),
        getGuildGameActivity(selectedGuildId),
      ]);
      if (cancelled) {
        return;
      }
      // Si el refresco trae exactamente lo mismo, se deja el estado como está:
      // un objeto nuevo igual hace que React vuelva a renderizar toda la página
      // (y el carrusel) al pedo, y eso se ve como una traba cada minuto.
      if (status.status === "fulfilled") {
        setWidgetStatus((current) =>
          samePayload(current, status.value) ? current : status.value,
        );
      }
      if (activity.status === "fulfilled") {
        setGameActivity((current) =>
          samePayload(current, activity.value) ? current : activity.value,
        );
      } else if (!sameGuild) {
        setGameActivity(null);
      }
    };

    void refresh().finally(() => {
      if (!cancelled) {
        setGamesLoading(false);
      }
    });

    const runIfVisible = (): void => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    const timer = window.setInterval(runIfVisible, DASHBOARD_REFRESH_MS);
    document.addEventListener("visibilitychange", runIfVisible);
    window.addEventListener("focus", runIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", runIfVisible);
      window.removeEventListener("focus", runIfVisible);
    };
  }, [activeTab, selectedGuildId]);

  // El carrusel se mueve con JS (no con una animación CSS) para poder agarrarlo y
  // arrastrarlo: ver src/marquee.ts. El motor decide solo si corresponde moverse
  // (si el sistema pide no animar, deja la fila quieta).
  //
  // Depende de si hay tarjetas y no de la lista: el refresco del dashboard trae
  // objetos nuevos con los mismos juegos, y recrear el motor en cada refresco
  // devolvía el carrusel al principio (se veía como un corte al moverlo).
  const hayCarrusel = marqueeGames.length > 0;
  useEffect(() => {
    const track = gameTrackRef.current;
    if (!track || activeTab !== "dashboard" || !hayCarrusel) {
      return;
    }
    const marquee = createMarquee({
      initialOffset: gameMarqueeOffsetRef.current,
      speed: GAME_MARQUEE_SPEED,
      track,
    });
    return () => {
      gameMarqueeOffsetRef.current = marquee.offset();
      marquee.destroy();
    };
  }, [activeTab, hayCarrusel]);

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

  const roleModalTarget =
    roleModal != null
      ? (xpConfig?.levelRoles.find((rule) => rule.level === roleModal.level) ??
        null)
      : null;
  const activeAdminSection = TAB_SECTIONS.admin?.find(
    (section) => section.key === sectionFor("admin"),
  );

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
            {visibleTabs.map((tab) => {
              const sections = TAB_SECTIONS[tab];
              const visibleSections =
                tab === "admin"
                  ? sections
                      ?.filter(
                        (section) =>
                          !section.module || canAccess(section.module),
                      )
                      .sort(
                        (left, right) =>
                          ACCESS_TIER_ORDER[left.tier ?? "subofficer"] -
                          ACCESS_TIER_ORDER[right.tier ?? "subofficer"],
                      )
                  : sections;
              return (
                <div className="nav-item" key={tab}>
                  <button
                    className={`nav-link ${activeTab === tab ? "active" : ""}${tab === "admin" ? " nav-link--admin" : ""}`}
                    onClick={sections ? undefined : () => setActiveTab(tab)}
                    type="button"
                  >
                    {tabLabel(tab)}
                    {visibleSections ? (
                      <span aria-hidden="true" className="nav-caret">
                        ▾
                      </span>
                    ) : null}
                  </button>
                  {/* Módulo con sub-secciones: al pasar el mouse (o al enfocar
                      con teclado) el nav ofrece cada página. */}
                  {visibleSections ? (
                    <div className="nav-submenu">
                      {visibleSections.map((section) => (
                        <button
                          className={`nav-sublink${activeTab === tab && sectionFor(tab) === section.key ? " active" : ""}`}
                          key={section.key}
                          onClick={() => goToSection(tab, section.key)}
                          type="button"
                        >
                          {section.label}
                          {tab === "admin" && section.tier ? (
                            <span
                              className={`admin-nav-tier tier-${section.tier}`}
                            >
                              {accessTierLabel(section.tier)}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
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
              onClick={() => {
                setProfileUserId(null);
                setActiveTab("perfil");
              }}
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
            loading={loadingGuildData || boostersLoading}
            onOpenProfile={openMemberProfile}
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

            <section
              className={`panel content-panel${activeTab === "admin" && activeAdminSection?.tier ? ` content-panel-admin admin-tier-panel-${activeAdminSection.tier}` : ""}`}
            >
              {/* La tab Eventos arma su propia cabecera (título + botón de
                  nuevo evento). */}
              {activeTab === "eventos" ? null : (
                <div className="section-header">
                  <div>
                    <h2
                      className={
                        activeTab === "admin" && activeAdminSection?.tier
                          ? `admin-section-title tier-${activeAdminSection.tier}`
                          : undefined
                      }
                    >
                      {activeTab === "admin"
                        ? (activeAdminSection?.label ?? panelTitle(activeTab))
                        : currentSectionTitle(
                            activeTab,
                            sectionFor(activeTab),
                            panelTitle(activeTab),
                          )}
                    </h2>
                  </div>
                  {activeTab === "admin" && activeAdminSection?.tier ? (
                    <span
                      className={`admin-nav-tier tier-${activeAdminSection.tier}`}
                    >
                      {accessTierLabel(activeAdminSection.tier)}
                    </span>
                  ) : null}
                </div>
              )}

              {activeTab === "dashboard" ? (
                <div className="dashboard-stack">
                  <ServerStats
                    status={widgetStatus}
                    loading={loadingGuildData}
                  />

                  {gameActivity && gameActivity.games.length > 0 ? (
                    <div className="game-marquee">
                      <div className="game-covers" ref={gameTrackRef}>
                        {marqueeGames.map((game, index) => {
                          const hot = hotGameKeys.has(
                            game.applicationId ?? game.name,
                          );
                          return (
                            <article
                              className={`game-cover${hot ? " game-cover--hot" : ""}`}
                              key={`${game.applicationId ?? game.name}-${index}`}
                              title={
                                hot
                                  ? `${game.name} · ${game.players} jugadores en los últimos ${gameActivity.days} días`
                                  : game.name
                              }
                            >
                              <span className="game-cover-art">
                                {game.coverUrl ? (
                                  <img
                                    alt=""
                                    decoding="async"
                                    src={game.coverUrl}
                                  />
                                ) : null}
                                {hot ? (
                                  <span
                                    className="game-cover-hot"
                                    aria-hidden="true"
                                  >
                                    🔥 {game.players}
                                  </span>
                                ) : null}
                              </span>
                              <span className="game-cover-name">
                                {game.name}
                              </span>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : gamesLoading ? (
                    /* Mientras llega la primera respuesta: la misma caja, así
                       el dashboard no se reacomoda cuando aparecen. */
                    <div className="game-marquee">
                      <div className="game-covers">
                        {GAME_SKELETON_TILES.map((index) => (
                          <span
                            aria-hidden="true"
                            className="game-cover game-cover--skeleton"
                            key={index}
                          >
                            <span className="game-cover-art" />
                            <span className="game-cover-name" />
                          </span>
                        ))}
                      </div>
                    </div>                  ) : null}

                  <div className="leaderboard-panel">
                    <h3>Leaderboard de XP</h3>
                    <ListFilterBar
                      onSearchChange={setLeaderboardSearch}
                      placeholder="Buscar miembro…"
                      search={leaderboardSearch}
                    />
                    {loadingGuildData ? (
                      <div className="empty-state">Cargando ranking...</div>
                    ) : leaderboard.length === 0 ? (
                      <div className="empty-state">
                        Todavía no hay XP registrado en este servidor.
                      </div>
                    ) : visibleLeaderboard.length === 0 ? (
                      <div className="empty-state">
                        Ningún miembro coincide con la búsqueda.
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
                          {visibleLeaderboard.map((entry) => (
                            <tr
                              className={`leaderboard-row${entry.rank <= 5 ? ` mvp-row mvp-row-${entry.rank}` : ""}`}
                              key={entry.userId}
                              onClick={() => openMemberProfile(entry.userId)}
                              title="Ver perfil"
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
                                    <button
                                      className="member-link"
                                      onClick={(event) => {
                                        // La fila entera abre el perfil: frenamos
                                        // la burbuja para no abrirlo dos veces.
                                        event.stopPropagation();
                                        openMemberProfile(entry.userId);
                                      }}
                                      title="Ver perfil"
                                      type="button"
                                    >
                                      {entry.nickname ||
                                        entry.username ||
                                        `@${entry.userId}`}
                                    </button>
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
                                  className={levelPlaqueClass(entry.level)}
                                  style={{
                                    ...levelStyleFor(
                                      entry.level,
                                      entry.isBooster,
                                    ),
                                    ...levelPlaqueVars(entry.level),
                                  }}
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
                <div
                  className={`admin-page-stack${activeAdminSection?.tier ? ` admin-tier-page-${activeAdminSection.tier}` : ""}`}
                >
                  {sectionFor("admin") === "config" && canAccess("config") ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--admin"
                      onToggle={(event) =>
                        setShowMainConfig(event.currentTarget.open)
                      }
                    >
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Configuraciones{" "}
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
                              {(
                                [
                                  ["owner", "Owner"],
                                  ["admin", "Admin"],
                                  ["officer", "Officer"],
                                  ["subofficer", "Sub Officer"],
                                ] as const
                              ).map(([tier, label]) => {
                                const checked = (
                                  config.suggestionsDmTiers ?? []
                                ).includes(tier);
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
                              })}
                            </div>
                          </label>

                          {/* Informe de asistencia: lo manda el bot al cerrar
                              las inscripciones del evento (o al completarse si
                              no hay cierre cargado). Es una opción más de la
                              tarjeta: el canal y, si el toggle está prendido,
                              las personas que lo reciben por MD. */}
                          <label>
                            <span>Informe de asistencia</span>
                            <select
                              className="select"
                              value={config.eventReportChannelId ?? ""}
                              onChange={(event) =>
                                editConfig(
                                  (current) => ({
                                    ...current,
                                    eventReportChannelId: event.target.value,
                                  }),
                                  "eventReport",
                                )
                              }
                            >
                              <option value="">Sin canal</option>
                              {textChannels.map((channel) => (
                                <option key={channel.id} value={channel.id}>
                                  {channel.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {isDirty("eventReport") ? (
                            <button
                              className="primary-button"
                              disabled={savingAction !== null}
                              onClick={() => void handleSaveEventReport()}
                              type="button"
                            >
                              {savingAction === "config"
                                ? "Guardando…"
                                : "Guardar configuración"}
                            </button>
                          ) : null}
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

                  {sectionFor("admin") === "mapeo" &&
                  canAccess("config") &&
                  selectedGuildId ? (
                    <AdminMappingsSection
                      guildId={selectedGuildId}
                      notify={pushToast}
                    />
                  ) : null}
                  {sectionFor("admin") === "karuta" && canAccess("karuta") ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--officer"
                    >
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

                  {sectionFor("admin") === "modulos" && isAdminOwner ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--owner"
                    >
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

                  {sectionFor("admin") === "roles" &&
                  canAccess("config") &&
                  selectedGuildId ? (
                    <RolesCard
                      guildId={selectedGuildId}
                      onConfirm={setConfirmDialog}
                      pushToast={pushToast}
                    />
                  ) : null}

                  {sectionFor("admin") === "permisos" && isAdminOwner ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--owner"
                    >
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
                              ●
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
                              ●
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
                              ●
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
                          <div className="staff-hierarchy-tier subofficer">
                            <span
                              className="staff-hierarchy-icon"
                              aria-hidden="true"
                            >
                              ●
                            </span>
                            <div className="staff-hierarchy-info">
                              <strong>Sub Officer</strong>
                              <small>
                                {STAFF_TIERS.subofficer.description}
                              </small>
                              <StaffRoleControls
                                assigned={staffByTier.subofficer}
                                disabled={savingPermission}
                                guildRoles={guildRoles}
                                label="Sub Officer"
                                onAdd={(roleId) =>
                                  void applyStaffTier(roleId, "subofficer")
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
                                ●
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
                              ●
                            </span>
                            <div className="staff-hierarchy-info">
                              <strong>Sin acceso</strong>
                              <small>El hub normal, sin panel Admin.</small>
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {sectionFor("admin") === "karpindomo" &&
                  canAccess("daily") ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--officer"
                    >
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Karpindomo{" "}
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

                          <ListFilterBar
                            onOrderChange={setDailyOrder}
                            onSearchChange={setDailySearch}
                            order={dailyOrder}
                            placeholder="Buscar frase…"
                            search={dailySearch}
                          />

                          {dailyMessages.length === 0 ? (
                            <div className="empty-state">
                              <p>
                                No hay frases todavía. Agregar la primera para
                                que el loro empiece a hablar.
                              </p>
                            </div>
                          ) : visibleDailyMessages.length === 0 ? (
                            <div className="empty-state">
                              <p>Ninguna frase coincide con la búsqueda.</p>
                            </div>
                          ) : (
                            visibleDailyMessages.map((message) => (
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

                  {sectionFor("admin") === "xp" && canAccess("xp") ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--admin"
                    >
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            XP{" "}
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
                                    {/* El rol con SU color de Discord (el
                                        mismo chip que el perfil). */}
                                    {(() => {
                                      const role = guildRoles.find(
                                        (entry) => entry.id === rule.roleId,
                                      );
                                      return role ? (
                                        <span
                                          className={roleChipClass(role)}
                                          style={roleChipStyle(role)}
                                        >
                                          <span className="role-chip-name">
                                            {role.name}
                                          </span>
                                        </span>
                                      ) : null;
                                    })()}
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
                                    <div
                                      className="xp-color-preview"
                                      title="Así se ve el nombre del rango"
                                    >
                                      <span
                                        style={levelColorsStyle(
                                          ruleColorsFor(rule).color,
                                          ruleColorsFor(rule).secondary,
                                        )}
                                      >
                                        {rule.nicknamePrefix ?? ""}
                                        {guildRoles.find(
                                          (role) => role.id === rule.roleId,
                                        )?.name ?? "Nombre"}
                                      </span>
                                    </div>
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

                  {sectionFor("admin") === "registros" && isAdminOwner ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--owner"
                    >
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
                        {selectedGuild?.owner && auditLogs.length > 0 ? (
                          <ListFilterBar
                            onOrderChange={setAuditOrder}
                            onSearchChange={setAuditSearch}
                            order={auditOrder}
                            placeholder="Buscar en el registro…"
                            search={auditSearch}
                          />
                        ) : null}
                        {selectedGuild?.owner ? (
                          auditLogs.length === 0 ? (
                            <div className="empty-state">
                              Aún no hay cambios registrados. Se anota cada
                              cambio real hecho desde el panel Admin, con qué
                              campo se tocó y de qué valor a cuál.
                            </div>
                          ) : visibleAuditLogs.length === 0 ? (
                            <div className="empty-state">
                              Ningún registro coincide con la búsqueda.
                            </div>
                          ) : (
                            <div className="audit-list">
                              {visibleAuditLogs.map((entry) => (
                                <div className="audit-row" key={entry.id}>
                                  <span className="audit-time">
                                    {formatDateTime24(entry.createdAt)}
                                  </span>
                                  <span className="audit-actor">
                                    {entry.actorName ??
                                      entry.actorUserId ??
                                      "—"}
                                  </span>
                                  <span
                                    className="audit-action"
                                    title={entry.action}
                                  >
                                    {auditActionLabel(entry.action)}
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

                  {sectionFor("admin") === "eventos" && canAccess("eventos") ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--subofficer"
                    >
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Eventos{" "}
                            <span className="admin-tier-badge tier-subofficer">
                              Sub Officer
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        {eventTemplates.length === 0 ? (
                          <p className="admin-card-loading">
                            Cargando tipos de evento…
                          </p>
                        ) : (
                          eventTemplates.map((template) => (
                            <details
                              className="event-template-picker"
                              key={template.key}
                            >
                              <summary>
                                <strong>{template.label}</strong>
                                {/* Mismo conteo que los grupos del Mapeo: cuántas
                                    respuestas (roles) trae el tipo de evento. */}
                                <span className="sub-card-count">
                                  {template.roles.length} respuesta
                                  {template.roles.length === 1 ? "" : "s"}
                                </span>
                                <span
                                  className="admin-acc-chevron"
                                  aria-hidden="true"
                                >
                                  ▸
                                </span>
                              </summary>
                              <div className="event-template-roles">
                                {template.roles.map((role) => (
                                  <span
                                    className="event-template-role"
                                    key={role.key}
                                  >
                                    <EventRoleEmoji
                                      role={role.key}
                                      roles={template.roles}
                                      size={18}
                                    />
                                    {role.label}
                                  </span>
                                ))}
                              </div>
                            </details>
                          ))
                        )}
                      </div>
                    </details>
                  ) : null}
                  {sectionFor("admin") === "historial" &&
                  canAccess("eventos") &&
                  completedEvents.length > 0 ? (
                    <details
                      open
                      className="admin-card admin-card-acc admin-card--subofficer"
                    >
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>
                            Historial de eventos{" "}
                            <span className="admin-tier-badge tier-subofficer">
                              Sub Officer
                            </span>
                          </h3>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
                      <div className="admin-card-body">
                        <>
                          <ListFilterBar
                            onOrderChange={setEventHistoryOrder}
                            onSearchChange={setEventHistorySearch}
                            order={eventHistoryOrder}
                            placeholder="Buscar evento…"
                            search={eventHistorySearch}
                          />
                          {visibleEventHistory.length === 0 ? (
                            <p className="muted-text">
                              Ningún evento coincide con la búsqueda.
                            </p>
                          ) : (
                            <div className="event-history-list">
                              {visibleEventHistory.map((finished) => (
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
                                    <div className="event-history-actions">
                                      <button
                                        className="csv-button"
                                        disabled={
                                          reportBusyEventId === finished.id
                                        }
                                        onClick={() =>
                                          setReportDownloadEvent(finished)
                                        }
                                        type="button"
                                      >
                                        {reportBusyEventId === finished.id
                                          ? "Generando…"
                                          : "⬇️ Descargar informe"}
                                      </button>
                                      <button
                                        className="danger-button"
                                        onClick={() =>
                                          handleDeleteEvent(finished)
                                        }
                                        type="button"
                                      >
                                        🗑️ Eliminar evento
                                      </button>
                                    </div>
                                  </div>
                                </details>
                              ))}
                            </div>
                          )}
                        </>
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
                  {sectionFor("raids") === "roster" && selectedGuildId ? (
                    <RosterSection
                      canEditOthers={canAccess("raids")}
                      guildId={selectedGuildId}
                      guildRoles={guildRoles}
                      meId={me?.id}
                      notify={pushToast}
                      onOpenProfile={openMemberProfile}
                    />
                  ) : null}
                  {sectionFor("raids") === "logs" ? (
                    <div className="raid-logs-view">
                      {raidLogsLoading && raidLogs.length === 0 ? (
                        <LoadingState label="Cargando logs…" />
                      ) : (
                        <RaidLogsBoard
                          logs={raidLogs}
                          onAnalyze={
                            selectedGuildId
                              ? (log) =>
                                  getRaidLogAnalysis(selectedGuildId, log.id)
                              : undefined
                          }
                          onHide={
                            canManageRaidLogs ? requestHideRaidLog : undefined
                          }
                          onPublish={
                            canManageRaidLogs ? handlePublishRaidLog : undefined
                          }
                          onScan={
                            canManageRaidLogs
                              ? () => void handleScanRaidLogs()
                              : undefined
                          }
                          onUpdate={
                            canManageRaidLogs ? handleUpdateRaidLog : undefined
                          }
                          scanDisabled={
                            isDirty("logsWatch") ||
                            savingAction !== null ||
                            !config.logsWatchGuild?.trim() ||
                            !config.logsWatchServer?.trim()
                          }
                          scanning={scanningRaidLogs}
                          manage={
                            canManageRaidLogs ? (
                              <>
                                <section className="raid-logs-settings">
                                  <h3>
                                    Configuración{" "}
                                    <span className="admin-tier-badge tier-subofficer">
                                      Sub Officer
                                    </span>
                                  </h3>
                                  <div className="form-grid">
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
                                        <option value="">
                                          Sin canal configurado
                                        </option>
                                        {textChannels.map((channel) => (
                                          <option
                                            key={channel.id}
                                            value={channel.id}
                                          >
                                            {channel.name}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      <span>Guild de Warcraft Logs</span>
                                      <input
                                        autoComplete="off"
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
                                      />
                                    </label>
                                    <label>
                                      <span>Realm</span>
                                      <input
                                        autoComplete="off"
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
                                              logsWatchRegion:
                                                event.target.value,
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
                                  <div className="raid-logs-settings-actions">
                                    {isDirty("logsChannel") ? (
                                      <button
                                        className="ghost-button"
                                        disabled={savingAction !== null}
                                        onClick={() =>
                                          void handleSaveLogsConfig()
                                        }
                                        type="button"
                                      >
                                        Guardar canal
                                      </button>
                                    ) : null}
                                    {isDirty("logsWatch") ? (
                                      <button
                                        className="primary-button"
                                        disabled={savingAction !== null}
                                        onClick={() =>
                                          void handleSaveLogsWatch()
                                        }
                                        type="button"
                                      >
                                        Guardar fuente
                                      </button>
                                    ) : null}
                                  </div>
                                </section>
                                <div className="raid-logs-add">
                                  <label>
                                    <span>Agregar por URL</span>
                                    <input
                                      autoComplete="off"
                                      value={raidLogUrl}
                                      onChange={(event) =>
                                        setRaidLogUrl(event.target.value)
                                      }
                                      placeholder="https://www.warcraftlogs.com/reports/…"
                                    />
                                  </label>
                                  <button
                                    className="ghost-button"
                                    disabled={!raidLogUrl.trim()}
                                    onClick={() => void handleCreateRaidLog()}
                                    type="button"
                                  >
                                    Agregar
                                  </button>
                                </div>
                                {hiddenRaidLogs.length > 0 ? (
                                  <details className="hidden-raid-logs">
                                    <summary>
                                      Ocultos ({hiddenRaidLogs.length})
                                    </summary>
                                    {hiddenRaidLogs.map((log) => (
                                      <div
                                        className="daily-message-row"
                                        key={log.id}
                                      >
                                        <div className="daily-message-content">
                                          <strong>
                                            {log.title || log.reportCode}
                                          </strong>
                                          <div className="muted-text">
                                            ⚔️ {log.fightCount} · 💀 {log.kills}
                                          </div>
                                        </div>
                                        <div className="daily-message-actions">
                                          <button
                                            className="ghost-button"
                                            onClick={() =>
                                              requestShowRaidLog(log)
                                            }
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
                                  </details>
                                ) : null}
                              </>
                            ) : undefined
                          }
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              ) : activeTab === "perfil" ? (
                <div className="profile-view">
                  {profileUserId ? (
                    <button
                      className="comunicado-back"
                      onClick={closeMemberProfile}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="comunicado-back-arrow"
                      >
                        ←
                      </span>
                      Volver a {tabLabel(profileReturnTab)}
                    </button>
                  ) : null}
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
                                className={roleChipClass(role)}
                                key={role.id}
                                style={roleChipStyle(role)}
                              >
                                <span className="role-chip-name">
                                  {role.name}
                                </span>
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
                  ) : published.length === 0 &&
                    draftComunicados.length === 0 ? (
                    <div className="empty-state">
                      <p>
                        {canManageComunicados
                          ? "No hay comunicados todavía."
                          : "Todavía no hay comunicados publicados."}
                      </p>
                      {newComunicadoButton}
                    </div>
                  ) : (
                    <>
                      <ListFilterBar
                        onOrderChange={setComunicadoOrder}
                        onSearchChange={setComunicadoSearch}
                        order={comunicadoOrder}
                        orderOptions={COMUNICADO_ORDER_OPTIONS}
                        placeholder="Buscar comunicado…"
                        search={comunicadoSearch}
                      >
                        <button
                          className={`event-filter-chip${comunicadoTagFilter.length === 0 ? " active" : ""}`}
                          onClick={() => setComunicadoTagFilter([])}
                          type="button"
                        >
                          Todos
                        </button>
                        {boardTagOptions.map((tag) => {
                          const key = tag.label.toLowerCase();
                          return (
                            <EventTagFilterChip
                              active={comunicadoTagFilter.includes(key)}
                              color={tag.color}
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
                        {[...published, ...draftComunicados].some(
                          (comm) => (comm.tags ?? []).length === 0,
                        ) ? (
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
                        {newComunicadoButton}
                      </ListFilterBar>
                      {visiblePublished.length === 0 &&
                      visibleDrafts.length === 0 ? (
                        <div className="empty-state">
                          Ningún comunicado coincide con el filtro.
                        </div>
                      ) : null}
                      <div className="comunicado-board">
                        {visibleDrafts.map((comm) =>
                          renderComunicadoNote(comm, true),
                        )}
                        {visiblePublished.map((comm) =>
                          renderComunicadoNote(comm, false),
                        )}
                      </div>
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
                  {karutaLoading ? (
                    <LoadingState label="Cargando Karuta…" />
                  ) : sectionFor("karuta") === "raras" ? (
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
                              {KARUTA_RARITY_FILTERS.map(
                                ({ key, label, modifier }) => (
                                  <button
                                    className={`karuta-rarity-chip ${modifier}${karutaRarity === key ? " active" : ""}`}
                                    key={key}
                                    onClick={() => setKarutaRarity(key)}
                                    type="button"
                                  >
                                    {karutaRarity === key ? "✓ " : ""}
                                    {label} (
                                    {key === "all"
                                      ? karutaCards.length
                                      : karutaRarityCounts[key]}
                                    )
                                  </button>
                                ),
                              )}
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
                  ) : sectionFor("karuta") === "coleccion" ? (
                    <section className="karuta-section">
                      {karutaAlbums.length === 0 ? (
                        <div className="empty-state">
                          Todavía no hay colecciones. Se agregan cuando alguien
                          ve su álbum con <code>ka</code>.
                        </div>
                      ) : (
                        <>
                          <ListFilterBar
                            onOrderChange={setKarutaAlbumOrder}
                            onSearchChange={setKarutaAlbumSearch}
                            order={karutaAlbumOrder}
                            placeholder="Buscar colección…"
                            search={karutaAlbumSearch}
                          />
                          {visibleKarutaAlbums.length === 0 ? (
                            <div className="empty-state">
                              Ninguna colección coincide con la búsqueda.
                            </div>
                          ) : (
                            <div className="karuta-albums-grid">
                              {visibleKarutaAlbums.map((album) => (
                                <KarutaAlbumCard
                                  album={album}
                                  canDelete={canAccess("config")}
                                  key={album.id}
                                  onDelete={handleDeleteKarutaAlbum}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  ) : (
                    <section className="karuta-section">
                      <h3>Guía de comandos</h3>
                      <p className="meta-text">
                        Comandos de Karuta con el prefijo de este server.
                      </p>
                      <div className="karuta-filters">
                        <input
                          className="input list-search"
                          onChange={(event) =>
                            setKarutaCommandSearch(event.target.value)
                          }
                          placeholder="Buscar comando…"
                          type="search"
                          value={karutaCommandSearch}
                        />
                      </div>
                      {visibleKarutaCommandGroups.length === 0 ? (
                        <div className="empty-state">
                          Ningún comando coincide con la búsqueda.
                        </div>
                      ) : (
                        <div className="karuta-command-groups">
                          {visibleKarutaCommandGroups.map((group) => (
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
                      )}
                    </section>
                  )}
                </div>
              ) : activeTab === "eventos" ? (
                <div className="dashboard-stack">
                  <div className="event-list-header">
                    <h2>Eventos</h2>
                    {canAccess("eventos") ? (
                      <button
                        className={
                          showEventForm
                            ? "ghost-button cancel-button"
                            : "primary-button"
                        }
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

                  {/* El form es un MODAL: antes se abría abajo de la lista de
                      eventos y había que scrollear toda la página para
                      completarlo. */}
                  {showEventForm ? (
                    <div
                      className="modal-overlay event-form-overlay"
                      onClick={handleCloseEventForm}
                    >
                      <div
                        className="event-form-card event-form-modal"
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                      >
                        <div className="event-form-head">
                          <h3 className="event-form-title">
                            {editingEventId
                              ? "Editar evento"
                              : duplicatingEvent
                                ? "Duplicar evento"
                                : "Nuevo evento"}
                          </h3>
                          <button
                            className="ghost-button small"
                            onClick={handleCloseEventForm}
                            title="Cerrar"
                            type="button"
                          >
                            ✕
                          </button>
                        </div>
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
                          {/* Plantilla de encuesta: además del aviso se publica
                            una encuesta nativa de Discord (✅ Sí · ❌ No). */}
                          {eventFormGame?.poll ? (
                            <div className="event-form-wide">
                              <span className="event-form-note">
                                📊 Este tipo de evento publica también una
                                encuesta nativa de Discord (✅ SI · ❌ NO) en el
                                canal del aviso.
                              </span>
                            </div>
                          ) : null}
                          <div className="event-form-wide event-tag-field">
                            <span className="event-tag-title">Etiquetas</span>
                            <TagsField
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
                            <span>Duración (horas)</span>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="any"
                              placeholder="3"
                              value={eventForm.durationHours}
                              onChange={(event) =>
                                setEventForm((current) => ({
                                  ...current,
                                  durationHours: event.target.value,
                                }))
                              }
                            />
                          </label>
                          {eventFormGame?.poll ? (
                            <label>
                              <span>Duración de la encuesta (horas)</span>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                placeholder="24 (por defecto)"
                                value={eventForm.pollHours}
                                onChange={(event) =>
                                  setEventForm((current) => ({
                                    ...current,
                                    pollHours: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          ) : null}
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
                                const checked =
                                  eventForm.reminderHours.includes(
                                    option.hours,
                                  );
                                const disabled =
                                  !eventForm.requiredRoleId.trim();
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
                                    value={
                                      eventForm.recurrencePublishDaysBefore
                                    }
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
                                <span className="muted-text">Vacía.</span>
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
                                      createScheduledEvent:
                                        event.target.checked,
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
                                      <option
                                        key={channel.id}
                                        value={channel.id}
                                      >
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
                                Publica un embed del evento en un canal de
                                texto.
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
                            className="ghost-button cancel-button"
                            onClick={handleCloseEventForm}
                            type="button"
                          >
                            Cancelar
                          </button>
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
                            Todos
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
                              onDownloadReport={handleDownloadEventReport}
                              onDuplicate={handleDuplicateEvent}
                              onEdit={handleEditEvent}
                              onOpenProfile={openMemberProfile}
                              onRemoveSignup={handleRemoveEventSignup}
                              onResetOccurrence={handleResetOccurrence}
                              onResetSignup={handleResetEventSignup}
                              onSignup={handleEventSignup}
                              onStaffRemoveSignup={handleStaffRemoveEventSignup}
                              onStaffSignup={handleStaffEventSignup}
                              reportBusy={reportBusyEventId === event.id}
                              eventPoll={
                                eventGames.find(
                                  (game) => game.key === event.game,
                                )?.poll === true
                              }
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

      {currentComunicado ? (
        <div className="modal-overlay" onClick={closeComunicado}>
          <div
            aria-modal="true"
            className="modal comunicado-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="comunicado-modal-head">
              <div>
                <h3>{currentComunicado.title}</h3>
                <div className="comunicado-modal-meta">
                  {currentComunicado.publishedAt ? (
                    <span>{formatDate24(currentComunicado.publishedAt)}</span>
                  ) : (
                    <span className="comunicado-note-draft">Borrador</span>
                  )}
                  {currentComunicado.authorName ? (
                    <span>Por {currentComunicado.authorName}</span>
                  ) : null}
                </div>
                <ComunicadoTags tags={currentComunicado.tags ?? []} />
              </div>
              <button
                aria-label="Cerrar"
                className="icon-button"
                onClick={closeComunicado}
                type="button"
              >
                ✕
              </button>
            </header>
            <div
              className="comunicado-content comunicado-markdown comunicado-modal-body"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(currentComunicado.content),
              }}
            />
            <div className="comunicado-modal-actions">
              <button
                className="ghost-button"
                onClick={() => void copyComunicadoContent(currentComunicado)}
                title="Copia el texto del comunicado, tal como se publica"
                type="button"
              >
                📋 Copiar mensaje
              </button>
              <button
                className="ghost-button"
                onClick={() => void copyComunicadoLink(currentComunicado)}
                type="button"
              >
                🔗 Copiar enlace
              </button>
              {canManageComunicados ? (
                <>
                  {currentComunicado.publishedAt ? null : (
                    <button
                      className="primary-button"
                      onClick={() =>
                        void handlePublishCommunication(currentComunicado.id)
                      }
                      type="button"
                    >
                      Publicar
                    </button>
                  )}
                  <button
                    className="ghost-button"
                    onClick={() => openComunicadoEditor(currentComunicado)}
                    type="button"
                  >
                    ✏️ Editar
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      setCommEditor({
                        id: null,
                        title: currentComunicado.title,
                        content: currentComunicado.content,
                        channelId: currentComunicado.channelId ?? "",
                        tags: currentComunicado.tags ?? [],
                      })
                    }
                    title="Crea un comunicado nuevo con este mismo texto"
                    type="button"
                  >
                    Duplicar
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() =>
                      requestDeleteCommunication(currentComunicado)
                    }
                    type="button"
                  >
                    Eliminar comunicado
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

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
            <h4>{commEditor.id ? "Editar comunicado" : "Nuevo comunicado"}</h4>
            {commEditorPublished ? (
              <p className="modal-note">
                Este comunicado ya está publicado: al guardar también se
                actualiza el mensaje en Discord.
              </p>
            ) : null}
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
              <div className="event-tag-field">
                <span className="event-tag-title">Etiquetas</span>
                <TagsField
                  onChange={(tags) =>
                    setCommEditor((current) =>
                      current ? { ...current, tags } : current,
                    )
                  }
                  suggestions={boardTagOptions.map((tag) => tag.label)}
                  tags={commEditor.tags ?? []}
                />
              </div>
            </div>
            <div className="form-actions">
              <button
                className="ghost-button cancel-button"
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

      {reportDownloadEvent ? (
        <ReportFormatModal
          busy={reportBusyEventId === reportDownloadEvent.id}
          onClose={() => setReportDownloadEvent(null)}
          onSelect={(format) => {
            const target = reportDownloadEvent;
            setReportDownloadEvent(null);
            void handleDownloadEventReport(target, format);
          }}
          title={reportDownloadEvent.title}
        />
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
