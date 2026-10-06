import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  classColor,
  type RaidConsumableKey,
  type RaidLog,
  type RaidLogAnalysis,
} from "./api";

type Fight = { difficulty?: number; kill: boolean; name: string };
type NightState = "draft" | "failed" | "pending" | "posted";

// Dificultades de Warcraft Logs (los ids viejos y nuevos apuntan al mismo
// nivel). El orden es el que se muestra: de la más baja a la más alta.
const DIFFICULTIES: Array<{
  ids: number[];
  label: string;
  short: string;
}> = [
  { ids: [3, 14], label: "Normal", short: "N" },
  { ids: [4, 15], label: "Heroico", short: "H" },
  { ids: [5, 16], label: "Mítico", short: "M" },
];

// Progresión de la guild por dificultad: bosses distintos matados sobre bosses
// distintos que enfrentó. El total sale del mayor número de bosses vistos en una
// dificultad, porque Warcraft Logs no dice cuántos tiene la banda y las que
// todavía no se intentaron no pueden contar como "vistas".
function progression(
  nights: Night[],
): Array<{ killed: number; label: string; short: string; total: number }> {
  const porDificultad = DIFFICULTIES
    .map((difficulty) => {
      const seen = new Set<string>();
      const killed = new Set<string>();
      for (const night of nights) {
        for (const fight of night.fights) {
          if (fight.difficulty === undefined) {
            continue;
          }
          if (!difficulty.ids.includes(fight.difficulty)) {
            continue;
          }
          seen.add(fight.name);
          if (fight.kill) {
            killed.add(fight.name);
          }
        }
      }
      return {
        killed: killed.size,
        label: difficulty.label,
        seen: seen.size,
        short: difficulty.short,
      };
    })
    .filter((entry) => entry.seen > 0);
  const total = Math.max(0, ...porDificultad.map((entry) => entry.seen));
  return porDificultad.map((entry) => ({
    killed: entry.killed,
    label: entry.label,
    short: entry.short,
    total,
  }));
}

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

const SIGNUP_STATUS_LABEL: Record<string, string> = {
  bench: "Bench",
  late: "Tarde",
  no: "No va",
  tentative: "Tentativo",
  yes: "Voy",
};

// Solo etiquetas: el orden de las categorías lo define el API.
const CONSUMABLE_LABEL: Record<RaidConsumableKey, string> = {
  flask: "Flask",
  food: "Comida",
  healthPotions: "Vida",
  healthstones: "Piedra",
  potions: "Pota",
  prepot: "Prepot",
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
          difficulty: fight.difficulty,
          kill: Boolean(fight.kill),
          name: fight.name ?? "Fight",
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

function compactNumber(value: number): string {
  return Math.round(value).toLocaleString("es-AR");
}

// Tuerca de "Configuración" y lupa de "Escanear": mismos trazos que los iconos
// del resto del panel (24x24, `currentColor`).
function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-button-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.08A1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.08a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-button-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 3h6M3 3v6M21 3h-6M21 3v6M3 21h6M3 21v-6M21 21h-6M21 21v-6" />
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 1 0 12 8.5" />
    </svg>
  );
}

// Alto al que se corta una lista larga del análisis: es el que ocupa la gráfica
// de DPS, así el par de secciones de al lado termina a la misma altura.
const LIST_MAX_PX = 320;

// Sección del análisis con lista larga: se corta y se abre con el botón. El
// botón aparece solo si el contenido no entra (medido, no adivinado): con pocos
// nombres sería ruido. `footer` va afuera del corte, para lo que tiene que verse
// siempre (las causas de muerte, que son pocas).
function ClampedSection({
  children,
  footer,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [recortable, setRecortable] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = caja.current;
    if (!el) {
      return undefined;
    }
    const medir = (): void => {
      // Abierta entra siempre: si no, el botón de cerrar desaparecería.
      if (!open) {
        setRecortable(el.scrollHeight > el.clientHeight + 1);
      }
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [children, open]);

  return (
    <div className="rlb-analysis-section">
      <h5>{title}</h5>
      <div
        className={`rlb-list-body${open ? " open" : ""}`}
        ref={caja}
        style={{ maxHeight: open ? undefined : LIST_MAX_PX }}
      >
        {children}
      </div>
      {open || recortable ? (
        <button
          className="ghost-button small rlb-list-toggle"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? "Ver menos" : "Ver todo"}
        </button>
      ) : null}
      {footer}
    </div>
  );
}

