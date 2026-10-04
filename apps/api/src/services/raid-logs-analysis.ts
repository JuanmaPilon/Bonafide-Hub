import {
  fetchWarcraftLogsV1Json,
  listRaidLogs,
  type RaidLog,
} from "./raid-logs-store.js";

export type RaidLogAnalysis = {
  averageDps: Array<{
    averageDps: number;
    encounters: number;
    name: string;
    totalDamage: number;
  }>;
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
  totalDeaths: number;
};

type WclAnalysisFight = {
  boss?: number;
  end_time?: number;
  kill?: boolean;
  name?: string;
  start_time?: number;
};

type WclActor = {
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

type WclEventsPage = {
  events?: WclDeathEvent[];
  nextPageTimestamp?: number;
};

type WclDamageEntry = {
  id?: number;
  name?: string;
  total?: number;
};

type WclDamageTable = {
  entries?: WclDamageEntry[];
};

type FightJob = {
  actors: Map<number, WclActor>;
  code: string;
  fight: WclAnalysisFight;
};

type FightResult = {
  deaths: Array<{ ability: string; player: string }>;
  durationSeconds: number;
  fight: WclAnalysisFight;
  damage: Array<{ dps: number; name: string; totalDamage: number }>;
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

async function fetchDeathEvents(
  code: string,
  start: number,
  end: number,
): Promise<WclDeathEvent[]> {
  const events: WclDeathEvent[] = [];
  let cursor = start;

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      end: String(end),
      start: String(cursor),
    });
    const response = (await fetchWarcraftLogsV1Json(
      `/report/events/deaths/${encodeURIComponent(code)}?${query.toString()}`,
    )) as WclEventsPage;
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

function deathAbility(event: WclDeathEvent): string {
  if (typeof event.ability === "string") {
    return event.ability;
  }
  return event.ability?.name ?? event.abilityName ?? "Causa no identificada";
}

function damageName(
  entry: WclDamageEntry,
  actors: Map<number, WclActor>,
): string | undefined {
  const actor = entry.id === undefined ? undefined : actors.get(entry.id);
  if (actor?.type?.toLowerCase() === "pet" && !actor.petOwner) {
    return undefined;
  }
  return (
    (actor?.petOwner ? actors.get(actor.petOwner)?.name : undefined) ??
    actor?.name ??
    entry.name
  );
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
  const damageByPlayer = new Map<string, number>();

  for (const entry of table.entries ?? []) {
    const name = damageName(entry, job.actors);
    const total = Number(entry.total ?? 0);
    if (!name || !Number.isFinite(total) || total <= 0) {
      continue;
    }
    damageByPlayer.set(name, (damageByPlayer.get(name) ?? 0) + total);
  }

  return {
    damage: [...damageByPlayer.entries()].map(([name, totalDamage]) => ({
      dps: totalDamage / durationSeconds,
      name,
      totalDamage,
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
  const reports = await Promise.all(
    parts.map(async (part) => ({
      part,
      report: (await fetchWarcraftLogsV1Json(
        `/report/fights/${encodeURIComponent(part.reportCode)}`,
      )) as WclAnalysisReport,
    })),
  );
  const jobs = reports.flatMap(({ part, report }) => {
    const actors = new Map<number, WclActor>(
      (report.friendlies ?? []).map((actor) => [actor.id, actor]),
    );
    return (report.fights ?? [])
      .filter(
        (fight) =>
          (fight.boss ?? 0) > 0 &&
          typeof fight.start_time === "number" &&
          typeof fight.end_time === "number" &&
          fight.end_time > fight.start_time,
      )
      .map((fight) => ({ actors, code: part.reportCode, fight }));
  });

  const fightResults = await mapWithConcurrency(
    jobs,
    ANALYSIS_CONCURRENCY,
    analyzeFight,
  );
  const playerDeaths = new Map<string, number>();
  const abilityDeaths = new Map<string, number>();
  const playerDps = new Map<
    string,
    { fights: number; totalDamage: number; totalDps: number }
  >();
  const encounters: RaidLogAnalysis["encounters"] = [];
  let totalDeaths = 0;

  for (const result of fightResults) {
    for (const death of result.deaths) {
      totalDeaths += 1;
      playerDeaths.set(death.player, (playerDeaths.get(death.player) ?? 0) + 1);
      abilityDeaths.set(
        death.ability,
        (abilityDeaths.get(death.ability) ?? 0) + 1,
      );
    }

    for (const player of result.damage) {
      const aggregate = playerDps.get(player.name) ?? {
        fights: 0,
        totalDamage: 0,
        totalDps: 0,
      };
      aggregate.fights += 1;
      aggregate.totalDamage += player.totalDamage;
      aggregate.totalDps += player.dps;
      playerDps.set(player.name, aggregate);
    }

    const topDps = [...result.damage].sort((a, b) => b.dps - a.dps)[0];
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

  const analysis: RaidLogAnalysis = {
    averageDps: [...playerDps.entries()]
      .map(([name, totals]) => ({
        averageDps: Math.round(totals.totalDps / totals.fights),
        encounters: totals.fights,
        name,
        totalDamage: Math.round(totals.totalDamage),
      }))
      .sort((a, b) => b.averageDps - a.averageDps),
    deathsByAbility: [...abilityDeaths.entries()]
      .map(([ability, deaths]) => ({ ability, deaths }))
      .sort((a, b) => b.deaths - a.deaths),
    deathsByPlayer: [...playerDeaths.entries()]
      .map(([name, deaths]) => ({ deaths, name }))
      .sort((a, b) => b.deaths - a.deaths),
    encounters,
    generatedAt: new Date().toISOString(),
    totalDeaths,
  };

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
