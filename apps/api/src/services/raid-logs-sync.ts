import { prisma } from "../db/prisma.js";
import { listRaidLogs, refreshRaidLog } from "./raid-logs-store.js";

// Los reports en curso se refrescan solos: sin esto, el estado ("en vivo" /
// terminado) y el "Actualizar log" solo avanzan si alguien aprieta Escanear.
// No publica nada: el mensaje de la noche se manda a mano desde la web.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_STALE_MS = 5 * 60 * 1000;
// Tope de refrescos por pasada: cada uno baja un report completo de Warcraft
// Logs (varios MB), así que una pasada no puede encadenar una raid entera.
const MAX_REFRESHES_PER_PASS = 4;

// Un log se refresca solo mientras la noche está EN CURSO. Un report ya
// terminado (`synced`) no cambia por sí solo: bajarlo cada 5 minutos era el
// gasto de egress más grande que tenía el proyecto (cada consulta descarga el
// report completo). Los terminados se actualizan a mano con "Actualizar log".
function isInProgress(status: string): boolean {
  return status === "new" || status === "live";
}

export async function syncActiveRaidLogs(): Promise<number> {
  const now = Date.now();
  const guilds = await prisma.raidLog.findMany({
    select: { guildId: true },
    where: { hidden: false },
  });
  let refreshed = 0;
  for (const guildId of [...new Set(guilds.map((row) => row.guildId))]) {
    if (refreshed >= MAX_REFRESHES_PER_PASS) {
      break;
    }
    const logs = await listRaidLogs(guildId);
    for (const log of logs) {
      if (refreshed >= MAX_REFRESHES_PER_PASS) {
        break;
      }
      // Los publicados se actualizan a mano ("Actualizar log"); los que
      // fallaron quedan para el escaneo manual.
      if (log.status === "failed" || !isInProgress(log.status)) {
        continue;
      }
      const stale =
        !log.lastSyncedAt || now - log.lastSyncedAt.getTime() >= SYNC_STALE_MS;
      if (!stale) {
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
