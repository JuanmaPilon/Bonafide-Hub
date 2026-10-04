import {
  fetchWarcraftLogsV1Json,
  listRaidLogs,
} from "./raid-logs-store.js";
import {
  crossRaidAttendance,
  type RaidLogAttendance,
} from "./raid-logs-attendance.js";

export type RaidRole = "dps" | "healer" | "tank";

export type RaidConsumableCategory = "healthPotion" | "healthstone" | "potion";

export type RaidLogConsumables = {
  // Consumo agregado por jugador: en cuántos pulls participó y en cuántos usó
  // cada consumible (un pull cuenta una vez, aunque use dos pociones).
  players: Array<{
    class?: string;
    healthPotions: number;
    healthstones: number;
    name: string;
    potions: number;
    pulls: number;
    role?: RaidRole;
  }>;
  pulls: Array<{
    healthPotionsUsed: number;
    healthstonesUsed: number;
    missingHealthPotions: string[];
    missingHealthstones: string[];
    missingPotions: string[];
    name: string;
    participants: number;
    potionsUsed: number;
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
    deaths: number;
    durationSeconds: number;
    kill: boolean;
    name: string;
    topDps?: { dps: number; name: string };
  }>;
  generatedAt: string;
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
  sourceID?: number;
  timestamp?: number;
};

