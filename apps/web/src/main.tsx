import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  getGuildConfig,
  getGuilds,
  getGuildWidgetStatus,
  getMe,
  loginUrl,
  logout,
  saveGuildConfig,
  type ApiGuild,
  type GuildConfig,
  type GuildWidgetStatus,
} from "./api";
import "./styles.css";

type HubTab = "home" | "admin" | "raids" | "eventos" | "memes" | "muro";

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
  if (tab === "home") {
    return "Home";
  }

  if (tab === "admin") {
    return "Admin";
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

  return "Muro";
}

function panelTitle(tab: HubTab): string {
  if (tab === "home") {
    return "Resumen del Hub";
  }

  if (tab === "admin") {
    return "Panel de Admin";
  }

  if (tab === "raids") {
    return "Panel de Raids";
  }

  if (tab === "eventos") {
    return "Panel de Eventos";
  }

  if (tab === "memes") {
    return "Panel de Memes";
  }

  return "Muro de la Comunidad";
}

function panelDescription(tab: HubTab): string {
  if (tab === "home") {
    return "Vista general para coordinar Discord, bot y herramientas de comunidad.";
  }

  if (tab === "admin") {
    return "Config base de guild, roles y módulos compartidos entre bot y web.";
  }

  if (tab === "raids") {
    return "Próximo paso: roster, disponibilidad y composición por rol/spec.";
  }

  if (tab === "eventos") {
    return "Próximo paso: calendario, estados de asistencia y sincronización con Discord.";
  }

  if (tab === "memes") {
    return "Próximo paso: highlights, clips y contenido curado de la comunidad.";
  }

  return "Próximo paso: perfiles destacados, hall of fame y contribuciones clave.";
}

