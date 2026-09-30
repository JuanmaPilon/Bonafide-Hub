import { prisma } from "../db/prisma.js";

// Ficha del roster de raids: la clase y la spec actual de un miembro más las
// off que domina. `game`/`className`/`specName` son las claves del catálogo
// RaidSpec de la guild (de ahí salen los emojis).
export type RosterProfile = {
  className: string;
  game: string;
  offSpecs: string[];
  specName: string;
};

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
  };
}