function bossBreakdown(fights: Fight[]): Array<{
  kills: number;
  name: string;
  pulls: number;
}> {
  const bosses = new Map<
    string,
    { kills: number; name: string; pulls: number }
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

  const progress = useMemo(() => progression(nights), [nights]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return nights.filter((night) => {
      if (!needle) {
        return true;
      }
      const when = night.date?.toLocaleDateString("es-AR") ?? "";
      return `${night.title} ${when}`.toLowerCase().includes(needle);
    });
  }, [nights, search]);

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
  // Con los roles de WCL, healers y tanks quedan afuera de la tabla de DPS: su
  // daño no compite con el de un DPS. Si WCL no devolvió roles, se muestran todos.
  const dpsRows = (() => {
    const rows = selectedAnalysis?.averageDps ?? [];
    const onlyDps = rows.filter((player) => player.role === "dps");
    return onlyDps.length > 0 ? onlyDps : rows;
  })();
  const lowestDpsPlayer = dpsRows[dpsRows.length - 1];
  const fewestDeaths = selectedAnalysis?.deathsByPlayer.reduce<{
    deaths: number;
    name: string;
  } | null>(
    (lowest, player) =>
      !lowest || player.deaths < lowest.deaths ? player : lowest,
    null,
  );
  const leastDeathsCount = selectedAnalysis?.deathsByPlayer.reduce(
    (minimum, player) => Math.min(minimum, player.deaths),
    Number.POSITIVE_INFINITY,
  );
  const leastDeathTies = selectedAnalysis?.deathsByPlayer.filter(
    (player) => player.deaths === leastDeathsCount,
  ).length;
  const knownDeathCauses = selectedAnalysis?.deathsByAbility.filter(
    (cause) => !/^unknown(?: ability)?$/i.test(cause.ability),
  );
  const attendance = selectedAnalysis?.attendance;
  const consumables = selectedAnalysis?.consumables;
  const attendanceNoShows = attendance
    ? [
        ...attendance.signedAbsent,
        ...attendance.unmatchedSignups.map((signup) => ({
          name: signup.name,
          status: `${SIGNUP_STATUS_LABEL[signup.status] ?? signup.status} · sin PJ`,
        })),
      ]
    : [];
  const attendanceUnsigned = attendance?.unsignedPresent ?? [];
  const selectedDpsColor = classColor(dpsRows[0]?.class);
  const lowestDpsColor = classColor(lowestDpsPlayer?.class);
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

  return (
    <div className="rlb">
      <div className="rlb-top">
        <div className="rlb-stats">
          <div className="rlb-stat">
            <strong>{nights.length}</strong>
            <span>Noches</span>
          </div>
          <div className="rlb-stat">
            {/* Progresión de la guild: un chip por dificultad jugada. */}
            <strong className="rlb-progress">
              {progress.length > 0
                ? progress.map((entry) => (
                    <span
                      className={`rlb-progress-chip${entry.killed >= entry.total ? " full" : ""}`}
                      key={entry.short}
                      title={`${entry.label}: ${entry.killed} de ${entry.total} bosses`}
                    >
                      {entry.killed}/{entry.total}
                      <i>{entry.short}</i>
                    </span>
                  ))
                : "—"}
            </strong>
            <span>Progresión</span>
          </div>
        </div>
        {onScan || manage ? (
          <div className="rlb-actions">
            {onScan ? (
              <button
                aria-label={scanning ? "Escaneando" : "Escanear ahora"}
                className="icon-button icon-button--primary"
                disabled={scanDisabled || scanning}
                onClick={onScan}
                title={scanning ? "Escaneando…" : "Escanear ahora"}
                type="button"
              >
                <ScanIcon />
              </button>
            ) : null}
            {manage ? (
              <button
                aria-expanded={manageOpen}
                aria-label="Configuración"
                className={`icon-button${manageOpen ? " active" : ""}`}
                onClick={() => setShowManage((current) => !current)}
                title="Configuración"
                type="button"
              >
                <GearIcon />
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
                            {boss.kills > 0 ? "Kill" : "Wipe"}
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
                                {selectedAnalysis.encounters.length} pulls
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
                                  {dpsRows[0]?.name ?? "—"}
                                </strong>
                                <span>
                                  {dpsRows[0]
                                    ? `${compactNumber(dpsRows[0].averageDps)} DPS`
                                    : "Sin datos de daño"}
                                </span>
                              </div>
                              <div
                                className="rlb-spotlight damage-low"
                                style={
                                  lowestDpsColor
                                    ? { borderLeftColor: lowestDpsColor }
                                    : undefined
                                }
                              >
                                <span>Menor DPS promedio</span>
                                <strong>{lowestDpsPlayer?.name ?? "—"}</strong>
                                <span>
                                  {lowestDpsPlayer
                                    ? `${compactNumber(lowestDpsPlayer.averageDps)} DPS`
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
                              <div className="rlb-spotlight deaths-low">
                                <span>Menos muertes</span>
                                <strong>{fewestDeaths?.name ?? "—"}</strong>
                                <span>
                                  {fewestDeaths
                                    ? `${fewestDeaths.deaths} muertes${(leastDeathTies ?? 0) > 1 ? ` · ${leastDeathTies} empatados` : ""}`
                                    : "Sin jugadores registrados"}
                                </span>
                              </div>
                            </div>

                            <div className="rlb-analysis-grid">
                              <ClampedSection title="DPS promedio por encuentro">
                                {dpsRows.length > 0 ? (
                                  <div className="rlb-analysis-dps">
                                    {dpsRows.map((player, index) => {
                                      const color = classColor(player.class);
                                      const maxDps = dpsRows[0]?.averageDps ?? 1;
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
                                    })}
                                  </div>
                                ) : (
                                  <p className="rlb-analysis-empty">
                                    Warcraft Logs no devolvió datos de daño.
                                  </p>
                                )}
                              </ClampedSection>

                              <ClampedSection
                                footer={
                                  knownDeathCauses &&
                                  knownDeathCauses.length > 0 ? (
                                    <div className="rlb-death-causes">
                                      <span className="rlb-label">
                                        Causas principales
                                      </span>
                                      {knownDeathCauses
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
                                  ) : null
                                }
                                title="Muertes"
                              >
                                {selectedAnalysis.deathsByPlayer.length > 0 ? (
                                  <div className="rlb-analysis-list">
                                    {selectedAnalysis.deathsByPlayer.map(
                                      (player) => (
                                        <div
                                          className="rlb-analysis-list-row"
                                          key={player.name}
                                        >
                                          <span>{player.name}</span>
                                          <strong>{player.deaths}</strong>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                ) : (
                                  <p className="rlb-analysis-empty">
                                    No se registraron muertes.
                                  </p>
                                )}
                              </ClampedSection>
                            </div>

                            {consumables ? (
                              <div className="rlb-analysis-grid">
                                {/* Al revés que antes: en vez del conteo de cada
                                    uno, la lista de quién faltó. Es lo que se
                                    puede accionar (hablar con esa persona). */}
                                <ClampedSection title="Sin consumibles">
                                  <div className="rlb-consumable-pulls">
                                    {consumables.categories.map((category) => {
                                      const missing = consumables.players
                                        .map((player) => ({
                                          absent:
                                            player.pulls -
                                            (player.counts[category] ?? 0),
                                          name: player.name,
                                          pulls: player.pulls,
                                        }))
                                        .filter((entry) => entry.absent > 0)
                                        .sort(
                                          (left, right) =>
                                            right.absent - left.absent ||
                                            left.name.localeCompare(right.name),
                                        );
                                      return (
                                        <p key={category}>
                                          <span className="rlb-label">
                                            Sin{" "}
                                            {CONSUMABLE_LABEL[
                                              category
                                            ].toLowerCase()}{" "}
                                            ({missing.length})
                                          </span>
                                          {missing.map((entry) => (
                                            <span
                                              className="rlb-missing-name"
                                              key={entry.name}
                                              title={`Faltó en ${entry.absent} de ${entry.pulls} pulls`}
                                            >
                                              {entry.name}{" "}
                                              <b>
                                                {entry.absent}/{entry.pulls}
                                              </b>
                                            </span>
                                          ))}
                                          {missing.length === 0
                                            ? "Todos usaron."
                                            : null}
                                        </p>
                                      );
                                    })}
                                  </div>
                                </ClampedSection>

                                <ClampedSection title="Por pull">
                                  <div className="rlb-consumable-pulls">
                                    {consumables.pulls.map(
                                      (pull, index) => (
                                        <details
                                          className="rlb-consumable-pull"
                                          key={`${pull.name}:${index}`}
                                        >
                                          <summary>
                                            <span className="rlb-consumable-pull-head">
                                              <strong>{pull.name}</strong>
                                              <span>
                                                {pull.participants} jugadores
                                              </span>
                                            </span>
                                          </summary>
                                          {consumables.categories.map(
                                            (category) => {
                                              const names =
                                                pull.missing[category] ?? [];
                                              return (
                                                <p key={category}>
                                                  <span className="rlb-label">
                                                    Sin{" "}
                                                    {CONSUMABLE_LABEL[
                                                      category
                                                    ].toLowerCase()}{" "}
                                                    ({names.length})
                                                  </span>
                                                  {names.length > 0
                                                    ? names.join(", ")
                                                    : "Todos usaron."}
                                                </p>
                                              );
                                            },
                                          )}
                                        </details>
                                      ),
                                    )}
                                  </div>
                                </ClampedSection>
                              </div>
                            ) : null}

                            {attendance ? (
                              <div className="rlb-analysis-section">
                                <h5>Asistencia</h5>
                                <div className="rlb-attendance-stats">
                                  <div>
                                    <span>Anotados que vinieron</span>
                                    <strong>
                                      {attendance.signedPresent}/
                                      {attendance.signedTotal}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Jugadores en el log</span>
                                    <strong>{attendance.players.length}</strong>
                                  </div>
                                  {attendance.event ? (
                                    <div>
                                      <span>Evento</span>
                                      <strong>
                                        {attendance.event.title} ·{" "}
                                        {new Date(
                                          attendance.event.startsAt,
                                        ).toLocaleDateString("es-AR")}
                                      </strong>
                                    </div>
                                  ) : null}
                                </div>
                                {attendance.partial ? (
                                  <span className="rlb-label">
                                    Presencia parcial: se contó solo a quien
                                    hizo daño, así que puede faltar algún heal.
                                  </span>
                                ) : null}
                                {attendanceNoShows.length > 0 ? (
                                  <div className="rlb-analysis-list">
                                    <span className="rlb-label">
                                      Anotados que no aparecieron
                                    </span>
                                    {attendanceNoShows.map((signup) => (
                                      <div
                                        className="rlb-analysis-list-row"
                                        key={`${signup.name}:${signup.status}`}
                                      >
                                        <span>{signup.name}</span>
                                        <strong>
                                          {SIGNUP_STATUS_LABEL[signup.status] ??
                                            signup.status}
                                        </strong>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {attendanceUnsigned.length > 0 ? (
                                  <div className="rlb-analysis-list">
                                    <span className="rlb-label">
                                      Vinieron sin anotarse
                                    </span>
                                    {attendanceUnsigned.map((player) => (
                                      <div
                                        className="rlb-analysis-list-row"
                                        key={player.name}
                                      >
                                        <span>{player.name}</span>
                                        <strong>
                                          {player.status
                                            ? (SIGNUP_STATUS_LABEL[
                                                player.status
                                              ] ?? player.status)
                                            : `${player.pulls} pulls`}
                                        </strong>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

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
                                            ? `Top DPS: ${encounter.topDps.name} · ${compactNumber(encounter.topDps.dps)} DPS`
                                            : "Top DPS: sin datos"}
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
