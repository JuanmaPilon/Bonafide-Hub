# API Guide

Guía de la API de Bonafide.

## 1. Stack

1. Fastify
2. TypeScript
3. Prisma
4. PostgreSQL

## 2. Variables de entorno

Archivo ejemplo: `apps/api/.env.example`

1. `DISCORD_CLIENT_ID`
2. `DISCORD_CLIENT_SECRET`
3. `DISCORD_REDIRECT_URI`
4. `SESSION_SECRET`
5. `DATABASE_URL`
6. `BOT_API_TOKEN` (para el endpoint interno del bot)
7. `DISCORD_BOT_TOKEN` (para consultar datos del servidor: preview, emojis, miembros, boosters, y publicar en Discord)
8. `BONAFIDE_GUILD_ID` (exclusividad: solo funciona para este servidor)
9. `WARCRAFT_LOGS_API_KEY` (API v1 gratuita para el vigilado de perfil de raid logs)
10. `CORS_ORIGINS`
11. `COOKIE_SAME_SITE`
12. `FRONTEND_APP_URL`
13. `HOST`
14. `PORT`
15. `NODE_ENV`

## 3. Endpoints públicos

Salud y metadata: `GET /health`, `GET /`

OAuth Discord: `GET /auth/discord/start`, `GET /auth/discord/callback`

Sesión: `GET /me`, `GET /guilds`, `POST /auth/logout`

Widget del servidor: `GET /guilds/:guildId/widget` (conectados, totales, boosts)

Canales / roles / miembros de Discord:

1. `GET /guilds/:guildId/channels`
2. `GET /guilds/:guildId/roles`
3. `GET /guilds/:guildId/members`
4. `GET /guilds/:guildId/members/:userId`

Config guild: `GET/PATCH /guilds/:guildId/config`

Permisos de staff (acceso del Admin del hub): `GET /guilds/:guildId/admin-access` → `{ owner, modules }` (qué módulos del Admin puede ver el usuario según su rol de Discord; el owner siempre tiene todo)

Sugerencias del hub: `POST /guilds/:guildId/suggestions` → la API la envía por DM al staff configurado (`suggestionsDmUserId` y/o `suggestionsDmTiers`)

Comunicados:

1. `GET/POST /guilds/:guildId/communications` (plantillas)
2. `PATCH/DELETE /guilds/:guildId/communications/:communicationId`
3. `POST /guilds/:guildId/communications/:communicationId/publish`
4. `DELETE /guilds/:guildId/communications/instances/:instanceId`
5. `GET /guilds/:guildId/communications/published` (instancias para el hub)

Mensajes diarios (loro de Karpindomo):

1. `GET/POST /guilds/:guildId/daily-messages`
2. `PATCH/DELETE /guilds/:guildId/daily-messages/:messageId`

Logs de raid (Warcraft Logs):

1. `GET/POST /guilds/:guildId/raid-logs`
2. `DELETE /guilds/:guildId/raid-logs/:logId`
3. `GET /public/leaderboard` (top 30 público para la landing)

El watcher automático de raids corre en el scheduler de la API cada 5 minutos.
Usa la API v1 de Warcraft Logs con `WARCRAFT_LOGS_API_KEY`, guarda los reports
nuevos en `raid_logs`, consulta sus fights y los publica en `logsChannelId` con
`DISCORD_BOT_TOKEN`. Los reports se filtran por zona `Raid` o por título que
contenga `raid`.

XP:

1. `GET /guilds/:guildId/xp-config`
2. `PATCH /guilds/:guildId/xp-config`
3. `GET /guilds/:guildId/xp/leaderboard`
4. `GET /guilds/:guildId/xp/export`
5. `POST /guilds/:guildId/xp/import`
6. `POST /guilds/:guildId/xp/reset-all`
7. `POST /guilds/:guildId/xp/sync`

Reaction roles (jobs que ejecuta el bot):

