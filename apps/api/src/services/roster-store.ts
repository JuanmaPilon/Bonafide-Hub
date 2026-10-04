import { prisma } from "../db/prisma.js";

// Ficha del roster de raids: la clase y la spec actual de un miembro más las
// off que domina. `game`/`className`/`specName` son las claves del catálogo
// RaidSpec de la guild (de ahí salen los emojis).
export type RosterProfile = {
  active: boolean;
  className: string;
  game: string;
  offSpecs: string[];
  specName: string;
  tags: RosterTag[];
};

// Clase secundaria de un miembro. No cuenta como jugador extra en ningún
// total: es la carta de atrás de la misma persona.
export type RosterAlt = {
  className: string;
  game: string;
  offSpecs: string[];
  specName: string;
};

export type RosterTag = {
  color: string;
  label: string;
};

function normalizeTags(value: unknown): RosterTag[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is { color?: unknown; label?: unknown } =>
      Boolean(entry && typeof entry === "object"),
    )
    .map((entry) => ({
      color: String(entry.color ?? "#6aa8ff"),
      label: String(entry.label ?? "")
        .trim()
        .slice(0, 24),
    }))
    .filter((entry) => entry.label)
    .slice(0, 8);
}

export async function listRosterProfiles(
  guildId: string,
): Promise<Map<string, RosterProfile>> {
  const records = await prisma.rosterProfile.findMany({ where: { guildId } });
  return new Map(
    records.map((record) => [
      record.userId,
      {
        active: record.active,
        className: record.className,
        game: record.game,
        offSpecs: record.offSpecs,
        specName: record.specName,
        tags: normalizeTags(record.tags),
      },
    ]),
  );
}

export async function upsertRosterProfile(
  guildId: string,
  userId: string,
  input: RosterProfile,
): Promise<RosterProfile> {
  const record = await prisma.rosterProfile.upsert({
    create: { guildId, userId, ...input },
    update: input,
    where: { guildId_userId: { guildId, userId } },
  });
  return {
    active: record.active,
    className: record.className,
    game: record.game,
    offSpecs: record.offSpecs,
    specName: record.specName,
    tags: normalizeTags(record.tags),
  };
}

export async function deleteRosterProfile(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await prisma.rosterProfile.deleteMany({
    where: { guildId, userId },
  });
  return result.count > 0;
}

// Alters agrupados por persona: el roster pide todos los de la guild de una.
export async function listRosterAlts(
  guildId: string,
): Promise<Map<string, RosterAlt[]>> {
  const records = await prisma.rosterAltProfile.findMany({
    orderBy: [{ className: "asc" }],
    where: { guildId },
  });
  const byUser = new Map<string, RosterAlt[]>();
  for (const record of records) {
    const entry: RosterAlt = {
      className: record.className,
      game: record.game,
      offSpecs: record.offSpecs,
      specName: record.specName,
    };
    byUser.set(record.userId, [...(byUser.get(record.userId) ?? []), entry]);
  }
  return byUser;
}

// La lista que manda la web es la verdad: se borra lo que ya no está y se
// actualiza el resto en una transacción (si falla, no queda media lista).
export async function replaceRosterAlts(
  guildId: string,
  userId: string,
  alts: RosterAlt[],
): Promise<RosterAlt[]> {
  const kept = alts.map((alt) => alt.className);
  await prisma.$transaction([
    prisma.rosterAltProfile.deleteMany({
      where: { className: { notIn: kept }, guildId, userId },
    }),
    ...alts.map((alt) =>
      prisma.rosterAltProfile.upsert({
        create: { guildId, userId, ...alt },
        update: alt,
        where: {
          guildId_userId_className: {
            className: alt.className,
            guildId,
            userId,
          },
        },
      }),
    ),
  ]);
  return alts;
}

export async function deleteRosterAlts(
  guildId: string,
  userId: string,
): Promise<void> {
  await prisma.rosterAltProfile.deleteMany({ where: { guildId, userId } });
}
