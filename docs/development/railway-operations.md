# Railway Operations

Guia operativa para desplegar y mantener bot, API y DB en Railway.

## 1. Servicios

1. `Discord_BOT`
2. `API`
3. `PRD_DB` (PostgreSQL)

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
7. `HOST`
8. `PORT`
9. `NODE_ENV`

## 3. Comandos recomendados de deploy

### API

1. Pre-deploy: `npx prisma db push`
   - Crea/actualiza las tablas nuevas del schema (ej. `audit_log_entries`, `reaction_role_panels`, `reaction_role_panel_jobs`).
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

## 6. Seguridad operativa

1. No guardar secretos en repo.
2. Rotar secretos cuando se exponen.
3. Mantener tokens por servicio.
4. Preferir private networking entre servicios.
