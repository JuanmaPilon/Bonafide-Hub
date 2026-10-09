import { prisma } from "../db/prisma.js";
import { listRaidLogs, refreshRaidLog } from "./raid-logs-store.js";

// Los reports en curso se refrescan solos: sin esto, el estado ("en vivo" /
// terminado) y el "Actualizar mensaje" solo avanzan si alguien aprieta Escanear.
// No publica nada: el mensaje de la noche se manda a mano desde la web.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_STALE_MS = 5 * 60 * 1000;

export async function syncActiveRaidLogs(): Promise<number> {
  const now = Date.now();
  const guilds = await prisma.raidLog.findMany({
    select: { guildId: true },
    where: { hidden: false },
  });
  let refreshed = 0;
  for (const guildId of [...new Set(guilds.map((row) => row.guildId))]) {
    const logs = await listRaidLogs(guildId);
    for (const log of logs) {
      const stale =
        !log.lastSyncedAt || now - log.lastSyncedAt.getTime() >= SYNC_STALE_MS;
      // Los publicados se actualizan a mano ("Actualizar mensaje"); los que
      // fallaron quedan para el escaneo manual.
      if (log.status === "failed" || !stale) {
        continue;
      }
      await refreshRaidLog(log.id);
      refreshed += 1;
    }
  }
  return refreshed;
}

export function startRaidLogSync(): void {
  const run = (): void => {
    void syncActiveRaidLogs().catch((error) => {
      console.error(
        "[raid-logs] sync de logs falló:",
        error instanceof Error ? error.message : error,
      );
    });
  };
  setInterval(run, SYNC_INTERVAL_MS);
  run();
}
