# Railway Operations

Guia operativa para desplegar y mantener bot, API y DB en Railway.

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

1. `DATABASE_URL` (referencia a DB)
2. `DISCORD_CLIENT_ID`
3. `DISCORD_CLIENT_SECRET`
4. `DISCORD_REDIRECT_URI`
5. `SESSION_SECRET`
6. `BOT_API_TOKEN`
7. `DISCORD_BOT_TOKEN` (resolver datos del server + publicar comunicados/logs en Discord)
8. `BONAFIDE_GUILD_ID`
9. `WARCRAFT_LOGS_API_KEY` (vigilado de perfil de raid logs)
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

1. Pre-deploy: `npx prisma db push`
   - Crea/actualiza las tablas nuevas del schema (ej. `audit_log_entries`, `reaction_role_panels`, `reaction_role_panel_jobs`, `admin_role_modules`, `communications`, `daily_messages`, `raid_logs`).
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

### Watcher de Warcraft Logs no detecta o publica raids

El watcher corre dentro del proceso **API**, no dentro de la Web. Ejecuta una
comprobación inmediata al arrancar y luego cada 5 minutos.

Revisar en los logs de Railway de `API`:

1. `[raid-logs] scheduler iniciado` debe indicar `API key configurada` y
   `token Discord configurado`.
2. `[raid-logs] watch: N guild/s` confirma que la config tiene gremio y servidor.
3. `watch ...: X report/s, Y nuevo/s` confirma que Warcraft Logs devolvió
   reports. Los reports que no sean raid se cuentan como `fuera de zona raid`.
4. `Warcraft Logs v1 respondió 401` indica key ausente, inválida o revocada.
   `403` indica falta de permisos o key no autorizada.
5. Si detecta un report pero no publica, revisar `no hay logsChannelId` o el
   mensaje de Discord. `logsChannelId` debe ser un canal de texto y el bot debe
   poder ver el canal, enviar mensajes y leer historial.

Variables necesarias en el servicio `API` (environment correcto):

- `WARCRAFT_LOGS_API_KEY`: API key válida de Warcraft Logs.
- `DISCORD_BOT_TOKEN`: token del bot que publica el resumen.

La Web refresca la lista de logs cada 60 segundos mientras la pestaña `Raids`
está abierta. La API sigue siendo la fuente de verdad; un redeploy de Web no
soluciona un watcher detenido, por lo que hay que revisar primero los logs de
API y sus variables.

## 6. Seguridad operativa

1. No guardar secretos en repo.
2. Rotar secretos cuando se exponen.
3. Mantener tokens por servicio.
4. Preferir private networking entre servicios.
