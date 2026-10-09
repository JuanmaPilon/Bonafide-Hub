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
// vez: a partir de ahí el cruce lo reconoce sin preguntar nada. Además el nombre
// del log pasa a ser el PJ REAL del miembro (el de la inscripción puede estar
// mal escrito o ser otro): se corrige en la memoria de inscripciones y, si se
// sabe de qué evento se trata, en su inscripción de ese evento.
export async function saveRaidLogAlias(input: {
  eventId?: string;
  guildId: string;
  name: string;
  userId: string;
}): Promise<RaidLogAlias & { character: boolean }> {
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

  await prisma.eventPlayerProfile.updateMany({
    data: { character: name },
    where: { guildId: input.guildId, userId: input.userId },
  });

  let character = false;
  if (input.eventId) {
    const updated = await prisma.eventSignup.updateMany({
      data: { character: name },
      where: {
        eventId: input.eventId,
        guildId: input.guildId,
        userId: input.userId,
      },
    });
    character = updated.count > 0;
  }

  return { character, name, userId: input.userId };
}
