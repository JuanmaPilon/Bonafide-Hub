import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChartLine,
  Files,
  Flask,
  GearSix,
  Ghost,
  ListNumbers,
  MagnifyingGlass,
  ArrowsClockwise,
  Skull,
  Sword,
  Target,
  Users,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  classColor,
  type RaidConsumableKey,
  type RaidLog,
  type RaidLogAnalysis,
} from "./api";

type Fight = {
  // Id de encuentro: la identidad del boss. El nombre cambia con el idioma del
  // cliente que subió el log ("The Coiled Altar" vs "El Altar Serpenteante").
  boss?: number;
  difficulty?: number;
  kill: boolean;
  name: string;
  // Hora absoluta del pull (epoch ms): dos reports de la misma noche traen el
  // MISMO pull con unos segundos de diferencia.
  start?: number;
  // Zona (raid) del report del que sale el fight: la progresión se cuenta por
  // raid, así una legacy loggeada el mismo día no le suma bosses al tier.
  zone?: number | null;
  zoneName?: string;
};

// Identidad de un boss: el id de encuentro manda, el nombre es el respaldo de
// los logs viejos (guardados antes de que el summary trajera el id).
function fightKey(fight: Fight): string {
  return fight.boss === undefined
    ? `name:${fight.name.toLowerCase()}`
    : `boss:${fight.boss}`;
}

const PULL_TOLERANCE_MS = 15 * 1000;

// Saca los pulls repetidos: los mismos fights que traen dos reports de la misma
// noche (dos personas loggeando). Un pull se identifica por boss + hora absoluta,
// así que dos pulls distintos del mismo boss (un wipe y su kill) siguen contando
// los dos. Sin hora (log viejo sin refrescar) no se puede comparar: se conserva.
function uniqueFights(fights: Fight[]): Fight[] {
  const kept: Fight[] = [];
  const starts = new Map<string, number[]>();
  for (const fight of fights) {
    if (fight.start === undefined) {
      kept.push(fight);
      continue;
    }
    const key = fightKey(fight);
    const times = starts.get(key) ?? [];
    if (times.some((time) => Math.abs(time - fight.start!) <= PULL_TOLERANCE_MS)) {
      continue;
    }
    times.push(fight.start);
    starts.set(key, times);
    kept.push(fight);
  }
  return kept;
}
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

// Progresión de la guild, por dificultad: bosses distintos matados sobre bosses
// distintos enfrentados, sobre TODOS los logs. Un boss se cuenta por su id de
// encuentro: el NOMBRE cambia con el idioma del cliente que subió el log
// ("The Coiled Altar" vs "El Altar Serpenteante") y con el nombre el mismo jefe
// contaba dos veces (un boss de más y "10/10" en una raid de 9).
function progression(nights: Night[]): {
  difficulties: Array<{
    killed: number;
    label: string;
    short: string;
    total: number;
  }>;
} {
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
          const key = fightKey(fight);
          seen.add(key);
          if (fight.kill) {
            killed.add(key);
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
  return {
    difficulties: porDificultad.map((entry) => ({
      killed: entry.killed,
      label: entry.label,
      short: entry.short,
      total,
    })),
  };
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
};

// El título de una noche lo pone el report más completo: cuando dos personas
// loggean la misma raid, la que subió más bosses es la que mejor la nombra.
function primaryPartTitle(parts: RaidLog[]): string {
  const best = parts.reduce(
    (current, part) => (part.fightCount > current.fightCount ? part : current),
    parts[0],
  );
  return best?.title || "Log de raid";
}

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
    // Los pulls repetidos entre los reports de la noche se cuentan una sola vez.
    const fights = uniqueFights(
      parts.flatMap((part) =>
        (part.summary?.fights ?? []).map((fight) => ({
          boss: fight.boss,
          difficulty: fight.difficulty,
          kill: Boolean(fight.kill),
          name: fight.name ?? "Fight",
          start: fight.start,
          zone: part.zone ?? null,
          zoneName: part.zoneName,
        })),
      ),
    );

    return {
      date: date && !Number.isNaN(date.getTime()) ? date : null,
      error: parts.find((part) => part.error)?.error,
      fightCount: fights.length,
      fights,
      key,
      kills: fights.filter((fight) => fight.kill).length,
      live,
      parts,
      state: posted
        ? stale && !live
          ? "pending"
          : "posted"
        : failed
          ? "failed"
          : "draft",
      title: primaryPartTitle(parts),
    };
  });
}