1. `GET /guilds/:guildId/reaction-roles/panels`
2. `POST /guilds/:guildId/reaction-roles/panels`
3. `PATCH /guilds/:guildId/reaction-roles/panels/:messageId`
4. `DELETE /guilds/:guildId/reaction-roles/panels/:messageId`
5. `GET /guilds/:guildId/reaction-roles/jobs`
6. `DELETE /guilds/:guildId/reaction-roles/jobs/:jobId`

Emojis del servidor: `GET /guilds/:guildId/emojis`

Boosters de Nitro: `GET /guilds/:guildId/boosters`

Auditoría (solo owner, readonly): `GET /guilds/:guildId/audit-logs`

Reminders (legacy): `GET/POST /guilds/:guildId/reminders`, `DELETE /guilds/:guildId/reminders/:reminderId`

## 4. Endpoint interno para bot

Auth: header `x-bot-token` == `BOT_API_TOKEN`.

1. `GET/PUT /internal/guilds/:guildId/config`
2. `GET /internal/guilds/:guildId/xp-config`
3. `POST /internal/guilds/:guildId/xp/add`
4. `POST /internal/guilds/:guildId/xp/level`
5. `GET /internal/guilds/:guildId/xp/profiles`
6. `GET /internal/guilds/:guildId/reaction-roles/jobs`
7. `POST /internal/guilds/:guildId/reaction-roles/jobs/:jobId/complete`
8. `GET /internal/guilds/:guildId/daily-messages` (solo frases habilitadas)

> **Merge selectivo en el PUT de config**: el bot no conoce todos los campos que administra el hub (módulos, sugerencias, permisos de staff, logs de raid). El PUT interno **solo fusiona los campos propios del bot** (`reactionRoles`, `temporaryVoiceChannelIds`, canales del loro, `defaultRoleId`, `musicRoleIds`, etc.) sobre la config actual. Los campos del hub se preservan y el bot nunca los resetea.

## 5. Auditoría

1. Cada mutación del Hub queda registrada (config, XP, panels).
2. Entradas: guild, actor, acción, detalle, fecha.
3. Solo lectura: no hay rutas de edición/borrado.
4. Lectura: `GET /guilds/:guildId/audit-logs` (solo owner).

## 6. Persistencia Prisma

Schema: `apps/api/prisma/schema.prisma`

Tablas:

1. `guild_configs` — config por guild (canales, rol de entrada, módulos, sugerencias, XP sync, salas temporales, loro, logs)
2. `admin_role_modules` — permisos de staff por rol de Discord (módulos del Admin que ve cada rol)
3. `reaction_role_rules` — reglas por `guildId + messageId + emojiKey`
4. `reaction_role_panels` — metadata de paneles (título, descripción, modo, canal)
5. `reaction_role_panel_jobs` — jobs encolados (create/update/delete)
6. `xp_configs` — config de XP (niveles, multiplicadores, colores)
7. `xp_profiles` — XP/nivel/contadores por usuario
8. `audit_log_entries` — registro de auditoría
9. `discord_sessions` / `oauth_states` — OAuth
10. `communications` / `communication_instances` — comunicados y sus publicaciones
11. `daily_messages` — frases del loro de Karpindomo
12. `raid_logs` — logs de raid sincronizados con Warcraft Logs

Campos relevantes de `guild_configs`:

- `enabledModules` — módulos visibles del hub (vacío = todos visibles). Lo escribe solo el owner.
- `suggestionsDmUserId` / `suggestionsDmTiers` — destinatarios de sugerencias por DM.
- `logsWatchGuild` / `logsWatchServer` / `logsWatchRegion` — vigilado de raid de Warcraft Logs (el viejo `logsWatchCharacter` quedó como legacy sin uso).

Scripts (`apps/api/package.json`):

1. `npm run db:generate`
2. `npm run db:migrate:dev`
3. `npm run db:migrate:deploy`
4. `npx prisma db push --skip-generate` (sincronizar schema sin migraciones)
5. `npm run build`

## 7. Notas de OAuth

1. `DISCORD_REDIRECT_URI` debe coincidir exactamente con Discord Developer Portal.
2. En producción usar URL pública HTTPS.
3. Si no coincide exacto, callback falla.
