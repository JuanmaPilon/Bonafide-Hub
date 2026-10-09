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
};

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
  totalPulls: number;
}): Promise<RaidLogAttendance> {
  const players = [...input.players].sort(
    (a, b) => b.pulls - a.pulls || a.name.localeCompare(b.name),
  );
  const result: RaidLogAttendance = {
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

  const userIds = event.signups.map((signup) => signup.userId);
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
  for (const entry of entries) {
    const matchedKey = entry.keys.find((key) => presentByKey.has(key));
    if (!matchedKey) {
      continue;
    }
    exact.add(entry.signup.userId);
    attributed.add(matchedKey);
    statusByKey.set(matchedKey, entry.signup.status);
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

  return result;
}
