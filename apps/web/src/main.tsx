import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  exportXpData,
  getGuildConfig,
  getGuildRoles,
  getGuilds,
  getGuildTextChannels,
  getGuildVoiceChannels,
  getGuildWidgetStatus,
  getLeaderboard,
  getMe,
  getXpConfig,
  importXpData,
  loginUrl,
  logout,
  requestXpSync,
  resetAllXp,
  saveGuildConfig,
  saveXpConfig,
  type ApiGuild,
  type GuildChannel,
  type GuildConfig,
  type GuildRole,
  type GuildWidgetStatus,
  type LeaderboardEntry,
  type XpConfig,
  type XpImportEntry,
  type XpRoleMultiplier,
  type XpRoleRule,
} from "./api";
import "./styles.css";

type HubTab =
  | "dashboard"
  | "comunicados"
  | "raids"
  | "eventos"
  | "memes"
  | "muro"
  | "admin";

const VALID_TABS: HubTab[] = [
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
  return (VALID_TABS as string[]).includes(raw) ? (raw as HubTab) : "dashboard";
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

function hasPermissionBit(permissions: string, bitIndex: number): boolean {
  try {
    const mask = 1n << BigInt(bitIndex);
    return (BigInt(permissions) & mask) === mask;
  } catch {
    return false;
  }
}

function canAccessAdmin(guild: ApiGuild | null): boolean {
  if (!guild) {
    return false;
  }

  if (guild.owner) {
    return true;
  }

  const hasAdministrator = hasPermissionBit(guild.permissions, 3);
  const hasManageGuild = hasPermissionBit(guild.permissions, 5);
  return hasAdministrator || hasManageGuild;
}

function guildIconUrl(guild: ApiGuild | null): string | null {
  if (!guild?.icon) {
    return null;
  }

  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`;
}

function tabLabel(tab: HubTab): string {
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

  return (
    <div className="stats-grid">
      <div className="stat-tile">
        <span className="label">Conectados</span>
        <strong>{connected ?? "—"}</strong>
      </div>
      <div className="stat-tile">
        <span className="label">Miembros totales</span>
        <strong>{totalMembers ?? "—"}</strong>
      </div>
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
  const [roleModal, setRoleModal] = useState<{
    kind: "add" | "remove";
    level: number;
  } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activeTab, setActiveTab] = useState<HubTab>(() => tabFromHash());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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

  async function handleSave(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    setLoadingGuildData(true);
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, config);
      setConfig(nextConfig);
      pushToast("Configuración guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración.", "error");
    } finally {
      setLoadingGuildData(false);
    }
  }

  async function handleSaveXp(): Promise<void> {
    if (!selectedGuildId || !xpConfig) {
      return;
    }

    setLoadingGuildData(true);
    try {
      const nextXp = await saveXpConfig(selectedGuildId, xpConfig);
      setXpConfig(nextXp);
      pushToast("Configuración de XP guardada.", "success");
    } catch (error) {
      void error;
      pushToast("No se pudo guardar la configuración de XP.", "error");
    } finally {
      setLoadingGuildData(false);
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

    const confirmed = window.confirm(
      `¿Importar ${entries.length} perfil/es de XP? Se reemplazarán los niveles/XP actuales de esos usuarios.`,
    );
    if (!confirmed) {
      return;
    }

    setLoadingGuildData(true);
    try {
      const result = await importXpData(selectedGuildId, entries);
      const nextLeaderboard = await getLeaderboard(selectedGuildId);
      setLeaderboard(nextLeaderboard);
      pushToast(`${result.imported} perfiles de XP importados.`, "success");
    } catch (error) {
      void error;
      pushToast("No se pudo importar el XP.", "error");
    } finally {
      setLoadingGuildData(false);
    }
  }

  async function handleResetAllXp(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    const confirmed = window.confirm(
      "⚠️ ¡CUIDADO! Vas a eliminar los niveles y XP de TODOS los miembros del servidor. Esta acción no se puede deshacer. ¿Continuar?",
    );
    if (!confirmed) {
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

  async function handleSyncRoles(): Promise<void> {
    if (!selectedGuildId) {
      return;
    }

    const confirmed = window.confirm(
      "¿Re-sincronizar roles y prefijos de nombre de todos los miembros según su nivel actual? El bot lo procesará en unos segundos.",
    );
    if (!confirmed) {
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
      setXpConfig(null);
      return;
    }

    let cancelled = false;
    Promise.all([
      getGuildVoiceChannels(selectedGuildId),
      getGuildTextChannels(selectedGuildId),
      getGuildRoles(selectedGuildId),
      getXpConfig(selectedGuildId),
    ])
      .then(([channels, textCh, roles, xp]) => {
        if (cancelled) {
          return;
        }

        setVoiceChannels(channels);
        setTextChannels(textCh);
        setGuildRoles(roles);
        setXpConfig(xp);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void error;
          setVoiceChannels([]);
          setTextChannels([]);
          setGuildRoles([]);
          setXpConfig(null);
          pushToast(
            "No se pudieron cargar los datos del panel Admin.",
            "error",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedGuildId]);

  if (!username) {
    return (
      <div className="shell landing-shell">
        <header className="landing-topbar">
          <a className="primary-button" href={loginUrl()}>
            Entrar con Discord
          </a>
        </header>

        <main className="landing-main">
          <section className="panel landing-hero">
            <h1>Bienvenido a Bonafide</h1>
            <div
              className="landing-media"
              role="img"
              aria-label="Portada de Bonafide"
            >
              <div className="cover-art" />
              <div className="carousel-mask">
                <div className="carousel-track">
                  {LANDING_PREVIEW_USERS.map((name) => (
                    <span className="user-pill" key={`a-${name}`}>
                      {name}
                    </span>
                  ))}
                  {LANDING_PREVIEW_USERS.map((name) => (
                    <span className="user-pill" key={`b-${name}`}>
                      {name}
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
          <div className="brand">
            {selectedGuildIcon ? (
              <img
                className="brand-icon"
                src={selectedGuildIcon}
                alt={selectedGuild?.name ?? "Bonafide"}
              />
            ) : null}
            <strong>Bonafide</strong>
          </div>

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
              <ServerStats status={widgetStatus} loading={loadingGuildData} />

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
                        <tr key={entry.userId}>
                          <td>{entry.rank}</td>
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
                              <span className="user-mention">
                                {entry.nickname ||
                                  entry.username ||
                                  `@${entry.userId}`}
                              </span>
                            </span>
                          </td>
                          <td>{entry.level}</td>
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
              <div className="form-grid">
                <label>
                  <span>Canal principal de Karpindomo</span>
                  <select
                    className="select"
                    value={config.memberLogChannelId ?? ""}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        memberLogChannelId: event.target.value || undefined,
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
                  <span>Canal para creación dinámica de salas (voz)</span>
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

                <label>
                  <span>Reaction roles channel ID</span>
                  <input
                    value={config.reactionRolesChannelId ?? ""}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        reactionRolesChannelId: event.target.value || undefined,
                      }))
                    }
                    placeholder="Canal de roles"
                  />
                </label>

                <div className="form-actions">
                  <button
                    className="primary-button"
                    onClick={handleSave}
                    disabled={loading}
                  >
                    Guardar cambios
                  </button>
                </div>
              </div>

              {xpConfig ? (
                <div className="xp-panel">
                  <h3>Sistema de XP</h3>

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
                                  messageXp: Number(event.target.value) || 0,
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
                                  levelBaseXp: Number(event.target.value) || 0,
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
                                    Math.max(0, Number(event.target.value)) ||
                                    0,
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
                              placeholder="🪧"
                              value={rule.nicknamePrefix ?? ""}
                              onChange={(event) =>
                                updateXpRole(rule.level, {
                                  nicknamePrefix: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div
                            className="xp-mode-toggle"
                            title="Comportamiento al alcanzar este nivel"
                          >
                            <button
                              type="button"
                              className={
                                rule.stacking !== "replace" ? "active" : ""
                              }
                              onClick={() =>
                                updateXpRole(rule.level, { stacking: "stack" })
                              }
                            >
                              Acumular
                            </button>
                            <button
                              type="button"
                              className={
                                rule.stacking === "replace" ? "active" : ""
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
                              setRoleModal({ kind: "add", level: rule.level })
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
                            Quitar roles extra ({rule.removeRoleIds.length})
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
                                  multiplier: Number(event.target.value) || 1,
                                })
                              }
                            />
                          </label>
                          <button
                            className="ghost-button danger"
                            onClick={() => removeXpMultiplier(entry.roleId)}
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
                      className="ghost-button danger"
                      onClick={() => void handleResetAllXp()}
                      type="button"
                    >
                      Resetear niveles de todos
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => void handleSyncRoles()}
                      type="button"
                    >
                      Re-sincronizar roles
                    </button>
                  </div>

                  <div className="form-actions">
                    <button
                      className="primary-button"
                      onClick={handleSaveXp}
                      disabled={loading}
                    >
                      Guardar configuración de XP
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : activeTab === "admin" ? (
            <div className="empty-state">
              {selectedGuild
                ? "No tienes permisos para ver el panel Admin en esta guild."
                : "No hay guild seleccionada o no tenes permisos para ver una."}
            </div>
          ) : activeTab === "dashboard" ? null : (
            <div className="empty-state">
              Módulo en preparación. Esta tab ya está lista para conectar su
              backend específico en la próxima iteración.
            </div>
          )}
        </section>
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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
