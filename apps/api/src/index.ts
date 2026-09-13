import { buildApp, refreshAllPublishedAnnouncements } from "./app.js";
import { env } from "./config/env.js";
import { migrateLegacyEventRoles } from "./services/event-games-migration.js";

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

  // Re-renderiza los avisos-embed ya publicados (roles, roster y layout al
  // dia). Es fire & forget y nunca notifica: edita los mensajes existentes.
  refreshAllPublishedAnnouncements();
}

void main();
