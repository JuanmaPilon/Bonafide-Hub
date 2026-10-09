import {
  fetchWarcraftLogsV1Json,
  listRaidLogs,
} from "./raid-logs-store.js";
import {
  crossRaidAttendance,
  type RaidLogAttendance,
} from "./raid-logs-attendance.js";

export type RaidRole = "dps" | "healer" | "tank";

// prepot = la misma poción, usada en los segundos previos al pull: se mide
// aparte para distinguirla de la que se usa durante la pelea.
export type RaidConsumableKey =
  | "flask"
  | "food"
  | "potions"
  | "prepot"
  | "healthstones"
  | "healthPotions";

export type RaidLogConsumables = {
  // Solo las categorías que se pudieron medir en esta noche: si WCL no expone
  // la tabla de casts o no se pueden resolver los nombres de las auras, esas
  // categorías no aparecen y la web no inventa faltantes.
  categories: RaidConsumableKey[];
  // Categorías que corresponden a cada pull (flask, comida, pota y prepot): ahí
  // "faltó" es un dato útil. Las de uso reaccional (piedra y poción de vida) no
  // se esperan por pull, así que lo que se informa es quién las usó.
  expected: RaidConsumableKey[];
  // Consumo agregado por jugador: en cuántos pulls participó, en cuántos usó cada
  // consumible (un pull cuenta una vez) y cuántas veces lo usó en total.
  players: Array<{
    class?: string;
    counts: Partial<Record<RaidConsumableKey, number>>;
    name: string;
    pulls: number;
    role?: RaidRole;
    uses: Partial<Record<RaidConsumableKey, number>>;
  }>;
  pulls: Array<{
    boss?: number;
    missing: Partial<Record<RaidConsumableKey, string[]>>;
    name: string;
    participants: number;
    used: Partial<Record<RaidConsumableKey, number>>;
    usedNames: Partial<Record<RaidConsumableKey, string[]>>;
  }>;
  // Categorías de "control" que este log no permitió medir (los nombres de las
  // pociones o de las auras no matchearon, o la tabla de casts no las trajo): la
  // web lo aclara en vez de dar a entender que nadie las usó.
  unmeasured: RaidConsumableKey[];
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
  // Muertes sin haber usado piedra ni poción de vida en los segundos previos.
  // Es lo único que el log permite saber: si la usó y murió igual, la usó.
  defensives?: {
    // Muertes por jugador, con cuántas fueron sin defensivo.
    players: Array<{ deaths: number; name: string; used: number; without: number }>;
    totalDeaths: number;
    // Cuántos segundos antes de morir se busca el cast.
    windowSeconds: number;
    without: number;
  };
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

type WclCastsTableEntry = {
  abilities?: WclAbilityRow[];
  entries?: WclAbilityRow[];
  sources?: WclAbilityRow[];
};

type WclCastsTable = {
  entries?: WclCastsTableEntry[];
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

// Consumo de un pull: quiénes estaban y qué usó cada uno, con CUÁNTAS veces
// (una piedra por pull no es lo mismo que tres). Se arma aparte del análisis de
// daño porque necesita los eventos de CombatantInfo.
type FightExtras = {
  // Momento (relativo al report) de cada cast de piedra o poción de vida, que es
  // lo que permite saber si la usó ANTES de morir.
  defensives: Map<string, number[]>;
  participants: string[];
  used: Map<string, Map<RaidConsumableKey, number>>;
};

// Resultado por report: el consumo de cada pull más qué categorías se pudieron
// medir (si algo no se pudo, la categoría no se reporta).
type PartConsumables = {
  auraCategories: Set<RaidConsumableKey>;
  castCategories: Set<RaidConsumableKey>;
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
  deaths: Array<{ ability?: string; player: string; timestamp?: number }>;
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

const CONSUMABLE_PREPULL_MS = 30 * 1000;
// Ventana antes de morir en la que se busca una piedra o poción de vida: más
// atrás que esto, el cast no tiene que ver con esa muerte.
const DEFENSIVE_WINDOW_MS = 12 * 1000;
// Una poción usada hasta este límite antes del pull es la prepot.
const PREPOT_WINDOW_MS = CONSUMABLE_PREPULL_MS;

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

// Los nombres de pociones y piedras cambian en cada parche, así que se
// identifican por nombre (en la tabla de casts) en vez de por id fijo. La guild
// sube logs en inglés, español y portugués, y de yapa los de otros clientes que
// aparezcan, así que se comparan raíces (sin acentos) en varios idiomas.
const HEALTHSTONE_NAMES = [
  "healthstone",
  "piedra de salud",
  "piedra de brujo",
  "pedra de saude",
  "pedra de bruxo",
  "pierre de soin",
  "gesundheitsstein",
  "pietra di salute",
];
const HEALTH_POTION_NAMES = [
  "health potion",
  "healing potion",
  "pocion de vida",
  "pocion de salud",
  "pocion de curacion",
  "pocion de sanacion",
  "pocao de vida",
  "pocao de cura",
  "potion de soin",
  "heiltrank",
  "pozione di cura",
];
const MANA_POTION_NAMES = ["mana potion", "pocion de mana", "pocao de mana"];
const POTION_NAMES = ["potion", "pocion", "pocima", "pocao", "pozione", "trank"];
// "Create Healthstone" / "Crear piedra de brujo" es crear la piedra, no usarla.
const CREATE_NAMES = ["create", "crear", "criar", "craft", "erstellen"];
// Los frascos se llaman "flask"/"phial" en inglés y "frasco"/"vial" en
// español y portugués.
const FLASK_NAMES = ["flask", "phial", "frasco", "vial"];
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

// Cuando NINGUNA categoría de cast se reconoció, hay que poder ver con qué
// nombres vienen las pociones y las piedras en ese log, así que se listan los
// casts más usados de la noche que suenen a consumible.
const CONSUMABLE_HINT = /potion|pocion|pocao|pozione|trank|stone|stein|piedra|pedra|pierre|pietra|flask|frasco|phial|vial/;

function logUnrecognizedCasts(
  code: string,
  names: Map<string, number>,
): void {
  const likely = [...names.entries()]
    .filter(([name]) => CONSUMABLE_HINT.test(foldAbilityName(name)))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([name, count]) => `${name} (${count})`);
  if (likely.length > 0) {
    console.log(
      `[raid-logs] ${code}: ningún consumible reconocido; casts que suenan a consumible: ${likely.join(", ")}`,
    );
    return;
  }
  const top = [...names.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([name, count]) => `${name} (${count})`);
  console.log(
    `[raid-logs] ${code}: ningún consumible reconocido; casts más usados: ${top.join(", ")}`,
  );
}

function castConsumableCategory(
  name: string,
): RaidConsumableKey | undefined {
  const normalized = foldAbilityName(name);
  if (nameHasAny(normalized, CREATE_NAMES)) {
    return undefined;
  }
  if (nameHasAny(normalized, HEALTHSTONE_NAMES)) {
    return "healthstones";
  }
  if (nameHasAny(normalized, HEALTH_POTION_NAMES)) {
    return "healthPotions";
  }
  if (nameHasAny(normalized, MANA_POTION_NAMES)) {
    return undefined;
  }
  return nameHasAny(normalized, POTION_NAMES) ? "potions" : undefined;
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

function collectConsumableAbilityIds(
  table: WclCastsTable,
  nameCounts: Map<string, number>,
): Map<number, RaidConsumableKey> {
  const categories = new Map<number, RaidConsumableKey>();
  for (const entry of table.entries ?? []) {
    for (const row of entry.abilities ?? entry.entries ?? entry.sources ?? []) {
      const guid = Number(row?.guid);
      const name = row?.name;
      if (!name) {
        continue;
      }
      nameCounts.set(
        name,
        (nameCounts.get(name) ?? 0) + (Number(row?.total) || 1),
      );
      const category = castConsumableCategory(name);
      if (Number.isFinite(guid) && guid > 0 && category) {
        categories.set(guid, category);
      }
    }
  }
  return categories;
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

// Pull al que corresponde una prepot: el próximo que arranca después del cast.
function prepullFightIndex(
  fights: WclAnalysisFight[],
  timestamp: number,
): number {
  return fights.findIndex(
    (fight) =>
      typeof fight.start_time === "number" &&
      fight.start_time >= timestamp &&
      fight.start_time - timestamp <= PREPOT_WINDOW_MS,
  );
}

// Consumo y participantes por pull. Los ids de consumible salen de la tabla de
// casts, el uso real de los eventos de cast filtrados, quiénes estaban en el
// pull de CombatantInfo, y flask/comida/runa de las auras de esos eventos.
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
    () => new Map<string, Map<RaidConsumableKey, number>>(),
  );
  const defensives = input.fights.map(() => new Map<string, number[]>());
  // Piedra y poción de vida son las que se usan cuando la pelea lo pide: si no
  // aparecen antes de una muerte, se murió sin defensivo.
  const DEFENSIVE_CATEGORIES = new Set<RaidConsumableKey>([
    "healthstones",
    "healthPotions",
  ]);
  const participants = input.fights.map(() => new Set<string>());
  const addUse = (
    index: number,
    name: string,
    category: RaidConsumableKey,
    timestamp?: number,
  ): void => {
    const categories =
      used[index].get(name) ?? new Map<RaidConsumableKey, number>();
    categories.set(category, (categories.get(category) ?? 0) + 1);
    used[index].set(name, categories);
    if (timestamp !== undefined && DEFENSIVE_CATEGORIES.has(category)) {
      const times = defensives[index].get(name) ?? [];
      times.push(timestamp);
      defensives[index].set(name, times);
    }
  };

  const table = (await fetchWarcraftLogsV1Json(
    `/report/tables/casts/${encodeURIComponent(input.code)}?${new URLSearchParams(
      { by: "source", end: String(end), start: String(start) },
    ).toString()}`,
  )) as WclCastsTable;
  const castNameCounts = new Map<string, number>();
  const abilityCategories = collectConsumableAbilityIds(table, castNameCounts);
  const castCategories = new Set(abilityCategories.values());
  if (castCategories.size === 0) {
    logUnrecognizedCasts(input.code, castNameCounts);
  }

  if (castCategories.size > 0) {
    const casts = await fetchEventPages<WclRawEvent>(input.code, "casts", {
      end,
      filter: `ability.id IN (${[...abilityCategories.keys()].join(",")})`,
      start,
    });
    for (const event of casts) {
      const ability =
        typeof event.ability === "object" ? event.ability : undefined;
      const category = abilityCategories.get(Number(ability?.guid));
      const timestamp = event.timestamp;
      if (!category || typeof timestamp !== "number") {
        continue;
      }
      const name = actorName(event.sourceID, input.actors);
      if (!name) {
        continue;
      }
      const inside = fightIndexAt(input.fights, timestamp);
      if (inside !== -1) {
        addUse(inside, name, category, timestamp);
        continue;
      }
      if (category === "potions") {
        const before = prepullFightIndex(input.fights, timestamp);
        if (before !== -1) {
          addUse(before, name, "prepot", timestamp);
        }
      }
    }
  }

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
  const auraCategories = new Set<RaidConsumableKey>();
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
      auraCategories.add(category);
    }
  }
  logUnrecognizedAuras(input.code, unrecognized, snapshots);

  return {
    auraCategories,
    castCategories,
    fights: input.fights.map((_, index) => ({
      defensives: defensives[index],
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
      timestamp: event.timestamp,
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

  // Categorías que se pudieron medir: el orden es el de la UI.
  const castCategories = new Set<RaidConsumableKey>();
  const auraCategories = new Set<RaidConsumableKey>();
  for (const report of ordered) {
    for (const category of report.consumables?.castCategories ?? []) {
      castCategories.add(category);
    }
    for (const category of report.consumables?.auraCategories ?? []) {
      auraCategories.add(category);
    }
  }
  // Flask, comida, pota y prepot se esperan en cada pull: ahí "faltó" es un dato.
  // Flask y comida van por separado: si en la noche no se reconoció ningún aura
  // de comida (idioma del log, nombre nuevo), esa fila no se muestra en vez de
  // listar a toda la raid como si no hubiera comido.
  const expectedCategories: RaidConsumableKey[] = [];
  if (auraCategories.has("flask")) {
    expectedCategories.push("flask");
  }
  if (auraCategories.has("food")) {
    expectedCategories.push("food");
  }
  if (castCategories.has("potions")) {
    expectedCategories.push("potions", "prepot");
  }
  // Piedra y poción de vida se usan cuando la pelea lo pide, así que no hay un
  // "debería" por pull: solo se informa quién las usó.
  const reactiveCategories: RaidConsumableKey[] = [];
  if (castCategories.has("healthstones")) {
    reactiveCategories.push("healthstones");
  }
  if (castCategories.has("healthPotions")) {
    reactiveCategories.push("healthPotions");
  }
  const consumableCategories: RaidConsumableKey[] = [
    ...expectedCategories,
    ...reactiveCategories,
  ];
  // Lo que se esperaba medir y no se pudo: si no se reconoció ninguna poción o
  // piedra (nombres nuevos, otro idioma), la noche no puede decir "nadie usó"
  // sin avisar.
  const unmeasured = (
    ["flask", "food", "potions", "healthstones", "healthPotions"] as RaidConsumableKey[]
  ).filter((category) => !consumableCategories.includes(category));

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
      uses: Map<RaidConsumableKey, number>;
    }
  >();
  const consumablePulls: RaidLogConsumables["pulls"] = [];
  const defensiveDeaths = new Map<
    string,
    { deaths: number; used: number; without: number }
  >();
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
          uses: new Map<RaidConsumableKey, number>(),
        };
        aggregate.pulls += 1;
        for (const [category, times] of extras.used.get(name) ?? []) {
          aggregate.counts.set(
            category,
            (aggregate.counts.get(category) ?? 0) + 1,
          );
          aggregate.uses.set(category, (aggregate.uses.get(category) ?? 0) + times);
        }
        consumablePlayers.set(name, aggregate);
      }
      const usedByPull: Partial<Record<RaidConsumableKey, number>> = {};
      const usedNamesByPull: Partial<Record<RaidConsumableKey, string[]>> = {};
      const missingByPull: Partial<Record<RaidConsumableKey, string[]>> = {};
      const usedCategory = (name: string, category: RaidConsumableKey): boolean =>
        (extras.used.get(name)?.get(category) ?? 0) > 0;
      for (const category of consumableCategories) {
        const users = participants.filter((name) =>
          usedCategory(name, category),
        );
        usedByPull[category] = users.length;
        usedNamesByPull[category] = users;
        missingByPull[category] = participants.filter(
          (name) => !usedCategory(name, category),
        );
      }
      consumablePulls.push({
        boss: result.fight.boss,
        missing: missingByPull,
        name: result.fight.name ?? "Boss",
        participants: participants.length,
        used: usedByPull,
        usedNames: usedNamesByPull,
      });
    }

    // Muerte sin defensivo: el jugador no usó piedra ni poción de vida en los
    // segundos previos (el cast queda en el mismo timestamp relativo al report).
    for (const death of result.deaths) {
      if (death.timestamp === undefined) {
        continue;
      }
      const aggregate = defensiveDeaths.get(death.player) ?? {
        deaths: 0,
        used: 0,
        without: 0,
      };
      aggregate.deaths += 1;
      const casts = extras?.defensives.get(death.player) ?? [];
      const usedBefore = casts.some(
        (cast) =>
          cast <= death.timestamp! &&
          death.timestamp! - cast <= DEFENSIVE_WINDOW_MS,
      );
      if (usedBefore) {
        aggregate.used += 1;
      } else {
        aggregate.without += 1;
      }
      defensiveDeaths.set(death.player, aggregate);
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
            expected: expectedCategories,
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
                uses: Object.fromEntries(
                  consumableCategories.map((category) => [
                    category,
                    totals.uses.get(category) ?? 0,
                  ]),
                ),
              }))
              // Primero los que menos cumplieron, en proporción a sus pulls.
              .sort((a, b) => {
                // Solo cuentan las categorías que se esperan por pull: no usar
                // una piedra no es incumplir nada.
                const scored =
                  expectedCategories.length > 0
                    ? expectedCategories
                    : consumableCategories;
                const score = (player: (typeof a)): number => {
                  const total = scored.length * player.pulls;
                  if (total === 0) {
                    return 0;
                  }
                  const hits = scored.reduce(
                    (sum, category) => sum + (player.counts[category] ?? 0),
                    0,
                  );
                  return hits / total;
                };
                return score(a) - score(b) || a.name.localeCompare(b.name);
              }),
            pulls: consumablePulls,
            unmeasured,
          }
        : undefined,
    deathsByAbility: [...abilityDeaths.entries()]
      .map(([ability, deaths]) => ({ ability, deaths }))
      .sort((a, b) => b.deaths - a.deaths),
    deathsByPlayer: [...playerDeaths.entries()]
      .map(([name, deaths]) => ({ deaths, name }))
      .sort((a, b) => b.deaths - a.deaths),
    // Solo aparece si se pudieron medir los defensivos (piedra o poción de vida
    // reconocidas en la noche): sin eso, todo el mundo parecería morir sin usar.
    defensives:
      castCategories.has("healthstones") || castCategories.has("healthPotions")
        ? {
            players: [...defensiveDeaths.entries()]
              .map(([name, totals]) => ({ name, ...totals }))
              .sort(
                (a, b) =>
                  b.without - a.without ||
                  b.deaths - a.deaths ||
                  a.name.localeCompare(b.name),
              ),
            totalDeaths: [...defensiveDeaths.values()].reduce(
              (sum, totals) => sum + totals.deaths,
              0,
            ),
            windowSeconds: Math.round(DEFENSIVE_WINDOW_MS / 1000),
            without: [...defensiveDeaths.values()].reduce(
              (sum, totals) => sum + totals.without,
              0,
            ),
          }
        : undefined,
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
