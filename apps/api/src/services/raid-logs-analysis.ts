import {
  fetchWarcraftLogsV1Json,
  listRaidLogs,
} from "./raid-logs-store.js";
import {
  crossRaidAttendance,
  type RaidLogAttendance,
} from "./raid-logs-attendance.js";

export type RaidRole = "dps" | "healer" | "tank";

// Consumibles que el log deja medir de forma confiable: flask y comida salen de
// las auras activas al empezar el pull (CombatantInfo), con el id de la habilidad
// como respaldo. Las pociones y las piedras se identifican por NOMBRE en la tabla
// de casts, y con logs de clientes que no reconocemos eso no se puede medir.
export type RaidConsumableKey = "flask" | "food";

export type RaidLogConsumables = {
  // Solo las categorías que se pudieron medir en esta noche: si WCL no expone
  // las auras o no se pueden resolver sus nombres, esa categoría no aparece y la
  // web no inventa faltantes. Son además las que se esperan en cada pull, así que
  // "faltó" es un dato útil y la web muestra faltantes.
  categories: RaidConsumableKey[];
  // Consumo agregado por jugador: en cuántos pulls participó y en cuántos tenía
  // cada consumible (un pull cuenta una vez, aunque lo tenga de antes).
  players: Array<{
    class?: string;
    counts: Partial<Record<RaidConsumableKey, number>>;
    name: string;
    pulls: number;
    role?: RaidRole;
  }>;
  pulls: Array<{
    boss?: number;
    missing: Partial<Record<RaidConsumableKey, string[]>>;
    name: string;
    participants: number;
  }>;
};

export type RaidLogAnalysis = {
  attendance?: RaidLogAttendance;
  averageDps: Array<{
    averageDps: number;
    class?: string;
    encounters: number;
    name: string;
    role?: RaidRole;
    totalDamage: number;
  }>;
  consumables?: RaidLogConsumables;
  deathsByAbility: Array<{ ability: string; deaths: number }>;
  deathsByPlayer: Array<{ deaths: number; name: string }>;
  encounters: Array<{
    boss?: number;
    deaths: number;
    durationSeconds: number;
    kill: boolean;
    name: string;
    topDps?: { dps: number; name: string };
  }>;
  generatedAt: string;
  // Fuente del análisis: el report más completo de la noche es la base y los
  // otros reports solo suman los pulls que no están en la base.
  source?: {
    basePulls: number;
    baseReport: string;
    extraPulls: number;
    repeatedPulls: number;
  };
};

const WOW_CLASSES = [
  "Death Knight",
  "Demon Hunter",
  "Druid",
  "Evoker",
  "Hunter",
  "Mage",
  "Monk",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
];

type WclAnalysisFight = {
  boss?: number;
  end_time?: number;
  kill?: boolean;
  name?: string;
  start_time?: number;
};

type WclActor = {
  class?: string;
  id: number;
  name: string;
  petOwner?: number;
  type?: string;
};

type WclAnalysisReport = {
  fights?: WclAnalysisFight[];
  friendlies?: WclActor[];
  // Inicio del report (epoch ms): permite ubicar cada pull en hora absoluta y
  // así detectar pulls repetidos entre reports de la misma noche.
  start?: number;
};

type WclDeathEvent = {
  ability?: { name?: string } | string;
  abilityName?: string;
  sourceID?: number;
  sourceName?: string;
  targetID?: number;
  targetName?: string;
  timestamp?: number;
};

type WclDamageEntry = {
  class?: string;
  id?: number;
  name?: string;
  total?: number;
  type?: string;
};

type WclDamageTable = {
  entries?: WclDamageEntry[];
};

type WclEventsPage<T> = {
  events?: T[];
  nextPageTimestamp?: number;
};

type WclSummaryPlayer = {
  name?: string;
};

type WclSummary = {
  playerDetails?: {
    dps?: WclSummaryPlayer[];
    healers?: WclSummaryPlayer[];
    tanks?: WclSummaryPlayer[];
  };
};

type WclAbilityRow = {
  guid?: number | string;
  name?: string;
  total?: number;
};

type WclRawEvent = {
  ability?: { guid?: number | string; name?: string } | string;
  auras?: unknown[];
  sourceID?: number;
  timestamp?: number;
};

