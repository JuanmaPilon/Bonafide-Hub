import { prisma } from "../db/prisma.js";

// El modelo de comunicados era "plantilla + una instancia por publicación"
// (cada publicación guardaba un snapshot con sus propios mensajes de Discord).
// Ahora un comunicado es UNA fila: el texto y sus mensajes viven juntos.
//
// Esta migración es idempotente y se corre al arrancar el API: por cada
// comunicado que todavía no tiene fecha de publicación, toma su ÚLTIMA
// publicación y la deja como estado actual (contenido, canal, tag y mensajes).
// Las publicaciones viejas quedan en `communication_instances` (tabla legacy)
// como historial, pero ya no se leen ni se escriben.
export async function migrateCommunicationInstances(): Promise<void> {
  const pending = await prisma.communication.findMany({
    where: { publishedAt: null },
    include: { instances: { orderBy: { publishedAt: "desc" }, take: 1 } },
  });

  let migrated = 0;

  for (const record of pending) {
    const lastPublished = record.instances[0];

    if (!lastPublished) {
      // Publicados de antes del refactor a instancias (no tienen ninguna): se
      // les pone una fecha para que el hub los pueda ordenar.
      if (record.status === "published") {
        await prisma.communication.update({
          where: { id: record.id },
          data: { publishedAt: record.updatedAt },
        });
        migrated += 1;
      }
      continue;
    }

    await prisma.communication.update({
      where: { id: record.id },
      data: {
        channelId: lastPublished.channelId || record.channelId,
        content: lastPublished.content,
        discordMessageIds: lastPublished.discordMessageIds,
        publishedAt: lastPublished.publishedAt,
        status: "published",
        tagColor: lastPublished.tagColor ?? record.tagColor,
        tagLabel: lastPublished.tagLabel ?? record.tagLabel,
        title: lastPublished.title,
      },
    });
    migrated += 1;
  }

  if (migrated > 0) {
    console.log(
      `[api] comunicados migrados al modelo de una fila: ${migrated} (la tabla communication_instances queda como historial)`,
    );
  }
}
