import { prisma } from "../db/prisma.js";
import { refreshRaidLog } from "./raid-logs-store.js";

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
const IN_PROGRESS_STATUSES = ["new", "live"];

export async function syncActiveRaidLogs(): Promise<number> {
  const now = Date.now();
  // Sólo los reports EN CURSO, y sólo las columnas que se usan: pedir la lista
  // completa traía todas las noches guardadas (con el resumen de pulls y el
  // texto publicado de cada una) cada 5 minutos para usar una o dos filas.
  const active = await prisma.raidLog.findMany({
    // Mismo orden de preferencia que el dedupe de la lista: si un report quedó
    // guardado dos veces, se refresca la fila que la lista termina mostrando.
    orderBy: [
      { discordPosted: "desc" },
      { fightCount: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      fightCount: true,
      id: true,
      lastSyncedAt: true,
      reportCode: true,
    },
    where: { hidden: false, status: { in: IN_PROGRESS_STATUSES } },
  });

  const seen = new Set<string>();
  let refreshed = 0;
  for (const log of active) {
    if (refreshed >= MAX_REFRESHES_PER_PASS) {
      break;
    }
    if (seen.has(log.reportCode)) {
      continue;
    }
    seen.add(log.reportCode);
    const stale =
      !log.lastSyncedAt || now - log.lastSyncedAt.getTime() >= SYNC_STALE_MS;
    if (!stale) {
      continue;
    }
    await refreshRaidLog(log.id);
    refreshed += 1;
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
