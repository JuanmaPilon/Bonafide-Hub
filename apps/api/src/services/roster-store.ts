import { prisma } from "../db/prisma.js";

// Ficha del roster de raids: la clase y la spec actual de un miembro más las
// off que domina. `game`/`className`/`specName` son las claves del catálogo
// RaidSpec de la guild (de ahí salen los emojis).
export type RosterProfile = {
  className: string;
  game: string;
  offSpecs: string[];
  specName: string;
  tags: RosterTag[];
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
      label: String(entry.label ?? "").trim().slice(0, 24),
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
    className: record.className,
    game: record.game,
    offSpecs: record.offSpecs,
    specName: record.specName,
    tags: normalizeTags(record.tags),
  };
}
