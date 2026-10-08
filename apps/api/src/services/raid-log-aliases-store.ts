import { prisma } from "../db/prisma.js";
import { characterKey } from "./name-match.js";

export type RaidLogAlias = {
  name: string;
  userId: string;
};

// PJ de un miembro ya confirmados: la clave normalizada del nombre que figura
// en el log, agrupada por miembro.
export async function listRaidLogAliasesByUser(
  guildId: string,
  userIds: string[],
): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();
  if (userIds.length === 0) {
    return byUser;
  }
  const records = await prisma.eventPlayerCharacter.findMany({
    where: { guildId, userId: { in: userIds } },
    select: { nameKey: true, userId: true },
  });
  for (const record of records) {
    const keys = byUser.get(record.userId) ?? [];
    keys.push(record.nameKey);
    byUser.set(record.userId, keys);
  }
  return byUser;
}

// Guarda que este nombre del log es el PJ de este miembro. Se confirma una sola
// vez: a partir de ahí el cruce lo reconoce sin preguntar nada.
export async function saveRaidLogAlias(input: {
  guildId: string;
  name: string;
  userId: string;
}): Promise<RaidLogAlias> {
  const name = input.name.trim();
  const nameKey = characterKey(name);
  await prisma.eventPlayerCharacter.upsert({
    where: {
      guildId_userId_nameKey: {
        guildId: input.guildId,
        nameKey,
        userId: input.userId,
      },
    },
    create: { guildId: input.guildId, name, nameKey, userId: input.userId },
    update: { name },
  });
  return { name, userId: input.userId };
}