type WclBuffTable = {
  entries?: Array<{
    auras?: WclAbilityRow[];
    entries?: WclAbilityRow[];
    sources?: WclAbilityRow[];
  }>;
};

// Consumo de un pull: quiénes estaban (CombatantInfo) y qué consumible tenía
// cada uno activo al empezar la pelea. Las flask y la comida son auras, así que
// no hacen falta los eventos de cast.
type FightExtras = {
  participants: string[];
  used: Map<string, Set<RaidConsumableKey>>;
};

// Resultado por report: el consumo de cada pull más qué categorías se pudieron
// medir (si algo no se pudo, la categoría no se reporta).
type PartConsumables = {
  categories: Set<RaidConsumableKey>;
  fights: FightExtras[];
};

type FightJob = {
  actors: Map<number, WclActor>;
  code: string;
  extras?: FightExtras;
  fight: WclAnalysisFight;
};

type RaidReportPart = {
  actors: Map<number, WclActor>;
  code: string;
  consumables?: PartConsumables;
  fights: WclAnalysisFight[];
  friendlies: WclActor[];
  roles?: Map<string, RaidRole>;
  start?: number;
};

type FightResult = {
  deaths: Array<{ ability?: string; player: string }>;
  durationSeconds: number;
  fight: WclAnalysisFight;
  damage: Array<{
    class?: string;
    dps: number;
    name: string;
    totalDamage: number;
  }>;
};

const ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const ANALYSIS_CACHE_LIMIT = 100;
const ANALYSIS_CONCURRENCY = 3;
// Dos reports de la misma noche marcan el mismo pull con unos segundos de
// diferencia (cada uno arranca su reloj en un momento distinto).
const FIGHT_OVERLAP_MS = 15 * 1000;
const analysisCache = new Map<
  string,
  { analysis: RaidLogAnalysis; expiresAt: number }
>();
const analysisInFlight = new Map<string, Promise<RaidLogAnalysis>>();

// El análisis se cachea por noche; lo que lo cambia desde afuera (un PJ
// confirmado a mano) tiene que poder tirarlo para que el próximo pedido lo
// vuelva a armar con el dato nuevo.
export function invalidateRaidLogAnalysis(guildId: string): void {
  for (const key of analysisCache.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      analysisCache.delete(key);
    }
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await map(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// Páginas del endpoint de eventos: WCL corta la respuesta y devuelve
// nextPageTimestamp, así que hay que seguir hasta que se repita o falte.
async function fetchEventPages<T>(
  code: string,
  eventType: string,
  query: { end: number; filter?: string; start: number },
): Promise<T[]> {
  const events: T[] = [];
  let cursor = query.start;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      end: String(query.end),
      start: String(cursor),
    });
    if (query.filter) {
      params.set("filter", query.filter);
    }
    const path = eventType
      ? `/report/events/${eventType}/${encodeURIComponent(code)}`
      : `/report/events/${encodeURIComponent(code)}`;
    const response = (await fetchWarcraftLogsV1Json(
      `${path}?${params.toString()}`,
    )) as WclEventsPage<T>;
    events.push(...(Array.isArray(response.events) ? response.events : []));
    if (
      typeof response.nextPageTimestamp !== "number" ||
      response.nextPageTimestamp <= cursor
    ) {
      break;
    }
    cursor = response.nextPageTimestamp;
  }

  return events;
}

function fetchDeathEvents(
  code: string,
  start: number,
  end: number,
): Promise<WclDeathEvent[]> {
  return fetchEventPages<WclDeathEvent>(code, "deaths", { end, start });
}

function actorName(
  id: number | undefined,
  actors: Map<number, WclActor>,
): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  const actor = actors.get(id);
  if (!actor) {
    return undefined;
  }
  return actor.petOwner
    ? (actors.get(actor.petOwner)?.name ?? actor.name)
    : actor.name;
}

function deathPlayer(
  event: WclDeathEvent,
  actors: Map<number, WclActor>,
): string {
  return (
    actorName(event.targetID, actors) ??
    actorName(event.sourceID, actors) ??
    event.targetName ??
    event.sourceName ??
    "Jugador sin identificar"
  );
}

