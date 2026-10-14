import { prisma } from "../db/prisma.js";
import { bestSimilarName, characterKey, nameKey } from "./name-match.js";
import { listRaidLogAliasesByUser } from "./raid-log-aliases-store.js";

export type PlayerRole = "dps" | "healer" | "tank";

export type RaidLogAttendance = {
  event?: { id: string; startsAt: string; title: string };
  // Parecidos que NO se cuentan como asistencia: dos nombres que se parecen
  // mucho pueden ser la misma persona (se anotó con un typo), pero darlo por
  // hecho sería un falso positivo. El staff lo confirma y ahí queda guardado
  // como exacto para los próximos cruces.
  likelyPresent: Array<{
    // Nombre que figura en el log: es el que se guarda al confirmar.
    logName: string;
    // Nombre con el que se anotó.
    name: string;
    pulls: number;
    similarity: number;
    status: string;
    userId: string;
  }>;
  // true cuando no se pudo leer la presencia por pull (CombatantInfo) y los
  // participantes salieron de la tabla de daño: los healers sin daño pueden
  // faltar, así que un "no vino" puede ser un falso negativo.
  partial: boolean;
  players: Array<{
    class?: string;
    name: string;
    pulls: number;
    role?: PlayerRole;
  }>;
  signedAbsent: Array<{ name: string; status: string; userId: string }>;
  signedPresent: number;
  signedTotal: number;
  totalPulls: number;
  unmatchedSignups: Array<{ name: string; status: string; userId: string }>;
  unsignedPresent: Array<{ name: string; pulls: number; status?: string }>;
  // Presencia de CADA inscripción (de cualquier estado, no solo los que
  // comprometieron): es lo que necesita el informe de un evento para decir, uno
  // por uno, quién vino y quién no. `matchable: false` = no hay personaje con el
  // que buscarlo en el log, así que la ausencia no se puede afirmar.
  //
  // Incluye también a los del roster esperado que no respondieron (status
  // "none"): no tienen inscripción, pero si aparece un personaje suyo en el log
  // el informe puede decir que jugaron igual, con la misma fila que el resto.
  byUser: Array<{
    likely?: { logName: string; pulls: number; similarity: number };
    logName?: string;
    matchable: boolean;
    present: boolean;
    pulls: number;
    status: string;
    userId: string;
  }>;
};

// Gente del roster esperado que todavía no respondió: sale del evento (rol
// mínimo y bench), no del log, así que se recibe como dato de entrada.
export type RaidLogRosterEntry = {
  bench?: boolean;
  userId: string;
  username: string;
};

// Estado de los que no declararon nada. No es un estado de inscripción (esos son
// yes/late/bench/tentative/no) y existe para que la fila se lea igual que el
// resto sin inventar una respuesta que nadie dio.
export const UNDECLARED_STATUS = "none";

const EVENT_WINDOW_MS = 14 * 60 * 60 * 1000;
// Solo "voy" y "tarde" son un compromiso de asistir: son los que se cuentan como
// "anotados que vinieron". "Bench" es estar disponible por si hace falta y
// "tentativo" no confirma nada, así que no se les exige asistencia.
const EXPECTED_STATUSES = new Set(["yes", "late"]);
// Para el listado de "vinieron sin anotarse" alcanza con haberse anotado de
// cualquier forma válida: estar en bench o anotarse más tarde es una forma de
// anotarse. Solo los que dijeron "no voy" (y los que no figuran) cuentan como
// que entraron sin estar anotados.
const SIGNED_STATUSES = new Set(["yes", "late", "bench", "tentative"]);

function hasText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

