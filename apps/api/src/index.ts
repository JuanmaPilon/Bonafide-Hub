import { buildApp, refreshAllPublishedAnnouncements } from "./app.js";
import { env } from "./config/env.js";
import { migrateCommunicationInstances } from "./services/communications-migration.js";
import { migrateLegacyEventRoles } from "./services/event-games-migration.js";
import { backfillRaidLogDetails } from "./services/raid-logs-store.js";

// Muestra de memoria cada 5 minutos. Sirve para distinguir un leak de una marca
// de agua: `rss` es lo que Railway cobra y no baja nunca (V8 no devuelve lo
// liberado), `heapUsed` es lo que el GC puede soltar. Si `heapUsed` crece sin
// tráfico hay leak; si baja y `rss` queda alto, es sólo el máximo histórico.
const MEMORY_SAMPLE_MS = 5 * 60 * 1000;

function logMemorySample(app: Awaited<ReturnType<typeof buildApp>>): void {
  setInterval(() => {
    const usage = process.memoryUsage();
    app.log.info(
      {
        heapTotalMb: Math.round(usage.heapTotal / 1e6),
        heapUsedMb: Math.round(usage.heapUsed / 1e6),
        externalMb: Math.round(usage.external / 1e6),
        rssMb: Math.round(usage.rss / 1e6),
      },
      "[mem] uso de memoria",
    );
  }, MEMORY_SAMPLE_MS).unref();
}

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }

  // Migración de datos de una sola vez (roles globales → roles por juego).
  // Va después de escuchar para no demorar el arranque y no romper el health
  // check; si falla, el API sigue funcionando con los roles de las plantillas.
  void migrateLegacyEventRoles().catch((error: unknown) => {
    app.log.warn({ err: error }, "No se pudieron migrar los roles por juego");
  });

  // Migración de datos de una sola vez (plantilla + instancias → una fila por
  // comunicado). También fire & forget, por el mismo motivo.
  void migrateCommunicationInstances().catch((error: unknown) => {
    app.log.warn(
      { err: error },
      "No se pudieron migrar las publicaciones de comunicados",
    );
  });

  // Re-renderiza los avisos-embed ya publicados (roles, roster y layout al
  // dia). Es fire & forget y nunca notifica: edita los mensajes existentes.
  refreshAllPublishedAnnouncements();

  logMemorySample(app);

  // Los logs guardados antes de que la tarjeta supiera identificar un pull
  // (boss + hora) no tienen esos datos: se refrescan una vez, en segundo plano,
  // así las noches viejas también dejan de contar los pulls repetidos.
  void backfillRaidLogDetails()
    .then((refreshed) => {
      if (refreshed > 0) {
        app.log.info(
          `[raid-logs] ${refreshed} log/s refrescado/s para completar boss/hora de los pulls`,
        );
      }
    })
    .catch((error: unknown) => {
      app.log.warn({ err: error }, "No se pudieron completar los logs de raid");
    });
}

void main();