function normalizeClass(value?: string): string | undefined {
  const normalized = (value ?? "").replace(/[^a-z]/gi, "").toLowerCase();
  return WOW_CLASSES.find(
    (wowClass) => wowClass.replace(/\s/g, "").toLowerCase() === normalized,
  );
}

function deathAbility(event: WclDeathEvent): string | undefined {
  const rawAbility =
    typeof event.ability === "string"
      ? event.ability
      : (event.ability?.name ?? event.abilityName ?? "");
  const ability = rawAbility.trim();
  return !ability || /^unknown(?: ability)?$/i.test(ability)
    ? undefined
    : ability;
}

function damagePlayer(
  entry: WclDamageEntry,
  actors: Map<number, WclActor>,
): { className?: string; name: string } | undefined {
  const actor = entry.id === undefined ? undefined : actors.get(entry.id);
  if (actor?.type?.toLowerCase() === "pet" && !actor.petOwner) {
    return undefined;
  }
  const owner = actor?.petOwner ? actors.get(actor.petOwner) : undefined;
  const name = owner?.name ?? actor?.name ?? entry.name;
  if (!name) {
    return undefined;
  }
  return {
    className: normalizeClass(
      owner?.class ??
        owner?.type ??
        actor?.class ??
        actor?.type ??
        entry.class ??
        entry.type,
    ),
    name,
  };
}

// Los nombres de personaje se comparan entre WCL (sin reino) y las
// inscripciones del evento (guardadas como "Personaje-Reino").
function playerKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

async function fetchReportRoles(
  code: string,
  start: number,
  end: number,
): Promise<Map<string, RaidRole>> {
  const summary = (await fetchWarcraftLogsV1Json(
    `/report/tables/summary/${encodeURIComponent(code)}?${new URLSearchParams({
      end: String(end),
      start: String(start),
    }).toString()}`,
  )) as WclSummary;
  const roles = new Map<string, RaidRole>();
  const register = (
    players: WclSummaryPlayer[] | undefined,
    role: RaidRole,
  ): void => {
    for (const player of players ?? []) {
      if (player?.name) {
        roles.set(playerKey(player.name), role);
      }
    }
  };
  register(summary.playerDetails?.tanks, "tank");
  register(summary.playerDetails?.healers, "healer");
  register(summary.playerDetails?.dps, "dps");
  return roles;
}

// Ventana antes del primer pull que se pide a WCL para no perder el
// CombatantInfo del pull (llega con el arranque de la pelea, no después).
const CONSUMABLE_PREPULL_MS = 30 * 1000;

// Warcraft Logs devuelve los nombres de habilidades como los tenía el cliente
// que subió el log, así que el mismo pull llega en inglés o en español
// ("The Coiled Altar" / "El Altar Serpenteante"). Los consumibles se buscan sin
// acentos y en los dos idiomas.
function foldAbilityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// Los nombres de frascos y de comida cambian en cada parche, así que se
// identifican por nombre. La guild sube logs en inglés, español y portugués, y
// de yapa los de otros clientes que aparezcan, así que se comparan raíces (sin
// acentos) en varios idiomas. Los frascos se llaman "flask"/"phial" en inglés y
// "frasco"/"vial" en español y portugués.
const FLASK_NAMES = ["flask", "phial", "frasco", "vial"];
// "Bien alimentado" (es), "Bem Alimentado" (pt), "Well Fed" (en).
const FOOD_NAMES = ["well fed", "alimentad"];

function nameHasAny(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => name.includes(pattern));
}

// Un consumible que no reconocemos se ve como "todos faltaron" y desde afuera no
// hay forma de saber con qué nombre viene en ese log, así que quedan en el log
// los buffs que estaban en casi todos los pulls (los de raid) y no se pudieron
// clasificar.
const UNRECOGNIZED_AURA_RATIO = 0.5;

function logUnrecognizedAuras(
  code: string,
  counts: Map<string, number>,
  snapshots: number,
): void {
  if (snapshots === 0) {
    return;
  }
  const common = [...counts.entries()]
    .filter(([, count]) => count >= snapshots * UNRECOGNIZED_AURA_RATIO)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, count]) => `${name} (${count})`);
  if (common.length > 0) {
    console.log(
      `[raid-logs] ${code}: auras sin clasificar en casi todos los pulls: ${common.join(", ")}`,
    );
  }
}