export async function crossRaidAttendance(input: {
  guildId: string;
  nightStart?: Date;
  partialParticipants?: boolean;
  players: RaidLogAttendance["players"];
  roster?: RaidLogRosterEntry[];
  totalPulls: number;
}): Promise<RaidLogAttendance> {
  const players = [...input.players].sort(
    (a, b) => b.pulls - a.pulls || a.name.localeCompare(b.name),
  );
  const result: RaidLogAttendance = {
    byUser: [],
    likelyPresent: [],
    partial: Boolean(input.partialParticipants),
    players,
    signedAbsent: [],
    signedPresent: 0,
    signedTotal: 0,
    totalPulls: input.totalPulls,
    unmatchedSignups: [],
    unsignedPresent: [],
  };
  if (!input.nightStart) {
    return result;
  }

  const nightMs = input.nightStart.getTime();
  const candidates = await prisma.hubEvent.findMany({
    include: { signups: true },
    where: {
      guildId: input.guildId,
      startsAt: {
        gte: new Date(nightMs - EVENT_WINDOW_MS),
        lte: new Date(nightMs + EVENT_WINDOW_MS),
      },
      status: { not: "cancelled" },
      type: "raid",
    },
  });
  // El evento de ESA noche: el más cercano al primer pull dentro de la ventana.
  // La fecha se muestra primero en la web porque el título lo escribe quien crea
  // el evento ("Raid MIERCOLES - JUEVES 08/10/2026") y puede decir cualquier cosa.
  const event = candidates.sort(
    (a, b) =>
      Math.abs(a.startsAt.getTime() - nightMs) -
      Math.abs(b.startsAt.getTime() - nightMs),
  )[0];
  if (!event) {
    return result;
  }
  result.event = {
    id: event.id,
    startsAt: event.startsAt.toISOString(),
    title: event.title,
  };

  const userIds = [
    ...new Set([
      ...event.signups.map((signup) => signup.userId),
      ...(input.roster ?? []).map((member) => member.userId),
    ]),
  ];
  const [profiles, aliases] = await Promise.all([
    prisma.eventPlayerProfile.findMany({
      where: { guildId: input.guildId, userId: { in: userIds } },
    }),
    listRaidLogAliasesByUser(input.guildId, userIds),
  ]);
  const profileCharacter = new Map(
    profiles.map((profile) => [profile.userId, profile.character]),
  );

  const presentByKey = new Map(
    players.map((player) => [nameKey(player.name), player]),
  );
  const statusByKey = new Map<string, string>();
  // Nombres del log ya asignados: un jugador no puede ser la asistencia de dos
  // inscripciones distintas.
  const attributed = new Set<string>();

  // Con qué nombres se puede identificar a cada miembro: el de esta
  // inscripción, el recordado y los PJ que el staff confirmó en otros cruces.
  const entries = event.signups.map((signup) => {
    const characters = [signup.character, profileCharacter.get(signup.userId)]
      .filter(hasText)
      .map((value) => value.trim());
    const keys = [
      ...characters.map(characterKey),
      ...(aliases.get(signup.userId) ?? []),
      nameKey(signup.username),
    ].filter(Boolean);
    return { characters, keys, signup };
  });

  // 1) Exactos: mismo nombre normalizado (o un PJ ya confirmado a mano).
  const exact = new Set<string>();
  // Con qué nombre del log quedó identificado cada uno (para mostrarlo tal cual
  // aparece en Warcraft Logs).
  const matchedByUser = new Map<string, { name: string; pulls: number }>();
  for (const entry of entries) {
    const matchedKey = entry.keys.find((key) => presentByKey.has(key));
    if (!matchedKey) {
      continue;
    }
    const player = presentByKey.get(matchedKey);
    exact.add(entry.signup.userId);
    attributed.add(matchedKey);
    statusByKey.set(matchedKey, entry.signup.status);
    matchedByUser.set(entry.signup.userId, {
      name: player?.name ?? entry.signup.username,
      pulls: player?.pulls ?? 0,
    });
  }

  // 2) Parecidos: solo entre los que comprometieron asistir (los que se
  // cuentan), solo con los que siguen sin dueño y solo si hay un PJ escrito:
  // el nombre de Discord no sirve para esto.
  const likely = new Map<
    string,
    { logName: string; pulls: number; similarity: number }
  >();
  for (const entry of entries) {
    if (
      exact.has(entry.signup.userId) ||
      !EXPECTED_STATUSES.has(entry.signup.status) ||
      entry.characters.length === 0
    ) {
      continue;
    }
    const free = players.filter(
      (player) => !attributed.has(nameKey(player.name)),
    );
    const match = bestSimilarName(entry.characters[0], [
      ...new Set(free.map((player) => player.name)),
    ]);
    if (!match) {
      continue;
    }
    const matchedKey = nameKey(match.name);
    likely.set(entry.signup.userId, {
      logName: match.name,
      pulls: presentByKey.get(matchedKey)?.pulls ?? 0,
      similarity: Math.round(match.ratio * 100) / 100,
    });
    attributed.add(matchedKey);
    statusByKey.set(matchedKey, entry.signup.status);
  }

  for (const entry of entries) {
    const { signup } = entry;
    if (!EXPECTED_STATUSES.has(signup.status)) {
      continue;
    }
    result.signedTotal += 1;
    if (exact.has(signup.userId)) {
      result.signedPresent += 1;
      continue;
    }
    const probable = likely.get(signup.userId);
    if (probable) {
      result.likelyPresent.push({
        logName: probable.logName,
        name: entry.characters[0].split("-")[0],
        pulls: probable.pulls,
        similarity: probable.similarity,
        status: signup.status,
        userId: signup.userId,
      });
      continue;
    }
    if (entry.characters.length > 0) {
      result.signedAbsent.push({
        name: entry.characters[0].split("-")[0],
        status: signup.status,
        userId: signup.userId,
      });
    } else {
      result.unmatchedSignups.push({
        name: signup.username,
        status: signup.status,
        userId: signup.userId,
      });
    }
  }

  // 3) Los del roster esperado que no respondieron: no tienen inscripción, así
  // que la única forma de afirmar que jugaron es un personaje suyo (el recordado
  // de su última inscripción o un PJ ya confirmado en otro cruce). Un nombre
  // parecido no alcanza: sin declaración y con parecido, el aviso no se puede
  // confirmar desde el informe.
  const responded = new Set(
    event.signups.map((signup) => signup.userId),
  );
  const undeclared = (input.roster ?? []).filter(
    (member) => !responded.has(member.userId),
  );
  const undeclaredByUser = new Map<
    string,
    { matchable: boolean; present: boolean; pulls: number }
  >();
  for (const member of undeclared) {
    const keys = [
      profileCharacter.get(member.userId),
      ...(aliases.get(member.userId) ?? []),
    ]
      .filter(hasText)
      .map((value) => characterKey(value.trim()));
    const matchedKey = keys.find(
      (key) => Boolean(key) && presentByKey.has(key) && !attributed.has(key),
    );
    undeclaredByUser.set(member.userId, {
      matchable: keys.length > 0,
      present: Boolean(matchedKey),
      pulls: matchedKey ? (presentByKey.get(matchedKey)?.pulls ?? 0) : 0,
    });
    if (matchedKey) {
      attributed.add(matchedKey);
    }
  }

  for (const [key, player] of presentByKey) {
    const status = statusByKey.get(key);
    if (status && SIGNED_STATUSES.has(status)) {
      continue;
    }
    result.unsignedPresent.push({
      name: player.name,
      pulls: player.pulls,
      status,
    });
  }
  result.unsignedPresent.sort((a, b) => b.pulls - a.pulls);
  result.likelyPresent.sort((a, b) => b.similarity - a.similarity);

  // Presencia de cada inscripción, sin importar el estado: el informe del evento
  // necesita el dato uno por uno (quién se anotó y no vino, quién estaba en
  // bench y jugó igual, quién dijo que no y apareció).
  result.byUser = [
    ...entries.map((entry) => {
      const matched = matchedByUser.get(entry.signup.userId);
      const probable = likely.get(entry.signup.userId);
      return {
        ...(probable ? { likely: probable } : {}),
        ...(matched ? { logName: matched.name } : {}),
        matchable: entry.characters.length > 0,
        present: exact.has(entry.signup.userId),
        pulls: matched?.pulls ?? 0,
        status: entry.signup.status,
        userId: entry.signup.userId,
      };
    }),
    // Y los que no respondieron, con la misma forma: el informe los muestra en
    // una fila igual a las demás.
    ...undeclared.map((member) => {
      const row = undeclaredByUser.get(member.userId);
      return {
        matchable: row?.matchable ?? false,
        present: row?.present ?? false,
        pulls: row?.pulls ?? 0,
        status: UNDECLARED_STATUS,
        userId: member.userId,
      };
    }),
  ];

  return result;
}
