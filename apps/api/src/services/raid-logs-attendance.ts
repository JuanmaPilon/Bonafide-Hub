import { prisma } from "../db/prisma.js";

export type PlayerRole = "dps" | "healer" | "tank";

export type RaidLogAttendance = {
  event?: { id: string; startsAt: string; title: string };
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
  signedAbsent: Array<{ name: string; status: string }>;
  signedPresent: number;
  signedTotal: number;
  totalPulls: number;
  unmatchedSignups: Array<{ name: string; status: string }>;
  unsignedPresent: Array<{ name: string; pulls: number; status?: string }>;
};

const EVENT_WINDOW_MS = 14 * 60 * 60 * 1000;
// Solo "voy" y "tarde" son un compromiso de asistir. "Bench" es estar
// disponible por si hace falta y "tentativo" no confirma nada: si vienen, se
// muestran como "vinieron sin confirmar" en vez de sumar asistencia esperada.
const EXPECTED_STATUSES = new Set(["yes", "late"]);

// Los personajes se guardan a veces como "Nombre-Reino"; WCL no trae el reino.
function normalizeName(value: string | null | undefined, stripRealm: boolean) {
  const base = stripRealm ? (value ?? "").split("-")[0] : (value ?? "");
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
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

  const profiles = await prisma.eventPlayerProfile.findMany({
    where: {
      guildId: input.guildId,
      userId: { in: event.signups.map((signup) => signup.userId) },
    },
  });
  const profileCharacter = new Map(
    profiles.map((profile) => [profile.userId, profile.character]),
  );
  const presentByKey = new Map(
    players.map((player) => [normalizeName(player.name, false), player]),
  );
  const statusByKey = new Map<string, string>();

  for (const signup of event.signups) {
    const characters = [
      signup.character,
      profileCharacter.get(signup.userId),
    ].filter((value): value is string => Boolean(value?.trim()));
    const keys = [
      ...characters.map((value) => normalizeName(value, true)),
      normalizeName(signup.username, false),
    ].filter(Boolean);
    const matchedKey = keys.find((key) => presentByKey.has(key));
    if (matchedKey) {
      statusByKey.set(matchedKey, signup.status);
    }
    if (!EXPECTED_STATUSES.has(signup.status)) {
      continue;
    }

    result.signedTotal += 1;
    if (matchedKey) {
      result.signedPresent += 1;
    } else if (characters.length > 0) {
      result.signedAbsent.push({
        name: characters[0].split("-")[0],
        status: signup.status,
      });
    } else {
      result.unmatchedSignups.push({
        name: signup.username,
        status: signup.status,
      });
    }
  }

  for (const [key, player] of presentByKey) {
    const status = statusByKey.get(key);
    if (status && EXPECTED_STATUSES.has(status)) {
      continue;
    }
    result.unsignedPresent.push({
      name: player.name,
      pulls: player.pulls,
      status,
    });
  }
  result.unsignedPresent.sort((a, b) => b.pulls - a.pulls);

  return result;
}