// Flask y comida se leen de las auras activas al empezar el pull, así que no
// hace falta castear nada: alcanza con el nombre del aura.
function auraConsumableCategory(
  name: string,
): RaidConsumableKey | undefined {
  const normalized = foldAbilityName(name);
  if (!normalized) {
    return undefined;
  }
  if (nameHasAny(normalized, FOOD_NAMES)) {
    return "food";
  }
  return nameHasAny(normalized, FLASK_NAMES) ? "flask" : undefined;
}

// En la v1 cada aura viene como { ability } (a veces con nombre); si solo hay
// id, el nombre sale de la tabla de buffs.
function parseAura(aura: unknown): { id?: number; name?: string } | undefined {
  if (typeof aura === "number" && Number.isFinite(aura)) {
    return { id: aura };
  }
  if (!aura || typeof aura !== "object") {
    return undefined;
  }
  const record = aura as { ability?: unknown; guid?: unknown; name?: unknown };
  const id = Number(record.ability ?? record.guid);
  const name = typeof record.name === "string" ? record.name : undefined;
  if (!Number.isFinite(id) && !name) {
    return undefined;
  }
  return { id: Number.isFinite(id) ? id : undefined, name };
}

function buffAuraRows(table: WclBuffTable): WclAbilityRow[] {
  const rows: WclAbilityRow[] = [];
  for (const entry of table.entries ?? []) {
    rows.push(...(entry.auras ?? entry.entries ?? entry.sources ?? []));
  }
  return rows;
}

function fightIndexAt(
  fights: WclAnalysisFight[],
  timestamp: number,
): number {
  return fights.findIndex(
    (fight) =>
      typeof fight.start_time === "number" &&
      typeof fight.end_time === "number" &&
      timestamp >= fight.start_time &&
      timestamp <= fight.end_time,
  );
}

// Consumo y participantes por pull: los consumibles salen de las auras activas
// al empezar el pull y quiénes estaban de CombatantInfo.
async function collectFightConsumables(input: {
  actors: Map<number, WclActor>;
  code: string;
  fights: WclAnalysisFight[];
}): Promise<PartConsumables | undefined> {
  const starts = input.fights.map((fight) => fight.start_time ?? 0);
  const ends = input.fights.map((fight) => fight.end_time ?? 0);
  const start = Math.max(0, Math.min(...starts) - CONSUMABLE_PREPULL_MS);
  const end = Math.max(...ends);
  const used = input.fights.map(
    () => new Map<string, Set<RaidConsumableKey>>(),
  );
  const participants = input.fights.map(() => new Set<string>());
  const addUse = (
    index: number,
    name: string,
    category: RaidConsumableKey,
  ): void => {
    const categories = used[index].get(name) ?? new Set<RaidConsumableKey>();
    categories.add(category);
    used[index].set(name, categories);
  };

  // Si CombatantInfo falla, el pull queda sin participantes y el armado del
  // análisis cae a los que aparecen en la tabla de daño.
  const pendingAuras: Array<{
    fight: number;
    id?: number;
    name?: string;
    player: string;
  }> = [];
  let snapshots = 0;
  try {
    const info = await fetchEventPages<WclRawEvent>(input.code, "", {
      end,
      filter: "type in ('combatantinfo')",
      start,
    });
    for (const event of info) {
      if (typeof event.timestamp !== "number") {
        continue;
      }
      const index = fightIndexAt(input.fights, event.timestamp);
      if (index === -1) {
        continue;
      }
      const actor =
        event.sourceID === undefined
          ? undefined
          : input.actors.get(event.sourceID);
      if (actor?.type?.toLowerCase() === "pet" && !actor.petOwner) {
        continue;
      }
      const name = actorName(event.sourceID, input.actors);
      if (!name) {
        continue;
      }
      participants[index].add(name);
      snapshots += 1;
      for (const aura of event.auras ?? []) {
        const parsed = parseAura(aura);
        if (parsed) {
          pendingAuras.push({ ...parsed, fight: index, player: name });
        }
      }
    }
  } catch {
    // Sin CombatantInfo seguimos con lo que se pudo leer de consumibles.
  }

  const categoryByAuraId = new Map<number, RaidConsumableKey | null>();
  const unnamedIds = new Set(
    pendingAuras
      .filter((aura) => aura.name === undefined && aura.id !== undefined)
      .map((aura) => aura.id as number),
  );
  // Solo hace falta la tabla de buffs si las auras vinieron sin nombre.
  if (unnamedIds.size > 0) {
    try {
      const buffs = (await fetchWarcraftLogsV1Json(
        `/report/tables/buffs/${encodeURIComponent(input.code)}?${new URLSearchParams(
          { by: "target", end: String(end), start: String(start) },
        ).toString()}`,
      )) as WclBuffTable;
      for (const row of buffAuraRows(buffs)) {
        const id = Number(row?.guid);
        if (!Number.isFinite(id) || !unnamedIds.has(id)) {
          continue;
        }
        categoryByAuraId.set(
          id,
          row?.name ? (auraConsumableCategory(row.name) ?? null) : null,
        );
      }
    } catch {
      // Sin nombres de aura flask/comida/runa quedan sin medir.
    }
  }
  const categories = new Set<RaidConsumableKey>();
  const unrecognized = new Map<string, number>();
  for (const aura of pendingAuras) {
    let category: RaidConsumableKey | null | undefined;
    if (aura.name !== undefined) {
      category = auraConsumableCategory(aura.name) ?? null;
      if (aura.id !== undefined) {
        categoryByAuraId.set(aura.id, category);
      }
      if (!category) {
        const label = foldAbilityName(aura.name);
        unrecognized.set(label, (unrecognized.get(label) ?? 0) + 1);
      }
    } else if (aura.id !== undefined) {
      category = categoryByAuraId.get(aura.id) ?? null;
    }
    // Cada categoría se da por medible solo si se reconoció al menos un aura
    // suya en la noche: dar la noche por medible porque "hay auras con nombre"
    // marcaba a los 24 como faltantes de comida cuando el log venía en un
    // idioma (o un nombre) que no reconocíamos.
    if (category) {
      addUse(aura.fight, aura.player, category);
      categories.add(category);
    }
  }
  logUnrecognizedAuras(input.code, unrecognized, snapshots);

  return {
    categories,
    fights: input.fights.map((_, index) => ({
      participants: [...participants[index]].sort((a, b) => a.localeCompare(b)),
      used: used[index],
    })),
  };
}