// Consumo de un pull: quiénes estaban y qué usó cada uno. Se arma aparte del
// análisis de daño porque necesita los eventos de CombatantInfo.
type FightExtras = {
  participants: string[];
  used: Map<string, Set<RaidConsumableCategory>>;
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
  extras?: FightExtras[];
  fights: WclAnalysisFight[];
  friendlies: WclActor[];
  roles?: Map<string, RaidRole>;
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
const analysisCache = new Map<
  string,
  { analysis: RaidLogAnalysis; expiresAt: number }
>();
const analysisInFlight = new Map<string, Promise<RaidLogAnalysis>>();

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

// Los nombres de pociones y piedras cambian en cada parche, así que se
// identifican por nombre (en la tabla de casts) en vez de por id fijo.
function consumableCategory(name: string): RaidConsumableCategory | undefined {
  const normalized = name.trim().toLowerCase();
  // "Create Healthstone" es crear la piedra, no usarla.
  if (normalized.startsWith("create")) {
    return undefined;
  }
  if (normalized.includes("healthstone")) {
    return "healthstone";
  }
  if (
    normalized.includes("health potion") ||
    normalized.includes("healing potion")
  ) {
    return "healthPotion";
  }
  if (normalized.includes("mana potion")) {
    return undefined;
  }
  return normalized.includes("potion") ? "potion" : undefined;
}

function collectConsumableAbilityIds(
  table: WclCastsTable,
): Map<number, RaidConsumableCategory> {
  const categories = new Map<number, RaidConsumableCategory>();
  for (const entry of table.entries ?? []) {
    for (const row of entry.abilities ?? entry.entries ?? entry.sources ?? []) {
      const guid = Number(row?.guid);
      const category = row?.name ? consumableCategory(row.name) : undefined;
      if (Number.isFinite(guid) && guid > 0 && category) {
        categories.set(guid, category);
      }
    }
  }
  return categories;
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

// Consumo y participantes por pull. Los ids de consumible salen de la tabla de
// casts, el uso real de los eventos de cast filtrados, y quiénes estaban en el
// pull de los eventos de CombatantInfo (uno por jugador al arrancar).
async function collectFightExtras(input: {
  actors: Map<number, WclActor>;
  code: string;
  fights: WclAnalysisFight[];
}): Promise<FightExtras[] | undefined> {
  const starts = input.fights.map((fight) => fight.start_time ?? 0);
  const ends = input.fights.map((fight) => fight.end_time ?? 0);
  const start = Math.max(0, Math.min(...starts) - CONSUMABLE_PREPULL_MS);
  const end = Math.max(...ends);

  const table = (await fetchWarcraftLogsV1Json(
    `/report/tables/casts/${encodeURIComponent(input.code)}?${new URLSearchParams(
      { by: "source", end: String(end), start: String(start) },
    ).toString()}`,
  )) as WclCastsTable;
  const abilityCategories = collectConsumableAbilityIds(table);
  if (abilityCategories.size === 0) {
    return undefined;
  }

  const casts = await fetchEventPages<WclRawEvent>(input.code, "casts", {
    end,
    filter: `ability.id IN (${[...abilityCategories.keys()].join(",")})`,
    start,
  });
  const used = input.fights.map(() => new Map<string, Set<RaidConsumableCategory>>());
  for (const event of casts) {
    const ability = typeof event.ability === "object" ? event.ability : undefined;
    const category = abilityCategories.get(Number(ability?.guid));
    const timestamp = event.timestamp;
    if (!category || typeof timestamp !== "number") {
      continue;
    }
    const index = fightIndexAt(input.fights, timestamp);
    const name = index === -1 ? undefined : actorName(event.sourceID, input.actors);
    if (index === -1 || !name) {
      continue;
    }
    const categories = used[index].get(name) ?? new Set();
    categories.add(category);
    used[index].set(name, categories);
  }

  // Si CombatantInfo falla, el pull queda sin participantes y el armado del
  // análisis cae a los que aparecen en la tabla de daño.
  const participants = input.fights.map(() => new Set<string>());
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
        event.sourceID === undefined ? undefined : input.actors.get(event.sourceID);
      if (actor?.type?.toLowerCase() === "pet" && !actor.petOwner) {
        continue;
      }
      const name = actorName(event.sourceID, input.actors);
      if (name) {
        participants[index].add(name);
      }
    }
  } catch {
    // Sin CombatantInfo seguimos con lo que se pudo leer de consumibles.
  }

  return input.fights.map((_, index) => ({
    participants: [...participants[index]].sort((a, b) => a.localeCompare(b)),
    used: used[index],
  }));
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
      const [roles, extras] = await Promise.all([
        fights.length > 0
          ? fetchReportRoles(code, start, end).catch(() => undefined)
          : undefined,
        fights.length > 0
          ? collectFightExtras({ actors, code, fights }).catch(() => undefined)
          : undefined,
      ]);
      return { actors, code, extras, fights, friendlies: report.friendlies ?? [], roles };
    }),
  );
  const jobs = reports.flatMap((report) =>
    report.fights.map((fight, index) => ({
      actors: report.actors,
      code: report.code,
      extras: report.extras?.[index],
      fight,
    })),
  );

  const fightResults = await mapWithConcurrency(
    jobs,
    ANALYSIS_CONCURRENCY,
    analyzeFight,
  );
  const roles = new Map<string, RaidRole>();
  for (const report of reports) {
    for (const [name, role] of report.roles ?? []) {
      roles.set(name, role);
    }
  }
  const roleOf = (name: string): RaidRole | undefined => roles.get(playerKey(name));

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
      healthPotions: number;
      healthstones: number;
      potions: number;
      pulls: number;
    }
  >();
  const consumablePulls: RaidLogConsumables["pulls"] = [];
  let consumablesAvailable = false;
  const encounters: RaidLogAnalysis["encounters"] = [];
  const playerClasses = new Map<string, string>();
  for (const report of reports) {
    for (const actor of report.friendlies) {
      if (actor.petOwner || actor.type?.toLowerCase() === "pet") {
        continue;
      }
      const playerClass = normalizeClass(actor.class ?? actor.type);
      if (actor.name && playerClass) {
        playerClasses.set(actor.name, playerClass);
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
      consumablesAvailable = true;
      // Si CombatantInfo no trajo el pull, los participantes se aproximan con
      // los que figuran en la tabla de daño.
      const participants =
        extras.participants.length > 0
          ? extras.participants
          : result.damage.map((player) => player.name);
      const missing = (
        category: RaidConsumableCategory,
      ): string[] =>
        participants.filter((name) => !extras.used.get(name)?.has(category));
      const usedCount = (category: RaidConsumableCategory): number =>
        participants.filter((name) => extras.used.get(name)?.has(category))
          .length;
      for (const name of participants) {
        const aggregate = consumablePlayers.get(name) ?? {
          healthPotions: 0,
          healthstones: 0,
          potions: 0,
          pulls: 0,
        };
        aggregate.pulls += 1;
        const categories = extras.used.get(name);
        if (categories?.has("potion")) {
          aggregate.potions += 1;
        }
        if (categories?.has("healthstone")) {
          aggregate.healthstones += 1;
        }
        if (categories?.has("healthPotion")) {
          aggregate.healthPotions += 1;
        }
        consumablePlayers.set(name, aggregate);
      }
      consumablePulls.push({
        healthPotionsUsed: usedCount("healthPotion"),
        healthstonesUsed: usedCount("healthstone"),
        missingHealthPotions: missing("healthPotion"),
        missingHealthstones: missing("healthstone"),
        missingPotions: missing("potion"),
        name: result.fight.name ?? "Boss",
        participants: participants.length,
        potionsUsed: usedCount("potion"),
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
    consumables: consumablesAvailable
      ? {
          players: [...consumablePlayers.entries()]
            .map(([name, totals]) => ({
              class: playerDps.get(name)?.className ?? playerClasses.get(name),
              healthPotions: totals.healthPotions,
              healthstones: totals.healthstones,
              name,
              potions: totals.potions,
              pulls: totals.pulls,
              role: roleOf(name),
            }))
            // Primero los que más pulls hicieron sin usar poción.
            .sort(
              (a, b) =>
                b.pulls - b.potions - (a.pulls - a.potions) ||
                a.name.localeCompare(b.name),
            ),
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
  };

  const attendancePlayers = new Map<
    string,
    { class?: string; name: string; pulls: number; role?: RaidRole }
  >();
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
