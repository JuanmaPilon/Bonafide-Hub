import { buildApp, refreshAllPublishedAnnouncements } from "./app.js";
import { env } from "./config/env.js";
import { migrateCommunicationInstances } from "./services/communications-migration.js";
import { migrateLegacyEventRoles } from "./services/event-games-migration.js";
import { backfillRaidLogDetails } from "./services/raid-logs-store.js";

async function main(): Promise<void> {
  const app = buildApp();

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
