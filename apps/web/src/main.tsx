import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  getGuildConfig,
  getGuildRoles,
  getGuilds,
  getGuildVoiceChannels,
  getGuildWidgetStatus,
  getMe,
  getXpConfig,
  loginUrl,
  logout,
  saveGuildConfig,
  saveXpConfig,
  type ApiGuild,
  type GuildConfig,
  type GuildRole,
  type GuildVoiceChannel,
  type GuildWidgetStatus,
  type XpConfig,
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
    return "Vista general del servidor: actividad, niveles y herramientas.";
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

  return "Gestión de roles, reaction roles y configuración de la guild.";
}

function ServerStats({
  status,
  guilds,
  modules,
  loading,
}: {
  status: GuildWidgetStatus | null;
  guilds: number;
  modules: number;
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

  const connected =
    status?.available && status.presenceCount != null
      ? status.presenceCount
      : null;
  const total = status?.available && status.name ? undefined : null;

  return (
    <div className="stats-grid">
      <div className="stat-tile">
        <span className="label">Conectados</span>
        <strong>{connected ?? "—"}</strong>
      </div>
      <div className="stat-tile">
        <span className="label">Miembros totales</span>
        <strong>{total ?? "—"}</strong>
      </div>
      <div className="stat-tile">
        <span className="label">Guilds</span>
        <strong>{guilds}</strong>
      </div>
      <div className="stat-tile">
        <span className="label">Módulos activos</span>
        <strong>{modules}</strong>
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
  const [voiceChannels, setVoiceChannels] = useState<GuildVoiceChannel[]>([]);
  const [guildRoles, setGuildRoles] = useState<GuildRole[]>([]);
  const [xpConfig, setXpConfig] = useState<XpConfig | null>(null);
  const [activeTab, setActiveTab] = useState<HubTab>("dashboard");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingGuildData, setLoadingGuildData] = useState(false);
  const loading = loadingSession || loadingGuildData;

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
    ])
      .then(([nextConfig, nextWidgetStatus]) => {
        if (cancelled) {
          return;
        }

        setConfig(nextConfig);
        setWidgetStatus(nextWidgetStatus);
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
          { level: nextLevel, roleId: "", xpMultiplier: 1 },
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

  const enabledModuleCount = config.enabledModules?.length ?? 0;
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
    if (activeTab !== "admin" || !selectedGuildId) {
      setVoiceChannels([]);
      setGuildRoles([]);
      setXpConfig(null);
      return;
    }

    let cancelled = false;
    Promise.all([
      getGuildVoiceChannels(selectedGuildId),
      getGuildRoles(selectedGuildId),
      getXpConfig(selectedGuildId),
    ])
      .then(([channels, roles, xp]) => {
        if (cancelled) {
          return;
        }

        setVoiceChannels(channels);
        setGuildRoles(roles);
        setXpConfig(xp);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void error;
          setVoiceChannels([]);
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
              <p>{panelDescription(activeTab)}</p>
            </div>
          </div>

          {activeTab === "dashboard" ? (
            <div className="dashboard-stack">
              <ServerStats
                status={widgetStatus}
                guilds={guilds.length}
                modules={enabledModuleCount}
                loading={loadingGuildData}
              />
              <div className="dashboard-actions">
                <button
                  className="ghost-button"
                  onClick={refreshSession}
                  disabled={loading}
                >
                  Refrescar sesión
                </button>
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
                  <span>Member log channel ID</span>
                  <input
                    value={config.memberLogChannelId ?? ""}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        memberLogChannelId: event.target.value || undefined,
                      }))
                    }
                    placeholder="Canal de logs"
                  />
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
                      <span>Stacking de roles de nivel</span>
                      <select
                        className="select"
                        value={xpConfig.roleStacking}
                        onChange={(event) =>
                          setXpConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  roleStacking:
                                    event.target.value === "replace"
                                      ? "replace"
                                      : "stack",
                                }
                              : current,
                          )
                        }
                      >
                        <option value="stack">
                          Acumular (mantener roles anteriores)
                        </option>
                        <option value="replace">
                          Reemplazar (solo rol del nivel actual)
                        </option>
                      </select>
                    </label>
                  </div>

                  <h4>Roles por nivel</h4>
                  <div className="xp-roles">
                    {xpConfig.levelRoles.length === 0 ? (
                      <div className="empty-state">
                        Aún no hay roles por nivel configurados.
                      </div>
                    ) : (
                      xpConfig.levelRoles.map((rule) => (
                        <div className="xp-role-row" key={rule.level}>
                          <span className="xp-role-level">
                            Nivel {rule.level}
                          </span>
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
                          <label className="xp-multiplier">
                            <span>Multiplicador</span>
                            <input
                              type="number"
                              min="1"
                              value={rule.xpMultiplier}
                              onChange={(event) =>
                                updateXpRole(rule.level, {
                                  xpMultiplier: Number(event.target.value) || 1,
                                })
                              }
                            />
                          </label>
                          <button
                            className="ghost-button danger"
                            onClick={() => removeXpRole(rule.level)}
                            type="button"
                          >
                            Quitar
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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
