# Railway Operations

## 1. Servicios

1. `Discord_BOT`
2. `API`
3. `PRD_DB` (PostgreSQL)
4. `Web` (frontend estático de Vite; URL pública de la comunidad)

Dominio propio: `bonafide-cum.com` (web y callback de OAuth). El `vite.config.ts`
de la web incluye `allowedHosts` para `bonafide-cum.com` y sus subdominios.

## 2. Variables por servicio

### Bot

1. `DISCORD_BOT_TOKEN`
2. `DISCORD_APPLICATION_ID`
3. `DISCORD_GUILD_ID`
4. `BOT_CONFIG_API_URL`
5. `BOT_CONFIG_API_TOKEN`
6. `BOT_DISABLED`

### API

1. `DATABASE_URL`
2. `DISCORD_CLIENT_ID`
3. `DISCORD_CLIENT_SECRET`
4. `DISCORD_REDIRECT_URI`
5. `SESSION_SECRET`
6. `BOT_API_TOKEN`
7. `DISCORD_BOT_TOKEN`
8. `BONAFIDE_GUILD_ID`
9. `WARCRAFT_LOGS_API_KEY`
10. `CORS_ORIGINS`
11. `COOKIE_SAME_SITE`
12. `FRONTEND_APP_URL`
13. `HOST`
14. `PORT`
15. `NODE_ENV`

## 3. Comandos recomendados de deploy

> **Orden de deploy:** primero API (corre `prisma db push` y crea las tablas nuevas), luego Web y Bot.
> ⚠️ Cada servicio tiene sus propias Variables; el token del bot debe estar en el **Bot** y en el **API** por separado (y actualizarse en ambos si se rota).

### API

1. Pre-deploy: `npx prisma db push --accept-data-loss`
   - Crea/actualiza las tablas nuevas del schema (ej. `audit_log_entries`, `admin_role_modules`, `communications`, `daily_messages`, `raid_logs`, `karuta_album_pages`).
   - ⚠️ **Usar `--accept-data-loss`**: cuando el schema quita columnas/tablas (p. ej. al eliminar un módulo, como se hizo con `karuta_drops` y `karuta_debug_events`), un `prisma db push` pelado **falla** y el deploy de la API no avanza. Con el flag, borra solo lo que ya no está en `schema.prisma`.
2. Build: `npm ci --include=dev && npm run build`
3. Start: `npm run start`

### Bot

1. Build: `npm ci && npm run build`
2. Start: `npm run start`

Opcional:

1. Pre-deploy bot: `npm run register`

- solo si quieres registrar slash en cada deploy

## 4. API dormida y fallback del bot

Si la API duerme:

1. El bot intenta remoto.
2. Si remoto falla, usa fallback local.
3. Mantiene funcionalidades criticas (ej. voice dinamico).

## 5. Diagnostico rapido

### Error de variables Required

1. Revisar variables en servicio correcto.
2. Revisar environment correcto (Production vs Preview).
3. Guardar cambios y redeploy.

### Error DATABASE_URL missing (Prisma)

1. Verificar `DATABASE_URL` en servicio API.
2. Verificar referencia a DB.
3. Redeploy.

### Bot no mueve usuarios / no elimina salas

1. Verificar permisos de Discord (Move Members, Manage Channels).
2. Verificar jerarquia de rol.
3. Revisar logs del bot para fallback remoto/local.

### Los permisos Admin/Officer desaparecen después de un deploy

Los permisos se guardan en PostgreSQL, en `admin_role_modules`; un redeploy
normal no debería borrarlos. La API usa `prisma db push` para sincronizar el
schema, no para recrear la base de datos.

El bot y las demás tarjetas de configuración usan guardados parciales: no
tocan `admin_role_modules`. Solo la tarjeta **Permisos de staff**, guardada por
el owner, reemplaza esas reglas. Si desaparecen tras un deploy, revisar que el
servicio API siga apuntando a la misma `DATABASE_URL` y que no se haya creado
una base de datos nueva o cambiado de environment en Railway.

### Escaneo manual de Warcraft Logs falla

El escaneo se inicia desde **Raids → Logs**; no hay polling automático en la
API ni en la Web. Revisar los logs de Railway de `API` al solicitar un escaneo:

1. Confirmar que la guild y el realm configurados coinciden con Warcraft Logs.
2. `WARCRAFT_LOGS_API_KEY` ausente o inválida puede provocar una respuesta 401;
   403 indica falta de permisos o una key no autorizada.
3. El log `[raid-logs] scan manual` aparece cuando el escaneo termina y resume
   reports detectados y borradores refrescados.
4. Publicar y actualizar son acciones aparte. Si falla la publicación, revisar
   `logsChannelId` y que el bot pueda ver el canal, enviar mensajes y leer historial.

Variables necesarias en el servicio `API` (environment correcto):

- `WARCRAFT_LOGS_API_KEY`
- `DISCORD_BOT_TOKEN`

La Web consulta la lista al entrar a Raids o abrir el popup. Para detectar
reports nuevos o actualizar borradores, se debe solicitar un escaneo manual.

## 6. Seguridad operativa

1. No guardar secretos en repo.
2. Rotar secretos cuando se exponen.
3. Mantener tokens por servicio.
4. Preferir private networking entre servicios.