async function analyzeFight(job: FightJob): Promise<FightResult> {
  const start = job.fight.start_time;
  const end = job.fight.end_time;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) {
    throw new Error("Warcraft Logs devolvió un intervalo de pelea inválido.");
  }

  const [events, rawTable] = await Promise.all([
    fetchDeathEvents(job.code, start, end),
    fetchWarcraftLogsV1Json(
      `/report/tables/damage-done/${encodeURIComponent(job.code)}?${new URLSearchParams(
        {
          end: String(end),
          start: String(start),
        },
      ).toString()}`,
    ),
  ]);
  const table = rawTable as WclDamageTable;
  const durationSeconds = (end - start) / 1000;
  const damageByPlayer = new Map<
    string,
    { className?: string; totalDamage: number }
  >();

  for (const entry of table.entries ?? []) {
    const player = damagePlayer(entry, job.actors);
    const total = Number(entry.total ?? 0);
    if (!player || !Number.isFinite(total) || total <= 0) {
      continue;
    }
    const previous = damageByPlayer.get(player.name);
    damageByPlayer.set(player.name, {
      className: previous?.className ?? player.className,
      totalDamage: (previous?.totalDamage ?? 0) + total,
    });
  }

  return {
    damage: [...damageByPlayer.entries()].map(([name, player]) => ({
      class: player.className,
      dps: player.totalDamage / durationSeconds,
      name,
      totalDamage: player.totalDamage,
    })),
    deaths: events.map((event) => ({
      ability: deathAbility(event),
      player: deathPlayer(event, job.actors),
    })),
    durationSeconds,
    fight: job.fight,
  };
}

