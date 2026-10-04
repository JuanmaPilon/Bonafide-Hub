import { useMemo, useState, type ReactNode } from "react";
import { classColor, type RaidLog, type RaidLogAnalysis } from "./api";

type Fight = { kill: boolean; name: string; percent?: number };
type NightState = "draft" | "failed" | "pending" | "posted";
type Filter = "all" | "draft" | "live" | "posted";

type Night = {
  date: Date | null;
  error?: string;
  fightCount: number;
  fights: Fight[];
  key: string;
  kills: number;
  live: boolean;
  parts: RaidLog[];
  state: NightState;
  title: string;
};

const STATE_LABEL: Record<NightState, string> = {
  draft: "Sin publicar",
  failed: "Sin datos",
  pending: "Por actualizar",
  posted: "Publicado",
};

const STATE_BADGE: Record<NightState, string> = {
  draft: "",
  failed: "raid-log-failed",
  pending: "raid-log-pending",
  posted: "raid-log-synced",
};

function toNights(logs: RaidLog[]): Night[] {
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

  return [...byKey.entries()].map(([key, group]) => {
    const parts = [...group].sort((a, b) =>
      (a.firstFightAt ?? a.createdAt).localeCompare(
        b.firstFightAt ?? b.createdAt,
      ),
    );
    const failed = parts.some((part) => part.status === "failed");
    const live = parts.some((part) => part.status === "live");
    const posted = parts.some((part) => part.discordPosted);
    const stale = parts.some((part) => part.needsUpdate);
    const started = parts
      .map((part) => part.firstFightAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const rawDate = started ?? parts[0]?.createdAt;
    const date = rawDate ? new Date(rawDate) : null;

    return {
      date: date && !Number.isNaN(date.getTime()) ? date : null,
      error: parts.find((part) => part.error)?.error,
      fightCount: parts.reduce((total, part) => total + part.fightCount, 0),
      fights: parts.flatMap((part) =>
        (part.summary?.fights ?? []).map((fight) => ({
          kill: Boolean(fight.kill),
          name: fight.name ?? "Fight",
          percent: fight.fightPercentage,
        })),
      ),
      key,
      kills: parts.reduce((total, part) => total + part.kills, 0),
      live,
      parts,
      state: posted
        ? stale && !live
          ? "pending"
          : "posted"
        : failed
          ? "failed"
          : "draft",
      title: parts[0]?.title || "Log de raid",
    };
  });
}

function monthOf(date: Date | null): { key: string; label: string } {
  if (!date) {
    return { key: "none", label: "Sin fecha" };
  }
  const label = date.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
  return {
    key: `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`,
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
}

function percentLabel(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function compactNumber(value: number): string {
  return Math.round(value).toLocaleString("es-AR");
}

function bossBreakdown(fights: Fight[]): Array<{
  best?: number;
  kills: number;
  name: string;
  pulls: number;
}> {
  const bosses = new Map<
    string,
    { best?: number; kills: number; name: string; pulls: number }
  >();
  for (const fight of fights) {
    const boss = bosses.get(fight.name) ?? {
      kills: 0,
      name: fight.name,
      pulls: 0,
    };
    boss.pulls += 1;
    if (fight.kill) {
      boss.kills += 1;
    } else if (fight.percent !== undefined) {
      boss.best =
        boss.best === undefined
          ? fight.percent
          : Math.min(boss.best, fight.percent);
    }
    bosses.set(fight.name, boss);
  }
  return [...bosses.values()];
}

function FightStrip({
  fights,
  large = false,
}: {
  fights: Fight[];
  large?: boolean;
}) {
  if (fights.length === 0) {
    return null;
  }
  return (
    <span className={`rlb-strip ${large ? "large" : "compact"}`}>
      {fights.map((fight, index) => (
        <span
          className={`rlb-tick${fight.kill ? " kill" : ""}`}
          key={index}
          title={`${fight.name} · ${fight.kill ? "Kill" : "Wipe"}`}
        />
      ))}
    </span>
  );
}

export function RaidLogsBoard({
  logs,
  manage,
  onAnalyze,
  onHide,
  onPublish,
  onScan,
  onUpdate,
  scanDisabled,
  scanning,
}: {
  logs: RaidLog[];
  manage?: ReactNode;
  onAnalyze?: (log: RaidLog) => Promise<RaidLogAnalysis>;
  onHide?: (parts: RaidLog[]) => void;
  onPublish?: (log: RaidLog) => Promise<void>;
  onScan?: () => void;
  onUpdate?: (log: RaidLog) => Promise<void>;
  scanDisabled?: boolean;
  scanning?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [analysisByNight, setAnalysisByNight] = useState<
    Record<string, RaidLogAnalysis>
  >({});
  const [analysisOpenKey, setAnalysisOpenKey] = useState<string | null>(null);
  const [analysisLoadingKey, setAnalysisLoadingKey] = useState<string | null>(
    null,
  );
  const [analysisError, setAnalysisError] = useState<{
    key: string;
    message: string;
  } | null>(null);

  const nights = useMemo(
    () =>
      toNights(logs).sort(
        (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
      ),
    [logs],
  );

  const counts = useMemo(
    () => ({
      all: nights.length,
      draft: nights.filter((night) => night.state === "draft").length,
      live: nights.filter((night) => night.live).length,
      posted: nights.filter(
        (night) => night.state === "posted" || night.state === "pending",
      ).length,
    }),
    [nights],
  );
  const totalKills = nights.reduce((total, night) => total + night.kills, 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return nights.filter((night) => {
      if (filter === "draft" && night.state !== "draft") {
        return false;
      }
      if (
        filter === "posted" &&
        night.state !== "posted" &&
        night.state !== "pending"
      ) {
        return false;
      }
      if (filter === "live" && !night.live) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const when = night.date?.toLocaleDateString("es-AR") ?? "";
      return `${night.title} ${when}`.toLowerCase().includes(needle);
    });
  }, [filter, nights, search]);

  const months = useMemo(() => {
    const groups: Array<{ key: string; label: string; nights: Night[] }> = [];
    for (const night of visible) {
      const month = monthOf(night.date);
      const last = groups[groups.length - 1];
      if (last && last.key === month.key) {
        last.nights.push(night);
      } else {
        groups.push({ ...month, nights: [night] });
      }
    }
    return groups;
  }, [visible]);

  const selected =
    visible.find((night) => night.key === selectedKey) ?? visible[0] ?? null;
  const bosses = useMemo(
    () => (selected ? bossBreakdown(selected.fights) : []),
    [selected],
  );
  const manageOpen = Boolean(manage) && (showManage || nights.length === 0);
  const selectedAnalysis = selected ? analysisByNight[selected.key] : undefined;
  const selectedDpsColor = classColor(
    selectedAnalysis?.averageDps[0]?.class,
  );
  const selectedAnalysisError =
    selected && analysisError && analysisError.key === selected.key
      ? analysisError.message
      : undefined;

  const runAction = (
    night: Night,
    action: (log: RaidLog) => Promise<void>,
  ): void => {
    setBusyKey(night.key);
    void action(night.parts[0]).finally(() => setBusyKey(null));
  };

  const toggleAnalysis = async (night: Night): Promise<void> => {
    if (analysisOpenKey === night.key) {
      setAnalysisOpenKey(null);
      return;
    }
    setAnalysisOpenKey(night.key);
    setAnalysisError(null);
    if (analysisByNight[night.key] || !onAnalyze) {
      return;
    }

    setAnalysisLoadingKey(night.key);
    try {
      const analysis = await onAnalyze(night.parts[0]);
      setAnalysisByNight((current) => ({ ...current, [night.key]: analysis }));
    } catch (error) {
      setAnalysisError({
        key: night.key,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo analizar la raid.",
      });
    } finally {
      setAnalysisLoadingKey(null);
    }
  };

  const chips: Array<{ count: number; key: Filter; label: string }> = [
    { count: counts.all, key: "all", label: "Todos" },
    { count: counts.draft, key: "draft", label: "Sin publicar" },
    { count: counts.posted, key: "posted", label: "Publicados" },
  ];
  if (counts.live > 0) {
    chips.push({ count: counts.live, key: "live", label: "En vivo" });
  }

  return (
    <div className="rlb">
      <div className="rlb-top">
        <div className="rlb-stats">
          <div className="rlb-stat">
            <strong>{counts.all}</strong>
            <span>Noches</span>
          </div>
          <div className="rlb-stat">
            <strong>{totalKills}</strong>
            <span>Kills</span>
          </div>
          <div className="rlb-stat">
            <strong>{counts.posted}</strong>
            <span>Publicadas</span>
          </div>
          <div className={`rlb-stat${counts.draft > 0 ? " accent" : ""}`}>
            <strong>{counts.draft}</strong>
            <span>Sin publicar</span>
          </div>
        </div>
        {onScan || manage ? (
          <div className="rlb-actions">
            {onScan ? (
              <button
                className="primary-button"
                disabled={scanDisabled || scanning}
                onClick={onScan}
                type="button"
              >
                {scanning ? "Escaneando…" : "Escanear ahora"}
              </button>
            ) : null}
            {manage ? (
              <button
                aria-expanded={manageOpen}
                className="ghost-button"
                onClick={() => setShowManage((current) => !current)}
                type="button"
              >
                Configuración
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {manageOpen ? <section className="rlb-manage">{manage}</section> : null}

      {nights.length === 0 ? (
        <div className="empty-state">Todavía no hay logs de raid.</div>
      ) : (
        <>
          <div className="rlb-toolbar">
            <input
              aria-label="Buscar log"
              autoComplete="off"
              className="rlb-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o fecha…"
              type="search"
              value={search}
            />
            <div className="rlb-chips">
              {chips.map((chip) => (
                <button
                  aria-pressed={filter === chip.key}
                  className={`rlb-chip${filter === chip.key ? " active" : ""}`}
                  key={chip.key}
                  onClick={() => setFilter(chip.key)}
                  type="button"
                >
                  {chip.label}
                  <b>{chip.count}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="rlb-layout">
            <nav aria-label="Noches de raid" className="rlb-list">
              {months.length === 0 ? (
                <div className="rlb-none">Ningún log coincide.</div>
              ) : (
                months.map((month) => (
                  <section key={month.key}>
                    <h4 className="rlb-month">
                      <span>{month.label}</span>
                      <span>{month.nights.length}</span>
                    </h4>
                    {month.nights.map((night) => (
                      <button
                        aria-current={selected?.key === night.key}
                        className={`rlb-row${selected?.key === night.key ? " active" : ""}`}
                        key={night.key}
                        onClick={() => setSelectedKey(night.key)}
                        type="button"
                      >
                        <span className="rlb-date">
                          <b>{night.date ? night.date.getDate() : "—"}</b>
                          <i>
                            {night.date
                              ? night.date
                                  .toLocaleDateString("es-AR", {
                                    weekday: "short",
                                  })
                                  .replace(".", "")
                              : ""}
                          </i>
                        </span>
                        <span className="rlb-row-main">
                          <span className="rlb-row-title">{night.title}</span>
                          <FightStrip fights={night.fights} />
                        </span>
                        <span className="rlb-row-side">
                          <span
                            className={`rlb-dot ${night.state}`}
                            title={STATE_LABEL[night.state]}
                          />
                          <span>💀 {night.kills}</span>
                        </span>
                      </button>
                    ))}
                  </section>
                ))
              )}
            </nav>

            {selected ? (
              <section className="rlb-detail">
                <div className="rlb-detail-head">
                  <div>
                    <h3>{selected.title}</h3>
                    <span className="rlb-detail-date">
                      {selected.date
                        ? selected.date.toLocaleDateString("es-AR", {
                            day: "numeric",
                            month: "long",
                            weekday: "long",
                            year: "numeric",
                          })
                        : "Sin fecha"}
                    </span>
                  </div>
                  <div className="rlb-detail-badges">
                    {selected.live ? (
                      <span
                        className="raid-log-badge raid-log-live"
                        title="Todavía se están subiendo fights a Warcraft Logs"
                      >
                        ● En vivo
                      </span>
                    ) : null}
                    <span
                      className={`raid-log-badge ${STATE_BADGE[selected.state]}`}
                    >
                      {STATE_LABEL[selected.state]}
                    </span>
                  </div>
                </div>

                <div className="rlb-metrics">
                  <div className="rlb-metric">
                    <strong>{selected.fightCount}</strong>
                    <span>Pulls</span>
                  </div>
                  <div className="rlb-metric">
                    <strong className="kill">{selected.kills}</strong>
                    <span>Kills</span>
                  </div>
                  <div className="rlb-metric">
                    <strong>
                      {Math.max(selected.fightCount - selected.kills, 0)}
                    </strong>
                    <span>Wipes</span>
                  </div>
                  <div className="rlb-metric">
                    <strong>{bosses.length}</strong>
                    <span>Bosses</span>
                  </div>
                </div>

                {selected.error ? (
                  <div className="rlb-error">⚠️ {selected.error}</div>
                ) : null}

                {selected.fights.length > 0 ? (
                  <div className="rlb-block">
                    <span className="rlb-label">Pulls en orden</span>
                    <FightStrip fights={selected.fights} large />
                  </div>
                ) : null}

                {bosses.length > 0 ? (
                  <div className="rlb-block">
                    <span className="rlb-label">Por boss</span>
                    <div className="rlb-bosses">
                      {bosses.map((boss) => (
                        <div className="rlb-boss" key={boss.name}>
                          <span className="rlb-boss-name">{boss.name}</span>
                          <span className="rlb-boss-pulls">
                            {boss.pulls} {boss.pulls === 1 ? "pull" : "pulls"}
                          </span>
                          <span
                            className={`rlb-boss-result ${boss.kills > 0 ? "kill" : "wipe"}`}
                          >
                            {boss.kills > 0
                              ? "Kill"
                              : boss.best !== undefined
                                ? `Mejor ${percentLabel(boss.best)}`
                                : "Wipe"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rlb-block">
                  <span className="rlb-label">
                    {selected.parts.length === 1
                      ? "Report"
                      : `Reports (${selected.parts.length})`}
                  </span>
                  <div className="rlb-parts">
                    {selected.parts.map((part) => (
                      <a
                        className="rlb-part"
                        href={part.reportUrl}
                        key={part.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="rlb-part-code">{part.reportCode}</span>
                        <span className="muted-text">
                          ⚔️ {part.fightCount} · 💀 {part.kills}
                        </span>
                        <span className="raid-log-link">
                          Abrir en Warcraft Logs ↗
                        </span>
                      </a>
                    ))}
                  </div>
                </div>

                {onAnalyze ? (
                  <div className="rlb-analysis-control">
                    <button
                      aria-expanded={analysisOpenKey === selected.key}
                      className="ghost-button"
                      disabled={analysisLoadingKey === selected.key}
                      onClick={() => void toggleAnalysis(selected)}
                      type="button"
                    >
                      {analysisLoadingKey === selected.key
                        ? "Analizando…"
                        : analysisOpenKey === selected.key
                          ? "Ocultar análisis"
                          : "Ver análisis"}
                    </button>
                    {analysisOpenKey === selected.key ? (
                      <section aria-live="polite" className="rlb-analysis">
                        {analysisLoadingKey === selected.key ? (
                          <div className="rlb-analysis-loading">
                            Consultando Warcraft Logs…
                          </div>
                        ) : selectedAnalysisError ? (
                          <div className="rlb-error">
                            ⚠️ {selectedAnalysisError}
                          </div>
                        ) : selectedAnalysis ? (
                          <>
                            <div className="rlb-analysis-head">
                              <div>
                                <h4>Análisis de la raid</h4>
                                <span>
                                  Actualizado{" "}
                                  {new Date(
                                    selectedAnalysis.generatedAt,
                                  ).toLocaleTimeString("es-AR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <span>
                                {selectedAnalysis.encounters.length} bosses
                              </span>
                            </div>

                            <div className="rlb-analysis-spotlights">
                              <div
                                className="rlb-spotlight damage"
                                style={
                                  selectedDpsColor
                                    ? { borderLeftColor: selectedDpsColor }
                                    : undefined
                                }
                              >
                                <span>Mayor DPS promedio</span>
                                <strong>
                                  {selectedAnalysis.averageDps[0]?.name ?? "—"}
                                </strong>
                                <span>
                                  {selectedAnalysis.averageDps[0]
                                    ? `${compactNumber(selectedAnalysis.averageDps[0].averageDps)} DPS`
                                    : "Sin datos de daño"}
                                </span>
                              </div>
                              <div className="rlb-spotlight deaths">
                                <span>Más muertes</span>
                                <strong>
                                  {selectedAnalysis.deathsByPlayer[0]?.name ??
                                    "—"}
                                </strong>
                                <span>
                                  {selectedAnalysis.deathsByPlayer[0]
                                    ? `${selectedAnalysis.deathsByPlayer[0].deaths} muertes`
                                    : "Sin muertes registradas"}
                                </span>
                              </div>
                            </div>

                            <div className="rlb-analysis-grid">
                              <div className="rlb-analysis-section">
                                <h5>DPS promedio por encuentro</h5>
                                {selectedAnalysis.averageDps.length > 0 ? (
                                  selectedAnalysis.averageDps
                                    .slice(0, 8)
                                    .map((player, index) => {
                                      const color = classColor(player.class);
                                      const maxDps =
                                        selectedAnalysis.averageDps[0]
                                          ?.averageDps ?? 1;
                                      return (
                                        <div
                                          className="rlb-analysis-row"
                                          key={player.name}
                                        >
                                          <span className="rlb-rank">
                                            {index + 1}
                                          </span>
                                          <span className="rlb-analysis-player">
                                            <span className="rlb-analysis-player-name">
                                              {color ? (
                                                <i
                                                  aria-label={player.class}
                                                  className="rlb-class-dot"
                                                  style={{
                                                    backgroundColor: color,
                                                  }}
                                                />
                                              ) : null}
                                              {player.name}
                                            </span>
                                            <span className="rlb-bar-track">
                                              <span
                                                className="rlb-bar damage"
                                                style={{
                                                  ...(color
                                                    ? {
                                                        backgroundColor: color,
                                                      }
                                                    : {}),
                                                  width: `${Math.max(3, (player.averageDps / maxDps) * 100)}%`,
                                                }}
                                              />
                                            </span>
                                          </span>
                                          <strong>
                                            {compactNumber(player.averageDps)}
                                          </strong>
                                        </div>
                                      );
                                    })
                                ) : (
                                  <p className="rlb-analysis-empty">
                                    Warcraft Logs no devolvió datos de daño.
                                  </p>
                                )}
                              </div>

                              <div className="rlb-analysis-section">
                                <h5>Muertes</h5>
                                <div className="rlb-analysis-total">
                                  <strong>
                                    {selectedAnalysis.totalDeaths}
                                  </strong>
                                  <span>en toda la raid</span>
                                </div>
                                {selectedAnalysis.deathsByPlayer.length > 0 ? (
                                  <div className="rlb-analysis-list">
                                    {selectedAnalysis.deathsByPlayer
                                      .slice(0, 6)
                                      .map((player) => (
                                        <div
                                          className="rlb-analysis-list-row"
                                          key={player.name}
                                        >
                                          <span>{player.name}</span>
                                          <strong>{player.deaths}</strong>
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <p className="rlb-analysis-empty">
                                    No se registraron muertes.
                                  </p>
                                )}
                                {selectedAnalysis.deathsByAbility.length > 0 ? (
                                  <div className="rlb-death-causes">
                                    <span className="rlb-label">
                                      Causas principales
                                    </span>
                                    {selectedAnalysis.deathsByAbility
                                      .slice(0, 5)
                                      .map((cause) => (
                                        <span
                                          className="rlb-cause-chip"
                                          key={cause.ability}
                                        >
                                          {cause.ability} · {cause.deaths}
                                        </span>
                                      ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {selectedAnalysis.encounters.length > 0 ? (
                              <div className="rlb-analysis-section">
                                <h5>Por boss</h5>
                                <div className="rlb-encounters">
                                  {selectedAnalysis.encounters.map(
                                    (encounter) => (
                                      <div
                                        className="rlb-encounter"
                                        key={`${encounter.name}:${encounter.durationSeconds}`}
                                      >
                                        <span
                                          className={`rlb-encounter-result ${encounter.kill ? "kill" : "wipe"}`}
                                        >
                                          {encounter.kill ? "Kill" : "Wipe"}
                                        </span>
                                        <strong>{encounter.name}</strong>
                                        <span>{encounter.deaths} muertes</span>
                                        <span>
                                          {encounter.topDps
                                            ? `${encounter.topDps.name} · ${compactNumber(encounter.topDps.dps)} DPS`
                                            : "Sin datos de daño"}
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </section>
                    ) : null}
                  </div>
                ) : null}

                {onPublish || onUpdate || onHide ? (
                  <div className="rlb-detail-actions">
                    {selected.state === "draft" || selected.state === "failed"
                      ? onPublish && (
                          <button
                            className="primary-button"
                            disabled={busyKey === selected.key}
                            onClick={() => runAction(selected, onPublish)}
                            type="button"
                          >
                            {busyKey === selected.key
                              ? "Publicando…"
                              : "Publicar en Discord"}
                          </button>
                        )
                      : onUpdate && (
                          <button
                            className={
                              selected.state === "pending"
                                ? "primary-button"
                                : "ghost-button"
                            }
                            disabled={busyKey === selected.key}
                            onClick={() => runAction(selected, onUpdate)}
                            type="button"
                          >
                            {busyKey === selected.key
                              ? "Actualizando…"
                              : "Actualizar mensaje"}
                          </button>
                        )}
                    {onHide ? (
                      <button
                        className="ghost-button danger"
                        onClick={() => onHide(selected.parts)}
                        type="button"
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
