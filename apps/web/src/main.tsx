import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  createCommunication,
  createReactionRolePanel,
  deleteCommunication,
  deleteCommunicationInstance,
  deleteReactionRoleJob,
  deleteReactionRolePanel,
  exportXpData,
  getAuditLogs,
  getGuildBoosters,
  getGuildConfig,
  getGuildEmojis,
  getGuildRoles,
  getGuilds,
  getGuildTextChannels,
  getGuildVoiceChannels,
  getGuildWidgetStatus,
  getLeaderboard,
  getMe,
  getPublicLeaderboard,
  getXpConfig,
  importXpData,
  listCommunications,
  listPublishedCommunications,
  listReactionRoleJobs,
  listReactionRolePanels,
  loginUrl,
  logout,
  publishCommunication,
  publishReactionRolePanel,
  requestXpSync,
  resetAllXp,
  saveGuildConfig,
  saveXpConfig,
  updateCommunication,
  updateReactionRolePanel,
  type ApiGuild,
  type AuditLogEntry,
  type Communication,
  type CommunicationInput,
  type CommunicationInstance,
  type GuildBooster,
  type GuildChannel,
  type GuildConfig,
  type GuildEmoji,
  type GuildRole,
  type GuildWidgetStatus,
  type LeaderboardEntry,
  type PublicLeaderboardEntry,
  type ReactionRoleJob,
  type ReactionRolePairInput,
  type ReactionRolePanel,
  type XpConfig,
  type XpImportEntry,
  type XpRoleMultiplier,
  type XpRoleRule,
} from "./api";
import "./styles.css";

// Renderiza markdown de forma segura (sanitizado) para el contenido de
// los comunicados en el hub. breaks:true respeta los saltos de línea.
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, breaks: true });
  return DOMPurify.sanitize(typeof html === "string" ? html : "");
}

type RrEditorState = {
  channelId: string;
  description: string;
  messageId: string;
  mode: "multiple" | "unique" | "additive";
  pairs: ReactionRolePairInput[];
  title: string;
};

type HubTab =
  | "home"
  | "dashboard"
  | "comunicados"
  | "raids"
  | "eventos"
  | "memes"
  | "muro"
  | "admin";

const VALID_TABS: HubTab[] = [
  "home",
  "dashboard",
  "comunicados",
  "raids",
  "eventos",
  "memes",
  "muro",
  "admin",
];

