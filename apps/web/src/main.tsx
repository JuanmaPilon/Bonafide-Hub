import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  getGuildConfig,
  getGuilds,
  getMe,
  loginUrl,
  logout,
  saveGuildConfig,
  type ApiGuild,
  type GuildConfig,
} from "./api";
import "./styles.css";

function formatGuildLabel(guild: ApiGuild): string {
  return guild.owner ? `${guild.name} (owner)` : guild.name;
}

function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [guilds, setGuilds] = useState<ApiGuild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [config, setConfig] = useState<GuildConfig>({});
  const [status, setStatus] = useState<string>("Listo para iniciar sesión.");
  const [loading, setLoading] = useState(false);
  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? null,
    [guilds, selectedGuildId],
  );

  async function refreshSession(): Promise<void> {
    setLoading(true);
    try {
      const me = await getMe();
      if (!me) {
        setUsername(null);
        setGuilds([]);
        setSelectedGuildId(null);
        setConfig({});
        setStatus("No hay sesión activa.");
        return;
      }

      const nextGuilds = await getGuilds();
      setUsername(me.global_name ?? me.username);
      setGuilds(nextGuilds);
      setSelectedGuildId((current) => current ?? nextGuilds[0]?.id ?? null);
      setStatus(`Sesión activa como ${me.global_name ?? me.username}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error al cargar sesión.");
    } finally {
      setLoading(false);
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
    setLoading(true);
    getGuildConfig(selectedGuildId)
      .then((nextConfig) => {
        if (!cancelled) {
          setConfig(nextConfig);
        }
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
          setLoading(false);
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

    setLoading(true);
    try {
      const nextConfig = await saveGuildConfig(selectedGuildId, config);
      setConfig(nextConfig);
      setStatus("Configuración guardada.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error al guardar.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    setLoading(true);
    try {
      await logout();
      setUsername(null);
      setGuilds([]);
      setSelectedGuildId(null);
      setConfig({});
      setStatus("Sesión cerrada.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error al cerrar sesión.");
    } finally {
      setLoading(false);
    }
  }

  const moduleText = config.enabledModules?.join(", ") ?? "";

  return (
    <div className="shell">
      <main className="layout">
        <section className="hero panel">
          <div className="eyebrow">Bonafide Hub</div>
          <h1>Panel de administración base para la guild</h1>
          <p>
            Login con Discord, selector de guild y configuración inicial para que
            el bot y la web compartan la misma base.
          </p>
          <div className="actions">
            <a className="primary-button" href={loginUrl()}>
              Iniciar sesión con Discord
            </a>
            <button className="ghost-button" onClick={refreshSession} disabled={loading}>
              Refrescar sesión
            </button>
            <button className="ghost-button danger" onClick={handleLogout} disabled={loading}>
              Cerrar sesión
            </button>
          </div>
          <div className="status">{status}</div>
        </section>

        <section className="panel sidebar">
          <h2>Sesión</h2>
          <div className="stacked-card">
            <span className="label">Usuario</span>
            <strong>{username ?? "No autenticado"}</strong>
          </div>
          <div className="stacked-card">
            <span className="label">Guilds administrables</span>
            <strong>{guilds.length}</strong>
          </div>
          <div className="stacked-card">
            <span className="label">Estado</span>
            <strong>{loading ? "Cargando..." : "Idle"}</strong>
          </div>
        </section>

        <section className="panel main-content">
          <div className="section-header">
            <div>
              <h2>Configuración de guild</h2>
              <p>Edita la config base que luego consumirá el bot y la futura UI.</p>
            </div>
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
          </div>

          {selectedGuild ? (
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
                      dynamicVoiceCreateChannelId: event.target.value || undefined,
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
                <button className="primary-button" onClick={handleSave} disabled={loading}>
                  Guardar cambios
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              No hay guild seleccionada o no tenés permisos para ver una.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <App />,
);