async function buildRaidLogNightAnalysis(
  guildId: string,
  logId: string,
): Promise<RaidLogAnalysis> {
  const logs = await listRaidLogs(guildId);
  const selected = logs.find((log) => log.id === logId);
  if (!selected) {
    throw new Error("Log no encontrado");
  }

  const cacheKey = `${guildId}:${selected.groupKey}`;
  const cached = analysisCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.analysis;
  }

  const parts = logs.filter((log) => log.groupKey === selected.groupKey);
  const reports: RaidReportPart[] = await Promise.all(
    parts.map(async (part) => {
      const code = part.reportCode;
      const report = (await fetchWarcraftLogsV1Json(
        `/report/fights/${encodeURIComponent(code)}`,
      )) as WclAnalysisReport;
      const actors = new Map<number, WclActor>(
        (report.friendlies ?? []).map((actor) => [actor.id, actor]),
      );
      const fights = (report.fights ?? []).filter(
        (fight) =>
          (fight.boss ?? 0) > 0 &&
          typeof fight.start_time === "number" &&
          typeof fight.end_time === "number" &&
          fight.end_time > fight.start_time,
      );
      const start = Math.min(...fights.map((fight) => fight.start_time ?? 0));
      const end = Math.max(...fights.map((fight) => fight.end_time ?? 0));
      const [roles, consumables] = await Promise.all([
        fights.length > 0
          ? fetchReportRoles(code, start, end).catch(() => undefined)
          : undefined,
        fights.length > 0
          ? collectFightConsumables({ actors, code, fights }).catch(
              () => undefined,
            )
          : undefined,
      ]);
      return {
        actors,
        code,
        consumables,
        fights,
        friendlies: report.friendlies ?? [],
        roles,
        start: typeof report.start === "number" ? report.start : undefined,
      };
    }),
  );
  // El report más completo es la base del análisis: define los nombres de los
  // bosses y gana cuando un pull figura en los dos. Los demás reports solo
  // aportan los pulls que no están en la base.
  const base = reports.reduce(
    (best, report) =>
      report.fights.length > best.fights.length ? report : best,
    reports[0],
  );
  const ordered = [...reports].sort(
    (left, right) => right.fights.length - left.fights.length,
  );
  // Dos reports distintos de la misma noche (dos personas loggeando la misma
  // raid) traen los MISMOS pulls duplicados: se comparan por boss + hora
  // absoluta y se analiza cada pull una sola vez.
  const jobs: FightJob[] = [];
  const fightStarts = new Map<string, number[]>();
  let repeatedFights = 0;
  let extraPulls = 0;
  for (const report of ordered) {
    report.fights.forEach((fight, index) => {
      const absoluteStart =
        report.start !== undefined && typeof fight.start_time === "number"
          ? report.start + fight.start_time
          : undefined;
      if (absoluteStart !== undefined) {
        // La identidad del pull es el id de encuentro: el NOMBRE del boss cambia
        // con el idioma del cliente que subió el log ("The Coiled Altar" vs
        // "El Altar Serpenteante"), así que con el nombre se contaba dos veces.
        const boss = fight.boss === undefined ? (fight.name ?? "") : String(fight.boss);
        const starts = fightStarts.get(boss) ?? [];
        if (starts.some((time) => Math.abs(time - absoluteStart) <= FIGHT_OVERLAP_MS)) {
          repeatedFights += 1;
          return;
        }
        starts.push(absoluteStart);
        fightStarts.set(boss, starts);
      }
      jobs.push({
        actors: report.actors,
        code: report.code,
        extras: report.consumables?.fights[index],
        fight,
      });
      if (report.code !== base.code) {
        extraPulls += 1;
      }
    });
  }
  if (repeatedFights > 0) {
    console.log(
      `[raid-logs] ${selected.reportCode}: ${repeatedFights} pull/s repetidos entre los reports de la noche (se contaron una sola vez)`,
    );
  }
  const source: NonNullable<RaidLogAnalysis["source"]> = {
    basePulls: base.fights.length,
    baseReport: base.code,
    extraPulls,
    repeatedPulls: repeatedFights,
  };

  const fightResults = await mapWithConcurrency(
    jobs,
    ANALYSIS_CONCURRENCY,
    analyzeFight,
  );
  const roles = new Map<string, RaidRole>();
  for (const report of ordered) {
    for (const [name, role] of report.roles ?? []) {
      // Si los dos reports traen el rol, manda el del report base.
      if (!roles.has(name)) {
        roles.set(name, role);
      }
    }
  }
  const roleOf = (name: string): RaidRole | undefined => roles.get(playerKey(name));

  // Categorías que se pudieron medir: solo flask y comida, que salen de las
  // auras activas al empezar el pull. Si en la noche no se reconoció ninguna
  // aura suya (idioma del log, nombre nuevo), esa fila no se muestra en vez de
  // listar a toda la raid como faltante.
  const consumableCategories: RaidConsumableKey[] = [];
  for (const category of ["flask", "food"] as RaidConsumableKey[]) {
    if (ordered.some((report) => report.consumables?.categories.has(category))) {
      consumableCategories.push(category);
    }
  }

  const playerDeaths = new Map<string, number>();
  const abilityDeaths = new Map<string, number>();
  const playerDps = new Map<
    string,
    {
      className?: string;
      fights: number;
      totalDamage: number;
      totalDps: number;
    }
  >();
  const consumablePlayers = new Map<
    string,
    {
      counts: Map<RaidConsumableKey, number>;
      pulls: number;
    }
  >();
  const consumablePulls: RaidLogConsumables["pulls"] = [];
  const encounters: RaidLogAnalysis["encounters"] = [];
  const playerClasses = new Map<string, string>();
  for (const report of ordered) {
    for (const actor of report.friendlies) {
      if (actor.petOwner || actor.type?.toLowerCase() === "pet") {
        continue;
      }
      const playerClass = normalizeClass(actor.class ?? actor.type);
      if (actor.name && playerClass) {
        if (!playerClasses.has(actor.name)) {
          playerClasses.set(actor.name, playerClass);
        }
        playerDeaths.set(actor.name, playerDeaths.get(actor.name) ?? 0);
      }
    }
  }

  for (let index = 0; index < fightResults.length; index += 1) {
    const result = fightResults[index];
    const extras = jobs[index].extras;
    for (const death of result.deaths) {
      playerDeaths.set(death.player, (playerDeaths.get(death.player) ?? 0) + 1);
      if (death.ability) {
        abilityDeaths.set(
          death.ability,
          (abilityDeaths.get(death.ability) ?? 0) + 1,
        );
      }
    }

    for (const player of result.damage) {
      const aggregate = playerDps.get(player.name) ?? {
        className: player.class,
        fights: 0,
        totalDamage: 0,
        totalDps: 0,
      };
      aggregate.className ??= player.class;
      aggregate.fights += 1;
      aggregate.totalDamage += player.totalDamage;
      aggregate.totalDps += player.dps;
      playerDps.set(player.name, aggregate);
    }

    if (extras) {
      // Si CombatantInfo no trajo el pull, los participantes se aproximan con
      // los que figuran en la tabla de daño.
      const participants =
        extras.participants.length > 0
          ? extras.participants
          : result.damage.map((player) => player.name);
      for (const name of participants) {
        const aggregate = consumablePlayers.get(name) ?? {
          counts: new Map<RaidConsumableKey, number>(),
          pulls: 0,
        };
        aggregate.pulls += 1;
        for (const category of extras.used.get(name) ?? []) {
          aggregate.counts.set(
            category,
            (aggregate.counts.get(category) ?? 0) + 1,
          );
        }
        consumablePlayers.set(name, aggregate);
      }
      const missingByPull: Partial<Record<RaidConsumableKey, string[]>> = {};
      const usedCategory = (name: string, category: RaidConsumableKey): boolean =>
        extras.used.get(name)?.has(category) ?? false;
      for (const category of consumableCategories) {
        missingByPull[category] = participants.filter(
          (name) => !usedCategory(name, category),
        );
      }
      consumablePulls.push({
        boss: result.fight.boss,
        missing: missingByPull,
        name: result.fight.name ?? "Boss",
        participants: participants.length,
      });
    }

    // El "top DPS" del pull tiene que ser DPS: un heal o un tank con burst no
    // representa el daño de la raid.
    const pullDamage = result.damage.filter(
      (player) => roleOf(player.name) !== "tank" && roleOf(player.name) !== "healer",
    );
    const topDps = [...(pullDamage.length > 0 ? pullDamage : result.damage)].sort(
      (a, b) => b.dps - a.dps,
    )[0];
    encounters.push({
      boss: result.fight.boss,
      deaths: result.deaths.length,
      durationSeconds: Math.round(result.durationSeconds),
      kill: Boolean(result.fight.kill),
      name: result.fight.name ?? "Boss",
      topDps: topDps
        ? { dps: Math.round(topDps.dps), name: topDps.name }
        : undefined,
    });
  }

  const averageDps = [...playerDps.entries()]
    .map(([name, totals]) => ({
      averageDps: Math.round(totals.totalDps / totals.fights),
      class: totals.className,
      encounters: totals.fights,
      name,
      role: roleOf(name),
      totalDamage: Math.round(totals.totalDamage),
    }))
    .sort((a, b) => b.averageDps - a.averageDps);

  const analysis: RaidLogAnalysis = {
    averageDps,
    consumables:
      consumableCategories.length > 0
        ? {
            categories: consumableCategories,
            players: [...consumablePlayers.entries()]
              .map(([name, totals]) => ({
                class: playerDps.get(name)?.className ?? playerClasses.get(name),
                counts: Object.fromEntries(
                  consumableCategories.map((category) => [
                    category,
                    totals.counts.get(category) ?? 0,
                  ]),
                ),
                name,
                pulls: totals.pulls,
                role: roleOf(name),
              }))
              // Primero los que menos cumplieron, en proporción a sus pulls.
              .sort((a, b) => {
                const score = (player: (typeof a)): number => {
                  const total = consumableCategories.length * player.pulls;
                  if (total === 0) {
                    return 0;
                  }
                  const hits = consumableCategories.reduce(
                    (sum, category) => sum + (player.counts[category] ?? 0),
                    0,
                  );
                  return hits / total;
                };
                return score(a) - score(b) || a.name.localeCompare(b.name);
              }),
            pulls: consumablePulls,
          }
        : undefined,
    deathsByAbility: [...abilityDeaths.entries()]
      .map(([ability, deaths]) => ({ ability, deaths }))
      .sort((a, b) => b.deaths - a.deaths),
    deathsByPlayer: [...playerDeaths.entries()]
      .map(([name, deaths]) => ({ deaths, name }))
      .sort((a, b) => b.deaths - a.deaths),
    encounters,
    generatedAt: new Date().toISOString(),
    source,
  };

  const attendancePlayers = new Map<
    string,
    { class?: string; name: string; pulls: number; role?: RaidRole }
  >();
  let pullsWithPresence = 0;
  for (const [index, job] of jobs.entries()) {
    const extras = job.extras;
    if (!extras) {
      continue;
    }
    const result = fightResults[index];
    const participants =
      extras.participants.length > 0
        ? extras.participants
        : result.damage.map((player) => player.name);
    if (extras.participants.length > 0) {
      pullsWithPresence += 1;
    }
    for (const name of participants) {
      const player = attendancePlayers.get(name) ?? {
        class: playerDps.get(name)?.className ?? playerClasses.get(name),
        name,
        pulls: 0,
        role: roleOf(name),
      };
      player.pulls += 1;
      attendancePlayers.set(name, player);
    }
  }
  if (attendancePlayers.size === 0) {
    for (const player of averageDps) {
      attendancePlayers.set(player.name, {
        class: player.class,
        name: player.name,
        pulls: player.encounters,
        role: player.role,
      });
    }
  }

  try {
    analysis.attendance = await crossRaidAttendance({
      guildId,
      nightStart: selected.firstFightAt,
      partialParticipants:
        attendancePlayers.size > 0 && pullsWithPresence === 0,
      players: [...attendancePlayers.values()],
      totalPulls: encounters.length,
    });
  } catch {
    // La asistencia es un extra: si falla, el análisis se devuelve igual.
  }

  analysisCache.set(cacheKey, {
    analysis,
    expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS,
  });
  while (analysisCache.size > ANALYSIS_CACHE_LIMIT) {
    const oldestKey = analysisCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    analysisCache.delete(oldestKey);
  }

  return analysis;
}

export function analyzeRaidLogNight(
  guildId: string,
  logId: string,
): Promise<RaidLogAnalysis> {
  const requestKey = `${guildId}:${logId}`;
  const inFlight = analysisInFlight.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = buildRaidLogNightAnalysis(guildId, logId);
  analysisInFlight.set(requestKey, request);
  return request.finally(() => {
    if (analysisInFlight.get(requestKey) === request) {
      analysisInFlight.delete(requestKey);
    }
  });
}