function tabFromHash(): HubTab {
  const raw = window.location.hash.replace(/^#\/?/, "").trim().toLowerCase();
  return (VALID_TABS as string[]).includes(raw) ? (raw as HubTab) : "home";
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

  if (tab === "muro") {
    return "Muro";
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

  if (tab === "muro") {
    return "Muro de la Comunidad";
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
    return "Anuncios y comunicados de la guild.";
  }

  if (tab === "raids") {
    return "Roster, disponibilidad y composición por rol/spec.";
  }

  if (tab === "eventos") {
    return "Calendario, estados de asistencia y sincronización con Discord.";
  }

  if (tab === "memes") {
    return "Highlights, clips y contenido curado de la comunidad.";
  }

  if (tab === "muro") {
    return "Perfiles destacados, hall of fame y contribuciones clave.";
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

const PODIUM_TIERS = [
  { color: "#ffd700", label: "Oro" },
  { color: "#c0c0c0", label: "Plata" },
  { color: "#cd7f32", label: "Bronce" },
  { color: "#9aa3ad", label: "Hierro" },
  { color: "#b87333", label: "Cobre" },
] as const;

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
        <h1>Bienvenido a Bonafide</h1>
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
  const [guilds, setGuilds] = useState<ApiGuild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [config, setConfig] = useState<GuildConfig>({});
  const [widgetStatus, setWidgetStatus] = useState<GuildWidgetStatus | null>(
    null,
  );
  const [voiceChannels, setVoiceChannels] = useState<GuildChannel[]>([]);
  const [textChannels, setTextChannels] = useState<GuildChannel[]>([]);
  const [guildRoles, setGuildRoles] = useState<GuildRole[]>([]);
  const [xpConfig, setXpConfig] = useState<XpConfig | null>(null);
  const [reactionPanels, setReactionPanels] = useState<ReactionRolePanel[]>([]);
  const [rrChannelId, setRrChannelId] = useState("");
  const [rrTitle, setRrTitle] = useState("");
  const [rrDescription, setRrDescription] = useState("");
  const [rrMode, setRrMode] = useState<"multiple" | "unique" | "additive">(
    "multiple",
  );
  const [rrPairs, setRrPairs] = useState<ReactionRolePairInput[]>([
    { emoji: "", roleId: "" },
  ]);
  const [guildEmojis, setGuildEmojis] = useState<GuildEmoji[]>([]);
  const [rrEditor, setRrEditor] = useState<RrEditorState | null>(null);
  const [expandedPanelId, setExpandedPanelId] = useState<string | null>(null);
  const [rrJobs, setRrJobs] = useState<ReactionRoleJob[]>([]);
  const [savingAction, setSavingAction] = useState<
    "config" | "xp" | "panel" | null
  >(null);
  const [roleModal, setRoleModal] = useState<{
    kind: "add" | "remove";
    level: number;
  } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [boosters, setBoosters] = useState<GuildBooster[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [published, setPublished] = useState<CommunicationInstance[]>([]);
  const [expandedPublished, setExpandedPublished] = useState<Set<string>>(
    new Set(),
  );
  const [landingPreview, setLandingPreview] = useState<
    PublicLeaderboardEntry[]
  >([]);
  const [commEditor, setCommEditor] = useState<
    (CommunicationInput & { id: string | null }) | null
  >(null);
  const [activeTab, setActiveTab] = useState<HubTab>(() => tabFromHash());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(
    null,
  );
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingGuildData, setLoadingGuildData] = useState(false);
  const loading = loadingSession || loadingGuildData;
  const importFileRef = useRef<HTMLInputElement | null>(null);

  function pushToast(message: string, kind: ToastKind = "success"): void {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? null,
    [guilds, selectedGuildId],
  );
  const selectedGuildIcon = guildIconUrl(selectedGuild);
  const adminEnabled = canAccessAdmin(selectedGuild);

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
      setUsername(me.global_name ?? me.username);
      setGuilds(nextGuilds);
      setSelectedGuildId((current) => current ?? nextGuilds[0]?.id ?? null);
    } catch (error) {
      void error;
      pushToast("No se pudo validar la sesión.", "error");
    } finally {
      setLoadingSession(false);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!selectedGuildId) {
      return;
    }

    let cancelled = false;
    setLoadingGuildData(true);
    Promise.all([
      getGuildConfig(selectedGuildId),
      getGuildWidgetStatus(selectedGuildId),
      getLeaderboard(selectedGuildId),
    ])
      .then(([nextConfig, nextWidgetStatus, nextLeaderboard]) => {
        if (cancelled) {
          return;
        }

        setConfig(nextConfig);
        setWidgetStatus(nextWidgetStatus);
        setLeaderboard(nextLeaderboard);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void error;
          pushToast("No se pudo cargar la configuración.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingGuildData(false);
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
      return;
    }
    let cancelled = false;
    listPublishedCommunications(selectedGuildId)
      .then((list) => {
        if (!cancelled) {
          setPublished(list);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedGuildId]);

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
      pushToast("Publicado en Discord.", "success");
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

  async function handleSave(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setSavingAction("config");
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, config);
      setConfig(nextConfig);
      pushToast("Configuración guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración.", "error");
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

  function updateRrPair(
    index: number,
    patch: Partial<ReactionRolePairInput>,
  ): void {
    setRrPairs((current) =>
      current.map((pair, pairIndex) =>
        pairIndex === index ? { ...pair, ...patch } : pair,
      ),
    );
  }

  function addRrPair(): void {
    setRrPairs((current) => [...current, { emoji: "", roleId: "" }]);
  }

  function removeRrPair(index: number): void {
    setRrPairs((current) =>
      current.length === 1
        ? current
        : current.filter((_, pairIndex) => pairIndex !== index),
    );
  }

  function emojiKeyToEditable(emojiKey: string): string {
    if (emojiKey.startsWith("custom:")) {
      const id = emojiKey.slice("custom:".length);
      const found = guildEmojis.find((emoji) => emoji.id === id);
      return found
        ? found.animated
          ? `<a:${found.name}:${found.id}>`
          : `<:${found.name}:${found.id}>`
        : id;
    }
    if (emojiKey.startsWith("unicode:")) {
      return emojiKey.slice("unicode:".length);
    }
    return emojiKey;
  }

  function normalizeEmoji(emoji: string): string {
    const trimmed = emoji.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (/^<a?:\w+:\d+>$/.test(trimmed) || /^\d+$/.test(trimmed)) {
      return trimmed;
    }
    if (/[^\x00-\x7F]/.test(trimmed)) {
      return trimmed;
    }
    const bare = trimmed.replace(/^:+/u, "").replace(/:+$/u, "");
    const found = guildEmojis.find((entry) => entry.name === bare);
    if (found) {
      return found.animated
        ? `<a:${found.name}:${found.id}>`
        : `<:${found.name}:${found.id}>`;
    }
    // Si no lo encontramos localmente, devolvemos el nombre sin dos
    // puntos para que el bot lo resuelva contra su caché de emojis.
    return bare;
  }

  function formatEmojiKey(emojiKey: string): string {
    if (emojiKey.startsWith("custom:")) {
      const id = emojiKey.slice("custom:".length);
      const found = guildEmojis.find((emoji) => emoji.id === id);
      return found ? `:${found.name}:` : emojiKey;
    }
    if (emojiKey.startsWith("unicode:")) {
      return emojiKey.slice("unicode:".length);
    }
    return emojiKey;
  }

  // Las reglas de una plantilla guardan el emoji directo; las de paneles
  // viejos pueden venir como emojiKey (custom:/unicode:).
  function reactionRuleEmojiToEditable(emoji: string): string {
    if (emoji.startsWith("custom:") || emoji.startsWith("unicode:")) {
      return emojiKeyToEditable(emoji);
    }
    return emoji;
  }

  function formatReactionRuleEmoji(emoji: string): string {
    if (emoji.startsWith("custom:") || emoji.startsWith("unicode:")) {
      return formatEmojiKey(emoji);
    }
    return emoji;
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

  function rrPreviewLines(): string[] {
    const roleRow = rrPairs
      .filter((pair) => pair.emoji.trim() && pair.roleId)
      .map((pair) => {
        const emoji = normalizeEmoji(pair.emoji);
        const roleName =
          guildRoles.find((role) => role.id === pair.roleId)?.name ?? "Rol";
        return `${emoji} ${roleName}`;
      })
      .join("   ");

    return [
      rrDescription.trim() ? `**${rrDescription.trim()}**` : "",
      roleRow,
    ].filter((line) => line.length > 0);
  }

  async function refreshRrJobs(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const jobs = await listReactionRoleJobs(selectedGuildId);
      setRrJobs(jobs);
    } catch {
      // fallo silencioso: se puede reintentar con el icono de refrescar
    }
  }

  async function dismissReactionRoleJob(jobId: string): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await deleteReactionRoleJob(selectedGuildId, jobId);
      setRrJobs((current) => current.filter((job) => job.id !== jobId));
    } catch {
      pushToast("No se pudo quitar el trabajo de la lista.", "error");
    }
  }

  async function refreshReactionPanels(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      const panels = await listReactionRolePanels(selectedGuildId);
      setReactionPanels(panels);
    } catch {
      // fallo silencioso
    }
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

  // Abre el modal de edición con los datos de la plantilla.
  function startEditReactionTemplate(panel: ReactionRolePanel): void {
    setRrEditor({
      channelId: panel.channelId ?? "",
      description: panel.description ?? "",
      messageId: panel.messageId,
      mode: (panel.mode === "unique" || panel.mode === "additive"
        ? panel.mode
        : "multiple") as "multiple" | "unique" | "additive",
      pairs: panel.rules.map((rule) => ({
        emoji: reactionRuleEmojiToEditable(rule.emoji),
        roleId: rule.roleId,
      })),
      title: panel.title ?? "",
    });
  }

  // El formulario superior siempre crea una plantilla nueva (borrador).
  async function handleSaveReactionPanel(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    const validPairs = rrPairs
      .filter((pair) => pair.emoji.trim() && pair.roleId)
      .map((pair) => ({
        emoji: normalizeEmoji(pair.emoji),
        roleId: pair.roleId,
      }));

    const input = {
      channelId: rrChannelId || undefined,
      description: rrDescription.trim() || undefined,
      mode: rrMode,
      pairs: validPairs,
      title: rrTitle.trim() || undefined,
    };

    setSavingAction("panel");
    try {
      await createReactionRolePanel(selectedGuildId, input);
      pushToast("Plantilla guardada (borrador).", "success");

      setRrChannelId("");
      setRrTitle("");
      setRrDescription("");
      setRrPairs([{ emoji: "", roleId: "" }]);
      void refreshRrJobs();
      void refreshReactionPanels();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      pushToast(`No se pudo guardar la plantilla: ${message}`, "error");
    } finally {
      setSavingAction(null);
    }
  }

  // ── Edición en modal ──────────────────────────────────────────────
  function updateRrEditorField<K extends keyof RrEditorState>(
    field: K,
    value: RrEditorState[K],
  ): void {
    setRrEditor((current) =>
      current ? { ...current, [field]: value } : current,
    );
  }

  function updateRrEditorPair(
    index: number,
    patch: Partial<ReactionRolePairInput>,
  ): void {
    setRrEditor((current) => {
      if (!current) {
        return current;
      }
      const pairs = current.pairs.map((pair, i) =>
        i === index ? { ...pair, ...patch } : pair,
      );
      return { ...current, pairs };
    });
  }

  function addRrEditorPair(): void {
    setRrEditor((current) =>
      current
        ? { ...current, pairs: [...current.pairs, { emoji: "", roleId: "" }] }
        : current,
    );
  }

  function removeRrEditorPair(index: number): void {
    setRrEditor((current) =>
      current
        ? {
            ...current,
            pairs: current.pairs.filter((_, i) => i !== index),
          }
        : current,
    );
  }

  async function handleSaveRrEditor(): Promise<void> {
    if (!selectedGuildId || !rrEditor) {
      return;
    }

    const validPairs = rrEditor.pairs
      .filter((pair) => pair.emoji.trim() && pair.roleId)
      .map((pair) => ({
        emoji: normalizeEmoji(pair.emoji),
        roleId: pair.roleId,
      }));

    setSavingAction("panel");
    try {
      await updateReactionRolePanel(selectedGuildId, rrEditor.messageId, {
        channelId: rrEditor.channelId || undefined,
        description: rrEditor.description.trim() || undefined,
        mode: rrEditor.mode,
        pairs: validPairs,
        title: rrEditor.title.trim() || undefined,
      });
      pushToast("Plantilla guardada.", "success");
      setRrEditor(null);
      void refreshRrJobs();
      void refreshReactionPanels();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      pushToast(`No se pudo guardar la plantilla: ${message}`, "error");
    } finally {
      setSavingAction(null);
    }
  }

  function requestDeleteReactionPanel(panel: ReactionRolePanel): void {
    if (!selectedGuildId) {
      return;
    }

    setConfirmDialog({
      kind: "danger",
      title: "Eliminar panel de reaction roles",
      message:
        "Se va a eliminar este panel: se borra el mensaje en Discord y sus reglas.",
      onConfirm: () => {
        void performDeleteReactionPanel(panel);
      },
    });
  }

  async function performDeleteReactionPanel(
    panel: ReactionRolePanel,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setReactionPanels((current) =>
      current.filter((entry) => entry.messageId !== panel.messageId),
    );
    setExpandedPanelId((current) =>
      current === panel.messageId ? null : current,
    );
    setLoadingGuildData(true);
    try {
      await deleteReactionRolePanel(selectedGuildId, panel.messageId);
      pushToast("Plantilla eliminada.", "success");
      void refreshRrJobs();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      pushToast(`No se pudo eliminar el panel: ${message}`, "error");
    } finally {
      setLoadingGuildData(false);
    }
  }

  // Publica/re-publica una plantilla (crea o actualiza el mensaje en Discord).
  async function handlePublishReactionPanel(
    panel: ReactionRolePanel,
  ): Promise<void> {
    if (!selectedGuildId) {
      return;
    }
    try {
      await publishReactionRolePanel(selectedGuildId, panel.messageId);
      pushToast(
        "Publicación encolada. El bot la aplicará en unos segundos.",
        "success",
      );
      void refreshRrJobs();
      void refreshReactionPanels();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Error al publicar.",
        "error",
      );
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

  const tabs: HubTab[] = [
    "home",
    "dashboard",
    "comunicados",
    "raids",
    "eventos",
    "memes",
    "muro",
  ];
  const visibleTabs = adminEnabled ? ([...tabs, "admin"] as HubTab[]) : tabs;

  useEffect(() => {
    if (activeTab === "admin" && !adminEnabled) {
      setActiveTab("dashboard");
    }
  }, [activeTab, adminEnabled]);

  useEffect(() => {
    const onHashChange = (): void => {
      setActiveTab(tabFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    const target = `#/${activeTab}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "admin" || !selectedGuildId) {
      setVoiceChannels([]);
      setTextChannels([]);
      setGuildRoles([]);
      setReactionPanels([]);
      setGuildEmojis([]);
      setRrJobs([]);
      setAuditLogs([]);
      return;
    }

    let cancelled = false;
    Promise.all([
      getGuildVoiceChannels(selectedGuildId),
      getGuildTextChannels(selectedGuildId),
      getGuildRoles(selectedGuildId),
      listReactionRolePanels(selectedGuildId),
      getGuildEmojis(selectedGuildId),
      listReactionRoleJobs(selectedGuildId),
    ])
      .then(([channels, textCh, roles, panels, emojis, jobs]) => {
        if (cancelled) {
          return;
        }

        setVoiceChannels(channels);
        setTextChannels(textCh);
        setGuildRoles(roles);
        setReactionPanels(panels);
        setGuildEmojis(emojis);
        setRrJobs(jobs);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void error;
          setVoiceChannels([]);
          setTextChannels([]);
          setGuildRoles([]);
          setReactionPanels([]);
          setGuildEmojis([]);
          setRrJobs([]);
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

  useEffect(() => {
    if (
      !selectedGuildId ||
      (activeTab !== "admin" && activeTab !== "dashboard")
    ) {
      setXpConfig(null);
      return;
    }

    let cancelled = false;
    getXpConfig(selectedGuildId)
      .then((xp) => {
        if (!cancelled) {
          setXpConfig(xp);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setXpConfig(null);
        }
      });

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

  useEffect(() => {
    if (activeTab !== "admin" || !selectedGuildId) {
      return;
    }

    const timer = window.setInterval(() => {
      void listReactionRoleJobs(selectedGuildId)
        .then(setRrJobs)
        .catch(() => undefined);
      void listReactionRolePanels(selectedGuildId)
        .then(setReactionPanels)
        .catch(() => undefined);
    }, 20_000);

    return () => window.clearInterval(timer);
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
            <div
              className="landing-banner"
              role="img"
              aria-label="Banner de Bonafide"
            />

            <h1>Bienvenido a Bonafide</h1>

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
                className={`nav-link ${activeTab === tab ? "active" : ""}`}
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
            <span className="user-chip">{username}</span>
            <button
              className="ghost-button"
              onClick={handleLogout}
              disabled={loading}
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
              <h1>Bienvenido a Bonafide</h1>
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
                <>
                  <details className="admin-card admin-card-acc">
                    <summary className="admin-card-header admin-acc-header">
                      <div>
                        <h3>Configuración general del servidor</h3>
                        <p>
                          Canales y roles base del servidor. Se guardan por
                          servidor.
                        </p>
                      </div>
                      <span className="admin-acc-chevron" aria-hidden="true">
                        ▸
                      </span>
                    </summary>
                    <div className="admin-card-body">
                      <div className="form-grid">
                        <label>
                          <span>Canal principal de Karpindomo</span>
                          <select
                            className="select"
                            value={config.memberLogChannelId ?? ""}
                            onChange={(event) =>
                              setConfig((current) => ({
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
                          <span>Rol de entrada del servidor</span>
                          <select
                            className="select"
                            value={config.defaultRoleId ?? ""}
                            onChange={(event) =>
                              setConfig((current) => ({
                                ...current,
                                defaultRoleId: event.target.value || undefined,
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
                            className="select"
                            value={(config.musicRoleIds ?? [])[0] ?? ""}
                            onChange={(event) =>
                              setConfig((current) => ({
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

                        <label>
                          <span>
                            Canal para creación dinámica de salas (voz)
                          </span>
                          <select
                            className="select"
                            value={config.dynamicVoiceCreateChannelId ?? ""}
                            onChange={(event) =>
                              setConfig((current) => ({
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
                      </div>
                    </div>
                    <div className="admin-card-footer">
                      <button
                        className="primary-button"
                        onClick={() => void handleSave()}
                        disabled={savingAction !== null}
                      >
                        {savingAction === "config"
                          ? "Guardando…"
                          : "Guardar cambios"}
                      </button>
                    </div>
                  </details>

                  <details className="admin-card admin-card-acc">
                    <summary className="admin-card-header admin-acc-header">
                      <div>
                        <h3>Plantillas</h3>
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
                          <div className="comunicado-admin-block" key={comm.id}>
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
                                      Mensaje ·{" "}
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
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </details>

                  <details className="admin-card admin-card-acc">
                    <summary className="admin-card-header admin-acc-header">
                      <div>
                        <h3>Reaction Roles</h3>
                        <p>
                          Paneles de roles por reacción que el bot publica en
                          Discord.
                        </p>
                      </div>
                      <span className="admin-acc-chevron" aria-hidden="true">
                        ▸
                      </span>
                    </summary>
                    <div className="admin-card-body">
                      <div className="form-grid">
                        <label>
                          <span>Canal de texto</span>
                          <select
                            className="select"
                            value={rrChannelId}
                            onChange={(event) =>
                              setRrChannelId(event.target.value)
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
                          <span>Título del panel</span>
                          <input
                            value={rrTitle}
                            onChange={(event) => setRrTitle(event.target.value)}
                            placeholder="Título"
                          />
                        </label>
                        <label>
                          <span>Descripción</span>
                          <input
                            value={rrDescription}
                            onChange={(event) =>
                              setRrDescription(event.target.value)
                            }
                            placeholder="Descripción"
                          />
                        </label>
                        <label>
                          <span>Modo</span>
                          <select
                            className="select"
                            value={rrMode}
                            onChange={(event) =>
                              setRrMode(
                                event.target.value as
                                  | "multiple"
                                  | "unique"
                                  | "additive",
                              )
                            }
                          >
                            <option value="multiple">
                              Multiple (se puede tener varios)
                            </option>
                            <option value="unique">
                              Único (solo uno del panel)
                            </option>
                            <option value="additive">
                              Aditivo (solo agrega, no quita)
                            </option>
                          </select>
                        </label>
                      </div>

                      <div className="rr-pairs">
                        {rrPairs.map((pair, index) => (
                          <div className="rr-pair" key={index}>
                            <input
                              type="text"
                              list="guild-emojis"
                              value={pair.emoji}
                              onChange={(event) =>
                                updateRrPair(index, {
                                  emoji: event.target.value,
                                })
                              }
                              placeholder="Emoji del servidor"
                            />
                            <select
                              className="select"
                              value={pair.roleId}
                              onChange={(event) =>
                                updateRrPair(index, {
                                  roleId: event.target.value,
                                })
                              }
                            >
                              <option value="">Adjuntar rol</option>
                              {guildRoles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                            <button
                              className="ghost-button danger"
                              onClick={() => removeRrPair(index)}
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          className="ghost-button"
                          onClick={addRrPair}
                          type="button"
                        >
                          + Agregar par emoji/rol
                        </button>
                      </div>

                      <datalist id="guild-emojis">
                        {guildEmojis.map((emoji) => (
                          <option
                            key={emoji.id}
                            value={
                              emoji.animated
                                ? `<a:${emoji.name}:${emoji.id}>`
                                : `<:${emoji.name}:${emoji.id}>`
                            }
                          >
                            {emoji.name}
                          </option>
                        ))}
                      </datalist>

                      <div className="rr-preview">
                        <div className="rr-preview-label">
                          Vista previa del mensaje
                        </div>
                        {rrPreviewLines().length > 0 ? (
                          rrPreviewLines().map((line, index) =>
                            line.startsWith("**") && line.endsWith("**") ? (
                              <div className="rr-preview-title" key={index}>
                                {line.slice(2, -2)}
                              </div>
                            ) : (
                              <div className="rr-preview-line" key={index}>
                                {line}
                              </div>
                            ),
                          )
                        ) : (
                          <div className="rr-preview-line muted">
                            Sin contenido para previsualizar.
                          </div>
                        )}
                      </div>

                      <div className="rr-jobs">
                        {rrJobs.length > 0 ? (
                          <>
                            <div className="rr-jobs-head">
                              <strong>Estado de publicación</strong>
                              <button
                                className="icon-button"
                                onClick={() => void refreshRrJobs()}
                                title="Refrescar estado"
                                aria-label="Refrescar estado"
                                type="button"
                              >
                                <RefreshIcon />
                              </button>
                            </div>
                            <div className="rr-jobs-list">
                              {rrJobs.filter((job) => job.status !== "done")
                                .length > 0 ? (
                                rrJobs
                                  .filter((job) => job.status !== "done")
                                  .slice(0, 5)
                                  .map((job) => (
                                    <div
                                      className={`rr-job rr-job-${job.status}`}
                                      key={job.id}
                                    >
                                      <div className="rr-job-line">
                                        <span>
                                          {job.status === "pending"
                                            ? "En cola"
                                            : "Error"}{" "}
                                          · {job.action}
                                          {job.title ? ` · ${job.title}` : ""}
                                          {job.status !== "pending"
                                            ? ` · ${new Date(
                                                job.createdAt,
                                              ).toLocaleString()}`
                                            : ""}
                                        </span>
                                        <button
                                          className="rr-job-dismiss"
                                          onClick={() =>
                                            void dismissReactionRoleJob(job.id)
                                          }
                                          title="Quitar de la lista"
                                          aria-label="Quitar de la lista"
                                          type="button"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                      {job.error ? (
                                        <span className="rr-job-error">
                                          {job.error}
                                        </span>
                                      ) : null}
                                    </div>
                                  ))
                              ) : (
                                <div className="rr-job-ok">
                                  Todo publicado. Sin trabajos pendientes.
                                </div>
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>

                      {reactionPanels.length > 0 ? (
                        <div className="rr-panels-list">
                          <div className="rr-panels-head">
                            <h4>Plantillas ({reactionPanels.length})</h4>
                            <button
                              className="icon-button"
                              onClick={() => void refreshReactionPanels()}
                              title="Refrescar paneles"
                              aria-label="Refrescar paneles"
                              type="button"
                            >
                              <RefreshIcon />
                            </button>
                          </div>
                          {reactionPanels.map((panel) => {
                            const channelName =
                              textChannels.find(
                                (channel) => channel.id === panel.channelId,
                              )?.name ?? "?";
                            const expanded =
                              expandedPanelId === panel.messageId;
                            return (
                              <div
                                className="rr-panel-card"
                                key={panel.messageId}
                              >
                                <button
                                  className="rr-panel-header"
                                  onClick={() =>
                                    setExpandedPanelId(
                                      expanded ? null : panel.messageId,
                                    )
                                  }
                                  type="button"
                                >
                                  <span className="rr-panel-title">
                                    {panel.title || "Plantilla sin título"}
                                  </span>
                                  <span className="rr-panel-meta">
                                    {panel.status === "draft"
                                      ? "Borrador"
                                      : `#${channelName}`}{" "}
                                    · {panel.rules.length} rol/es
                                  </span>
                                  <span className="rr-caret">
                                    {expanded ? "▴" : "▾"}
                                  </span>
                                </button>
                                {expanded ? (
                                  <div className="rr-panel-body">
                                    <div className="rr-rules">
                                      {panel.rules.map((rule, index) => {
                                        const roleName =
                                          guildRoles.find(
                                            (role) => role.id === rule.roleId,
                                          )?.name ?? rule.roleId;
                                        return (
                                          <span
                                            className="rr-rule"
                                            key={`${rule.emoji}-${index}`}
                                          >
                                            {formatReactionRuleEmoji(
                                              rule.emoji,
                                            )}{" "}
                                            → {roleName}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <div className="rr-panel-actions">
                                      <button
                                        className="ghost-button"
                                        onClick={() =>
                                          startEditReactionTemplate(panel)
                                        }
                                        type="button"
                                      >
                                        Editar
                                      </button>
                                      <button
                                        className="primary-button"
                                        onClick={() =>
                                          void handlePublishReactionPanel(panel)
                                        }
                                        type="button"
                                      >
                                        {panel.status === "published"
                                          ? "Republicar"
                                          : "Publicar"}
                                      </button>
                                      <button
                                        className="danger-button"
                                        onClick={() =>
                                          requestDeleteReactionPanel(panel)
                                        }
                                        type="button"
                                      >
                                        Eliminar plantilla
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="admin-card-footer">
                      <button
                        className="primary-button"
                        onClick={() => void handleSaveReactionPanel()}
                        disabled={savingAction !== null}
                        type="button"
                      >
                        {savingAction === "panel"
                          ? "Guardando…"
                          : "Guardar plantilla"}
                      </button>
                    </div>
                  </details>

                  {xpConfig ? (
                    <details className="admin-card admin-card-acc">
                      <summary className="admin-card-header admin-acc-header">
                        <div>
                          <h3>Sistema de XP</h3>
                          <p>
                            Configuración de niveles, roles por nivel y
                            multiplicadores.
                          </p>
                        </div>
                        <span className="admin-acc-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </summary>
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
                            onChange={(event) => void handleImportXpFile(event)}
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
                    </details>
                  ) : null}

                  <details className="admin-card admin-card-acc">
                    <summary className="admin-card-header admin-acc-header">
                      <div>
                        <h3>Registro de cambios (auditoría)</h3>
                        <p>
                          Quién cambió cada cosa en el Hub. Solo lectura y
                          visible únicamente para el owner.
                        </p>
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
                            Solo el owner de la guild puede ver este registro.
                          </div>
                        )}
                      </div>
                    </details>
                </>
              ) : activeTab === "admin" ? (
                <div className="empty-state">
                  {selectedGuild
                    ? "No tienes permisos para ver el panel Admin en esta guild."
                    : "No hay guild seleccionada o no tenes permisos para ver una."}
                </div>
              ) : activeTab === "comunicados" ? (
                <div className="comunicados-stack">
                  {published.length === 0 ? (
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
                            </div>
                          ) : null}
                        </article>
                      );
                    })
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

      {rrEditor != null ? (
        <div className="modal-overlay" onClick={() => setRrEditor(null)}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4>Editar plantilla de reaction roles</h4>
            <div className="comm-form">
              <label>
                <span>Título</span>
                <input
                  type="text"
                  value={rrEditor.title}
                  onChange={(event) =>
                    updateRrEditorField("title", event.target.value)
                  }
                  placeholder="Título"
                />
              </label>
              <label>
                <span>Descripción</span>
                <input
                  type="text"
                  value={rrEditor.description}
                  onChange={(event) =>
                    updateRrEditorField("description", event.target.value)
                  }
                  placeholder="Descripción"
                />
              </label>
              <label>
                <span>Canal de texto</span>
                <select
                  className="select"
                  value={rrEditor.channelId}
                  onChange={(event) =>
                    updateRrEditorField("channelId", event.target.value)
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
                <span>Modo</span>
                <select
                  className="select"
                  value={rrEditor.mode}
                  onChange={(event) =>
                    updateRrEditorField(
                      "mode",
                      event.target.value as
                        | "multiple"
                        | "unique"
                        | "additive",
                    )
                  }
                >
                  <option value="multiple">
                    Multiple (se puede tener varios)
                  </option>
                  <option value="unique">Único (solo uno del panel)</option>
                  <option value="additive">
                    Aditivo (solo agrega, no quita)
                  </option>
                </select>
              </label>
            </div>

            <div className="rr-pairs">
              {rrEditor.pairs.map((pair, index) => (
                <div className="rr-pair" key={index}>
                  <input
                    type="text"
                    list="guild-emojis"
                    value={pair.emoji}
                    onChange={(event) =>
                      updateRrEditorPair(index, {
                        emoji: event.target.value,
                      })
                    }
                    placeholder="Emoji del servidor"
                  />
                  <select
                    className="select"
                    value={pair.roleId}
                    onChange={(event) =>
                      updateRrEditorPair(index, {
                        roleId: event.target.value,
                      })
                    }
                  >
                    <option value="">Adjuntar rol</option>
                    {guildRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="ghost-button danger"
                    onClick={() => removeRrEditorPair(index)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="ghost-button"
                onClick={addRrEditorPair}
                type="button"
              >
                + Agregar par emoji/rol
              </button>
            </div>

            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setRrEditor(null)}
                disabled={savingAction !== null}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                onClick={() => void handleSaveRrEditor()}
                disabled={savingAction !== null}
                type="button"
              >
                {savingAction === "panel" ? "Guardando…" : "Guardar cambios"}
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