function WidgetStatusCard({
  status,
  loading,
}: {
  status: GuildWidgetStatus | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="stacked-card">
        <span className="label">Discord en vivo</span>
        <strong>Cargando estado...</strong>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="stacked-card">
        <span className="label">Discord en vivo</span>
        <strong>Inicia sesión para ver métricas</strong>
      </div>
    );
  }

  if (!status.available) {
    return (
      <div className="stacked-card">
        <span className="label">Discord en vivo</span>
        <strong>Widget no disponible</strong>
        <small className="meta-text">
          Activa Server Widget en Discord para mostrar online en tiempo real.
        </small>
      </div>
    );
  }

  return (
    <div className="stacked-card">
      <span className="label">Discord en vivo</span>
      <strong>{status.presenceCount ?? "N/D"} online</strong>
      {status.inviteUrl ? (
        <a
          className="tiny-link"
          href={status.inviteUrl}
          target="_blank"
          rel="noreferrer"
        >
          Abrir invitación pública
        </a>
      ) : null}
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
  const [activeTab, setActiveTab] = useState<HubTab>("home");
  const [status, setStatus] = useState<string>("Listo para iniciar sesión.");
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingGuildData, setLoadingGuildData] = useState(false);
  const loading = loadingSession || loadingGuildData;

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
        setStatus("No hay sesión activa.");
        return;
      }

      const nextGuilds = await getGuilds();
      setUsername(me.global_name ?? me.username);
      setGuilds(nextGuilds);
      setSelectedGuildId((current) => current ?? nextGuilds[0]?.id ?? null);
      setStatus(`Sesión activa como ${me.global_name ?? me.username}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Error al cargar sesión.",
      );
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
          setStatus(
            error instanceof Error ? error.message : "Error al cargar config.",
          );
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
      setStatus("Configuración guardada.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error al guardar.");
    } finally {
      setLoadingGuildData(false);
    }
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
      setStatus("Sesión cerrada.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Error al cerrar sesión.",
      );
    } finally {
      setLoadingSession(false);
    }
  }

  const moduleText = config.enabledModules?.join(", ") ?? "";
  const enabledModuleCount = config.enabledModules?.length ?? 0;
  const tabs: HubTab[] = ["home", "raids", "eventos", "memes", "muro"];
  const visibleTabs = adminEnabled ? ([...tabs, "admin"] as HubTab[]) : tabs;

  useEffect(() => {
    if (activeTab === "admin" && !adminEnabled) {
      setActiveTab("home");
    }
  }, [activeTab, adminEnabled]);

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
            <div className="status">{status}</div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <main className="hub-layout">
        <section className="panel welcome-panel">
          <div className="eyebrow">Guild Hub</div>
          <h1>{selectedGuild?.name ?? "Bonafide"}</h1>
          <p>
            Bienvenido {username}. Este hub será el centro para raids, eventos,
            roles, XP y administración general de la comunidad.
          </p>

          <div className="hero-actions">
            <button
              className="ghost-button"
              onClick={refreshSession}
              disabled={loading}
            >
              Refrescar sesión
            </button>
            <button
              className="ghost-button danger"
              onClick={handleLogout}
              disabled={loading}
            >
              Cerrar sesión
            </button>
          </div>

          <div className="status">{status}</div>
        </section>

        <section className="panel preview-panel">
          {selectedGuildIcon ? (
            <img
              className="guild-cover"
              src={selectedGuildIcon}
              alt="Icono de la guild"
            />
          ) : (
            <div
              className="cover-art"
              role="img"
              aria-label="Portada de guild"
            />
          )}

          <div className="preview-grid">
            <WidgetStatusCard
              status={widgetStatus}
              loading={loadingGuildData}
            />
            <div className="stacked-card">
              <span className="label">Guilds administrables</span>
              <strong>{guilds.length}</strong>
            </div>
            <div className="stacked-card">
              <span className="label">Módulos activos</span>
              <strong>{enabledModuleCount}</strong>
            </div>
          </div>
        </section>

        <section className="panel sidebar">
          <h2>Sesión</h2>
          <div className="stacked-card">
            <span className="label">Usuario</span>
            <strong>{username}</strong>
          </div>
          <div className="stacked-card">
            <span className="label">Guild activa</span>
            <strong>{selectedGuild?.name ?? "Sin selección"}</strong>
          </div>
          <div className="stacked-card">
            <span className="label">Estado</span>
            <strong>{loading ? "Cargando..." : "Idle"}</strong>
          </div>

          <label className="select-label">
            <span className="label">Cambiar guild</span>
            <select
              className="select"
              value={selectedGuildId ?? ""}
              onChange={(event) => setSelectedGuildId(event.target.value)}
            >
              <option value="" disabled>
                Selecciona una guild
              </option>
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {formatGuildLabel(guild)}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="panel main-content tab-bar">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              className={`tab-button ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tabLabel(tab)}
            </button>
          ))}
        </section>

        <section className="panel main-content">
          <div className="section-header">
            <div>
              <h2>{panelTitle(activeTab)}</h2>
              <p>{panelDescription(activeTab)}</p>
            </div>
          </div>

          {activeTab === "admin" && selectedGuild && adminEnabled ? (
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
                <span>Dynamic voice channel ID</span>
                <input
                  value={config.dynamicVoiceCreateChannelId ?? ""}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      dynamicVoiceCreateChannelId:
                        event.target.value || undefined,
                    }))
                  }
                  placeholder="Canal disparador de voz"
                />
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

              <label>
                <span>Módulos habilitados</span>
                <input
                  value={moduleText}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      enabledModules: event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder="reminders, xp, reaction-roles"
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
          ) : activeTab === "home" ? (
            <div className="cards-grid">
              <div className="stacked-card">
                <span className="label">Próximo bloque</span>
                <strong>Gestión de eventos y raids</strong>
                <small className="meta-text">
                  Crear evento, cupos, estados de asistencia y sync con Discord.
                </small>
              </div>
              <div className="stacked-card">
                <span className="label">Objetivo admin</span>
                <strong>Roles + Reaction Roles + XP</strong>
                <small className="meta-text">
                  Centralizar setup operativo para que no dependa solo de
                  comandos.
                </small>
              </div>
              <div className="stacked-card">
                <span className="label">Arquitectura</span>
                <strong>Una fuente de verdad (API + DB)</strong>
                <small className="meta-text">
                  Bot y Web consumen la misma lógica para evitar duplicaciones.
                </small>
              </div>
            </div>
          ) : activeTab === "admin" ? (
            <div className="empty-state">
              {selectedGuild
                ? "No tienes permisos para ver el panel Admin en esta guild."
                : "No hay guild seleccionada o no tenes permisos para ver una."}
            </div>
          ) : (
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
