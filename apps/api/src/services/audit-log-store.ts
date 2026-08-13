import { prisma } from "../db/prisma.js";

export type AuditLogEntry = {
  action: string;
  actorName: string | null;
  actorUserId: string | null;
  createdAt: string;
  details: string | null;
  guildId: string;
  id: string;
  targetId: string | null;
  targetType: string | null;
};

/**
 * Registra una acción administrativa en el Hub (auditoría).
 * Es de solo escritura: nadie puede editar ni borrar estas entradas.
 */
export async function createAuditLogEntry(input: {
  action: string;
  actorName?: string;
  actorUserId?: string;
  details?: string;
  guildId: string;
  targetId?: string;
  targetType?: string;
}): Promise<void> {
  await prisma.auditLogEntry.create({
    data: {
      action: input.action,
      actorName: input.actorName,
      actorUserId: input.actorUserId,
      details: input.details,
      guildId: input.guildId,
      targetId: input.targetId,
      targetType: input.targetType,
    },
  });
}

export async function listAuditLogEntries(
  guildId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const records = await prisma.auditLogEntry.findMany({
    where: { guildId },
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(100, Math.max(1, limit)),
  });

  return records.map((record) => ({
    action: record.action,
    actorName: record.actorName,
    actorUserId: record.actorUserId,
    createdAt: record.createdAt.toISOString(),
    details: record.details,
    guildId: record.guildId,
    id: record.id,
    targetId: record.targetId,
    targetType: record.targetType,
  }));
}