// Clave de la semana (lunes): sirve para contar cuántas semanas distintas se
// raideó, sin depender de la numeración ISO.
function weekKey(date: Date): string {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
}

function monthOf(date: Date | null): { key: string; label: string } {  if (!date) {
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

// Alto máximo al que se corta una lista larga: techo para que una fila con dos
// listas enormes no se coma la pantalla. En la ventana del análisis hay lugar de
// sobra, así que ahí las listas pueden ser más altas.
const LIST_MAX_PX = 320;
const MODAL_LIST_MAX_PX = 440;

type RowClamp = {
  registrar: (el: HTMLDivElement | null) => void;
  tope: number;
};

const RowClampContext = createContext<RowClamp | null>(null);

// Fila del análisis: las listas de las DOS columnas se cortan a la misma altura,
// y esa altura es donde termina la más corta. Así las dos columnas cierran en la
// misma línea y el botón de la larga arranca justo ahí.
function AnalysisRow({
  children,
  max = LIST_MAX_PX,
}: {
  children: ReactNode;
  max?: number;
}) {
  const cuerpos = useRef<HTMLDivElement[]>([]);
  const [tope, setTope] = useState(max);

  const registrar = useCallback((el: HTMLDivElement | null): void => {
    if (el && !cuerpos.current.includes(el)) {
      cuerpos.current.push(el);
    }
  }, []);

  useEffect(() => {
    const medir = (): void => {
      // `scrollHeight` es el alto natural del contenido: no cambia al recortarlo,
      // así que abrir una lista no mueve el corte de la otra. Las secciones sin
      // contenido no cuentan: si no, dejarían la otra columna cortada a cero.
      const altos = cuerpos.current
        .filter((el) => Boolean(el))
        .map((el) => el.scrollHeight)
        .filter((alto) => alto > 8);
      if (altos.length > 0) {
        setTope(Math.min(max, ...altos));
      }
    };
    medir();
    const observador = new ResizeObserver(medir);
    for (const el of cuerpos.current) {
      observador.observe(el);
    }
    return () => observador.disconnect();
  }, [children, max]);

  return (
    <RowClampContext.Provider value={{ registrar, tope }}>
      {children}
    </RowClampContext.Provider>
  );
}

// Sección del análisis con lista: la caja mantiene el alto de la fila (el de la
// lista más corta de las dos columnas) y lo que sobra se scrollea adentro. Un
// degradado abajo avisa que hay más, y desaparece al llegar al final.
// `footer` va afuera del scroll, para lo que tiene que verse siempre (las causas
// de muerte, que son pocas).
function ClampedSection({
  children,
  footer,
  icon,
  max,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  max?: number;
  title: string;
}) {
  const fila = useContext(RowClampContext);
  const [hasMore, setHasMore] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);
  const tope = fila?.tope ?? max ?? LIST_MAX_PX;

  const medir = useCallback((): void => {
    const el = caja.current;
    if (!el) {
      return;
    }
    setHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);

  useEffect(() => {
    const el = caja.current;
    if (!el) {
      return undefined;
    }
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [children, medir, tope]);

  return (
    <div className="rlb-analysis-section">
      <h5>
        {icon}
        {title}
      </h5>
      <div className="rlb-list-wrap" style={{ maxHeight: tope }}>
        <div
          className="rlb-list-body"
          onScroll={medir}
          ref={(el) => {
            caja.current = el;
            fila?.registrar(el);
          }}
        >
          {children}
        </div>
        {hasMore ? <span aria-hidden="true" className="rlb-list-fade" /> : null}
      </div>
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
    // Agrupado por id de encuentro: el mismo boss puede venir con el nombre en
    // dos idiomas según quién subió cada log.
    const key = fightKey(fight);
    const boss = bosses.get(key) ?? { kills: 0, name: fight.name, pulls: 0 };
    boss.pulls += 1;
    if (fight.kill) {
      boss.kills += 1;
    }
    bosses.set(key, boss);
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
  onConfirmAlias,
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
  // Confirmar que un nombre del log es el PJ de un miembro (y corregirlo en el
  // evento de esa noche).
  onConfirmAlias?: (
    userId: string,
    name: string,
    eventId?: string,
  ) => Promise<void>;
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
  // El modal de configuración se abre solo cuando todavía no hay noches (es lo
  // primero que hay que configurar) y, si lo cierran, no vuelve a aparecer.
  const [manageDismissed, setManageDismissed] = useState(false);
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
  // Confirmación de un PJ parecido: qué fila se está guardando y qué falló.
  const [aliasBusy, setAliasBusy] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);
  // A qué miembro se va a linkear cada nombre que vino sin anotarse.
  const [linkPick, setLinkPick] = useState<Record<string, string>>({});

  const nights = useMemo(
    () =>
      toNights(logs).sort(
        (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
      ),
    [logs],
  );

  const progress = useMemo(() => progression(nights), [nights]);

  // Aprovecha el espacio de arriba: noches loggeadas y en cuántas semanas.
  const raidStats = useMemo(() => {
    const weeks = new Set<string>();
    for (const night of nights) {
      if (night.date) {
        weeks.add(weekKey(night.date));
      }
    }
    return { nights: nights.length, weeks: weeks.size };
  }, [nights]);

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
  const manageOpen =
    Boolean(manage) && (showManage || (nights.length === 0 && !manageDismissed));
  // Abrir/cerrar la configuración. Con la lista vacía el modal se abre solo (es
  // lo primero que hay que configurar), y cerrarlo tiene que quedarse cerrado.
  const toggleManage = (): void => {
    if (manageOpen) {
      setShowManage(false);
      setManageDismissed(true);
      return;
    }
    setShowManage(true);
    setManageDismissed(false);
  };
  const closeManage = (): void => {
    setShowManage(false);
    setManageDismissed(true);
  };
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
  const expectedConsumables = consumables?.categories ?? [];
  // El nombre del boss cambia con el idioma del log ("The Coiled Altar" vs
  // "El Altar Serpenteante"): manda el del report base y, si no aparece, el que
  // más veces figura en la noche, así el mismo boss no se muestra con dos
  // nombres distintos entre la tarjeta y el análisis.
  const baseReportPart = selectedAnalysis?.source
    ? selected.parts.find(
        (part) => part.reportCode === selectedAnalysis.source?.baseReport,
      )
    : undefined;
  const baseBossNames = new Map<number, string>();
  for (const fight of baseReportPart?.summary?.fights ?? []) {
    if (fight.boss !== undefined && fight.name) {
      if (!baseBossNames.has(fight.boss)) {
        baseBossNames.set(fight.boss, fight.name);
      }
    }
  }
  const bossLabels = new Map<number, string>();
  const bossLabelCounts = new Map<number, Map<string, number>>();
  for (const entry of [
    ...(selectedAnalysis?.encounters ?? []),
    ...(consumables?.pulls ?? []),
  ]) {
    if (entry.boss === undefined) {
      continue;
    }
    const counts = bossLabelCounts.get(entry.boss) ?? new Map<string, number>();
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
    bossLabelCounts.set(entry.boss, counts);
  }
  for (const [boss, counts] of bossLabelCounts) {
    const preferred = baseBossNames.get(boss);
    if (preferred !== undefined && counts.has(preferred)) {
      bossLabels.set(boss, preferred);
      continue;
    }
    const best = [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0];
    if (best) {
      bossLabels.set(boss, best[0]);
    }
  }
  const bossLabel = (boss: number | undefined, name: string): string =>
    boss === undefined ? name : (bossLabels.get(boss) ?? name);
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
  // Miembros que no aparecieron en el log: son los candidatos para linkear un
  // nombre que vino sin anotarse (queda guardado como PJ confirmado del miembro
  // y el cruce lo reconoce solo la próxima vez).
  const linkTargets = attendance
    ? [
        ...attendance.signedAbsent,
        ...attendance.unmatchedSignups.map((signup) => ({
          name: signup.name,
          status: signup.status,
          userId: signup.userId,
        })),
      ]
    : [];
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

  // Link del análisis que se publica en Discord (?log=<id>#/raids/logs): abre esa
  // noche y carga el análisis.
  const deepLink = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const logId = new URLSearchParams(window.location.search).get("log");
    return logId ? { logId } : undefined;
  }, []);
  const deepLinkOpenDone = useRef(false);

  // Escape cierra el modal que esté arriba (el análisis manda sobre la
  // configuración) y mientras hay uno abierto la página de atrás no scrollea.
  const modalOpen = Boolean(analysisOpenKey) || manageOpen;
  useEffect(() => {
    if (!modalOpen) {
      return undefined;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      if (analysisOpenKey) {
        setAnalysisOpenKey(null);
        return;
      }
      setShowManage(false);
      setManageDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [analysisOpenKey, modalOpen]);

  useEffect(() => {
    if (!deepLink || deepLinkOpenDone.current) {
      return;
    }
    const night = nights.find((entry) =>
      entry.parts.some((part) => part.id === deepLink.logId),
    );
    if (!night) {
      return;
    }
    deepLinkOpenDone.current = true;
    setSelectedKey(night.key);
    void toggleAnalysis(night);
    // El link ya cumplió: al recargar no vuelve a abrir el análisis solo.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.hash || "#/raids/logs"}`,
    );
  });

  // Confirmar un parecido: se guarda el PJ y se vuelve a armar el análisis (en
  // la API el cache de esa noche se invalida al confirmar), así el nombre deja
  // de figurar como posible y pasa a contar como asistencia.
  const confirmAlias = async (
    night: Night,
    userId: string,
    name: string,
  ): Promise<void> => {
    if (!onConfirmAlias) {
      return;
    }
    setAliasBusy(`${userId}:${name}`);
    setAliasError(null);
    try {
      // El evento de la noche va con el link: el API corrige también el PJ de
      // esa inscripción (no solo lo memoriza para el próximo cruce).
      await onConfirmAlias(
        userId,
        name,
        analysisByNight[night.key]?.attendance?.event?.id,
      );
      if (onAnalyze) {
        const analysis = await onAnalyze(night.parts[0]);
        setAnalysisByNight((current) => ({
          ...current,
          [night.key]: analysis,
        }));
      }
    } catch (error) {
      setAliasError(
        error instanceof Error
          ? error.message
          : "No se pudo confirmar el PJ.",
      );
    } finally {
      setAliasBusy(null);
    }
  };

  return (
    <div className="rlb">
      <div className="rlb-top">
        <div className="rlb-stats">
          <div className="rlb-stat">
            <strong>{raidStats.nights}</strong>
            <span>Noches</span>
          </div>
          <div className="rlb-stat">
            <strong>{raidStats.weeks}</strong>
            <span>Semanas</span>
          </div>
          <div className="rlb-stat">
            {/* Progresión de la guild: un chip por dificultad jugada. */}
            <strong className="rlb-progress">
              {progress.difficulties.length > 0
                ? progress.difficulties.map((entry) => (
                    <span
                      className={`rlb-progress-chip${entry.killed >= entry.total ? " full" : ""}`}
                      key={entry.short}
                      title={`${entry.label}: ${entry.killed} de ${entry.total} bosses`}
                    >
                      <i>{entry.label}</i>
                      {entry.killed}/{entry.total}
                    </span>
                  ))
                : "—"}
            </strong>
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
                <ArrowsClockwise weight="fill" aria-hidden="true" className="icon-button-icon" />
              </button>
            ) : null}
            {manage ? (
              <button
                aria-expanded={manageOpen}
                aria-label="Configuración"
                className={`icon-button${manageOpen ? " active" : ""}`}
                onClick={toggleManage}
                title="Configuración"
                type="button"
              >
                <GearSix weight="fill" aria-hidden="true" className="icon-button-icon" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {manageOpen && manage
        ? createPortal(
            <div
              className="modal-overlay"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeManage();
                }
              }}
              role="presentation"
            >
              <div
                aria-label="Configuración de los logs de raid"
                aria-modal="true"
                className="modal rlb-settings-modal"
                role="dialog"
              >
                <header className="rlb-modal-head">
                  <h4>
                    <GearSix weight="fill" aria-hidden="true" />
                    Configuración
                  </h4>
                  <button
                    aria-label="Cerrar"
                    className="icon-button"
                    onClick={closeManage}
                    title="Cerrar"
                    type="button"
                  >
                    <X weight="bold" aria-hidden="true" className="icon-button-icon" />
                  </button>
                </header>
                <div className="rlb-settings-body">{manage}</div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {nights.length === 0 ? (
        <div className="empty-state">Todavía no hay logs de raid.</div>
      ) : (
        <>
          <div className="rlb-toolbar">
            <div className="rlb-search-box">
              <MagnifyingGlass weight="fill" aria-hidden="true" className="rlb-search-icon" />
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
                          <span className="rlb-night-kills">
                            <Sword weight="fill" aria-hidden="true" />
                            {night.kills}
                          </span>
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
                  <div className="rlb-detail-tools">
                    <div className="rlb-detail-badges">
                      {selected.live ? (
                        <span
                          className="raid-log-badge raid-log-live"
                          title="Todavía se están subiendo fights a Warcraft Logs"
                        >
                          ● En vivo
                        </span>
                      ) : null}
                      {selected.state === "pending" ? (
                        <span
                          className="raid-log-badge raid-log-stale"
                          title="El report creció después de publicar el mensaje en Discord"
                        >
                          Mensaje desactualizado
                        </span>
                      ) : null}
                    </div>
                    <div className="rlb-detail-actions">
                      {onAnalyze ? (
                        <button
                          aria-expanded={analysisOpenKey === selected.key}
                          className="ghost-button"
                          disabled={analysisLoadingKey === selected.key}
                          onClick={() => void toggleAnalysis(selected)}
                          type="button"
                        >
                          <ChartLine weight="fill" aria-hidden="true" />
                          {analysisLoadingKey === selected.key
                            ? "Analizando…"
                            : "Ver análisis"}
                        </button>
                      ) : null}
                      {selected.state === "draft" ||
                      selected.state === "failed"
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
                              title="Vuelve a leer el report en Warcraft Logs y edita el mensaje publicado si cambió"
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
                  </div>
                </div>

                <div className="rlb-metrics">
                  <div className="rlb-metric">
                    <strong>{selected.fightCount}</strong>
                    <span className="rlb-metric-label">
                      <Target weight="fill" aria-hidden="true" />
                      Pulls
                    </span>
                  </div>
                  <div className="rlb-metric">
                    <strong className="kill">{selected.kills}</strong>
                    <span className="rlb-metric-label">
                      <Sword weight="fill" aria-hidden="true" />
                      Kills
                    </span>
                  </div>
                  <div className="rlb-metric">
                    <strong>
                      {Math.max(selected.fightCount - selected.kills, 0)}
                    </strong>
                    <span className="rlb-metric-label">
                      <Skull weight="fill" aria-hidden="true" />
                      Wipes
                    </span>
                  </div>
                  <div className="rlb-metric">
                    <strong>{bosses.length}</strong>
                    <span className="rlb-metric-label">
                      <Ghost weight="fill" aria-hidden="true" />
                      Bosses
                    </span>
                  </div>
                </div>

                {selected.error ? (
                  <div className="rlb-error">
                    <Warning weight="fill" aria-hidden="true" />
                    {selected.error}
                  </div>
                ) : null}

                {selected.fights.length > 0 ? (
                  <div className="rlb-block">
                    <span className="rlb-label">
                      <ListNumbers weight="fill" aria-hidden="true" />
                      Pulls en orden
                    </span>
                    <FightStrip fights={selected.fights} large />
                  </div>
                ) : null}

                {bosses.length > 0 ? (
                  <div className="rlb-block">
                    <span className="rlb-label">
                      <Ghost weight="fill" aria-hidden="true" />
                      Por boss
                    </span>
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
                    <Files weight="fill" aria-hidden="true" />
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
                        <span className="rlb-part-counts">
                          <Target weight="fill" aria-hidden="true" />
                          {part.fightCount}
                          <Sword weight="fill" aria-hidden="true" />
                          {part.kills}
                        </span>
                        <span className="raid-log-link">
                          Abrir en Warcraft Logs ↗
                        </span>
                      </a>
                    ))}
                  </div>
                </div>

                {onAnalyze ? (
                  <>
                    {analysisOpenKey === selected.key
                      ? createPortal(
                          <div
                            className="modal-overlay"
                            onClick={(event) => {
                              if (event.target === event.currentTarget) {
                                setAnalysisOpenKey(null);
                              }
                            }}
                            role="presentation"
                          >
                        <div
                          aria-label={`Análisis de la raid · ${selected.title}`}
                          aria-modal="true"
                          className="modal rlb-analysis-modal"
                          role="dialog"
                        >
                          <header className="rlb-analysis-modal-head">
                            <h4>
                              <ChartLine weight="fill" aria-hidden="true" />
                              Análisis de la raid
                            </h4>
                            <span>
                              {selected.title}
                              {selected.date && !/\d{1,2}[/-]\d{1,2}/.test(selected.title)
                                ? ` · ${selected.date.toLocaleDateString("es-AR")}`
                                : ""}
                            </span>
                            <button
                              aria-label="Cerrar"
                              className="icon-button"
                              onClick={() => setAnalysisOpenKey(null)}
                              title="Cerrar"
                              type="button"
                            >
                              <X
                                weight="bold"
                                aria-hidden="true"
                                className="icon-button-icon"
                              />
                            </button>
                          </header>
                          <section aria-live="polite" className="rlb-analysis">
                            {analysisLoadingKey === selected.key ? (
                              <div className="rlb-analysis-loading">
                                Consultando Warcraft Logs…
                              </div>
                            ) : selectedAnalysisError ? (
                              <div className="rlb-error">
                                <Warning weight="fill" aria-hidden="true" />
                                {selectedAnalysisError}
                              </div>
                            ) : selectedAnalysis ? (
                              <>
                                <div className="rlb-analysis-head">
                                  <div>
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
                              <span className="rlb-analysis-head-side">
                                <span>
                                  {selectedAnalysis.encounters.length} pulls
                                </span>
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
                              <AnalysisRow max={MODAL_LIST_MAX_PX}>
                              <ClampedSection
                                icon={<Sword weight="fill" aria-hidden="true" />}
                                title="DPS promedio por encuentro"
                              >
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
                                icon={<Skull weight="fill" aria-hidden="true" />}
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
                              </AnalysisRow>
                            </div>

                            {consumables || selectedAnalysis.encounters.length > 0 ? (
                              <div className="rlb-analysis-grid">
                                <AnalysisRow max={MODAL_LIST_MAX_PX}>
                                  {consumables ? (
                                    <ClampedSection
                                      icon={<Flask weight="fill" aria-hidden="true" />}
                                      title="Consumibles"
                                    >
                                      <div className="rlb-consumable-pulls">
                                        {expectedConsumables.map((category) => {
                                          const missing = consumables.players
                                            .map((player) => {
                                              // En qué pull/s faltó: el índice de la
                                              // lista es el número de pull.
                                              const pulls = consumables.pulls
                                                .map((pull, index) => ({ index, pull }))
                                                .filter(({ pull }) =>
                                                  (
                                                    pull.missing[category] ?? []
                                                  ).includes(player.name),
                                                )
                                                .map(({ index }) => index + 1);
                                              return {
                                                absent:
                                                  player.pulls -
                                                  (player.counts[category] ?? 0),
                                                name: player.name,
                                                pulls,
                                                totalPulls: player.pulls,
                                              };
                                            })
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
                                                  title={`Faltó en ${entry.absent} de ${entry.totalPulls} pulls${entry.pulls.length > 0 ? `: pull ${entry.pulls.join(", ")}` : ""}`}
                                                >
                                                  {entry.name}{" "}
                                                  <b>
                                                    {entry.absent}/
                                                    {entry.totalPulls}
                                                  </b>
                                                  {entry.pulls.length > 0 &&
                                                  entry.pulls.length <= 4 ? (
                                                    <i className="rlb-chip-pulls">
                                                      {entry.pulls.length === 1
                                                        ? `pull ${entry.pulls[0]}`
                                                        : `pulls ${entry.pulls.join("/")}`}
                                                    </i>
                                                  ) : null}
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
                                  ) : null}
                                  {selectedAnalysis.encounters.length > 0 ? (
                                    <ClampedSection
                                      icon={
                                        <Ghost weight="fill" aria-hidden="true" />
                                      }
                                      title="Resumen por boss"
                                    >
                                      {selectedAnalysis.encounters.map(
                                        (encounter, index) => (
                                          <div
                                            className="rlb-encounter"
                                            key={`${index}:${encounter.boss ?? encounter.name}`}
                                          >
                                            <span
                                              className={`rlb-encounter-result ${encounter.kill ? "kill" : "wipe"}`}
                                            >
                                              {encounter.kill ? "Kill" : "Wipe"}
                                            </span>
                                            <strong>
                                              {bossLabel(
                                                encounter.boss,
                                                encounter.name,
                                              )}
                                            </strong>
                                            <span>{encounter.deaths} muertes</span>
                                            <span>
                                              {encounter.topDps
                                                ? `Top DPS: ${encounter.topDps.name} · ${compactNumber(encounter.topDps.dps)} DPS`
                                                : "Top DPS: sin datos"}
                                            </span>
                                          </div>
                                        ),
                                      )}
                                    </ClampedSection>
                                ) : null}
                                </AnalysisRow>
                              </div>
                            ) : null}

                            {attendance ? (
                              <div className="rlb-analysis-section">
                                <h5>
                                  <Users weight="fill" aria-hidden="true" />
                                  Asistencia
                                </h5>
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
                                    <div className="rlb-attendance-event">
                                      <span>Evento del cruce</span>
                                      <strong className="rlb-attendance-event-date">
                                        {new Date(
                                          attendance.event.startsAt,
                                        ).toLocaleDateString("es-AR", {
                                          day: "2-digit",
                                          month: "2-digit",
                                          weekday: "long",
                                          year: "numeric",
                                        })}
                                      </strong>
                                      {/* El título lo escribe quien crea el
                                          evento ("Raid MIERCOLES - JUEVES
                                          08/10/2026") y puede nombrar días que
                                          no son los de esta noche: va completo
                                          abajo, chico, para poder verlo entero
                                          sin que compita con la fecha. */}
                                      <span className="rlb-attendance-event-title">
                                        {attendance.event.title}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                {attendance.partial ? (
                                  <span className="rlb-label">
                                    Presencia parcial: se contó solo a quien
                                    hizo daño, así que puede faltar algún heal.
                                  </span>
                                ) : null}
                                {/* Nombres que se parecen al de la inscripción:
                                    no se cuentan hasta que el staff confirma. */}
                                <div className="rlb-attendance-lists">
                                {attendance.likelyPresent.length > 0 ? (
                                  <div className="rlb-analysis-list">
                                    <span className="rlb-label">
                                      Parecidos sin confirmar
                                    </span>
                                    {attendance.likelyPresent.map((item) => (
                                      <div
                                        className="rlb-analysis-list-row"
                                        key={`${item.userId}:${item.logName}`}
                                      >
                                        <span>
                                          {item.name} ≈ {item.logName}
                                        </span>
                                        <span className="rlb-likely-side">
                                          <span className="rlb-label">
                                            {Math.round(item.similarity * 100)}%
                                          </span>
                                          {onConfirmAlias ? (
                                            <button
                                              className="ghost-button rlb-likely-confirm"
                                              disabled={aliasBusy !== null}
                                              onClick={() =>
                                                void confirmAlias(
                                                  selected,
                                                  item.userId,
                                                  item.logName,
                                                )
                                              }
                                              type="button"
                                            >
                                              {aliasBusy ===
                                              `${item.userId}:${item.logName}`
                                                ? "Guardando…"
                                                : "Confirmar"}
                                            </button>
                                          ) : null}
                                        </span>
                                      </div>
                                    ))}
                                    {aliasError ? (
                                      <div className="rlb-error">
                                        <Warning weight="fill" aria-hidden="true" />
                                        {aliasError}
                                      </div>
                                    ) : null}
                                  </div>
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
                                        <span>
                                          {player.name}{" "}
                                          <b>{player.pulls} pulls</b>
                                        </span>
                                        <span className="rlb-likely-side">
                                          {linkTargets.length > 0 &&
                                          onConfirmAlias ? (
                                            <>
                                              <select
                                                aria-label={`Linkear ${player.name}`}
                                                className="rlb-link-select"
                                                disabled={aliasBusy !== null}
                                                onChange={(event) =>
                                                  setLinkPick((current) => ({
                                                    ...current,
                                                    [player.name]:
                                                      event.target.value,
                                                  }))
                                                }
                                                value={
                                                  linkPick[player.name] ?? ""
                                                }
                                              >
                                                <option value="">
                                                  Linkear con…
                                                </option>
                                                {linkTargets.map((target) => (
                                                  <option
                                                    key={target.userId}
                                                    value={target.userId}
                                                  >
                                                    {target.name} ·{" "}
                                                    {SIGNUP_STATUS_LABEL[
                                                      target.status
                                                    ] ?? target.status}
                                                  </option>
                                                ))}
                                              </select>
                                              {linkPick[player.name] ? (
                                                <button
                                                  className="ghost-button rlb-likely-confirm"
                                                  disabled={aliasBusy !== null}
                                                  onClick={() =>
                                                    void confirmAlias(
                                                      selected,
                                                      linkPick[player.name],
                                                      player.name,
                                                    )
                                                  }
                                                  type="button"
                                                >
                                                  {aliasBusy ===
                                                  `${linkPick[player.name]}:${player.name}`
                                                    ? "Guardando…"
                                                    : "Linkear"}
                                                </button>
                                              ) : null}
                                            </>
                                          ) : player.status ? (
                                            <strong>
                                              {SIGNUP_STATUS_LABEL[
                                                player.status
                                              ] ?? player.status}
                                            </strong>
                                          ) : null}
                                        </span>
                                      </div>
                                    ))}
                                    {aliasError ? (
                                      <div className="rlb-error">
                                        <Warning
                                          weight="fill"
                                          aria-hidden="true"
                                        />
                                        {aliasError}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                </div>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                           </section>
                         </div>
                       </div>,
                           document.body,
                         )
                       : null}
                  </>
                ) : null}
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
