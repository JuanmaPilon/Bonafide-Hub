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

Config guild: `GET/PATCH /guilds/:guildId/config`

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
7. `POST /internal/guilds/:guildId/reaction-roles/jobs/:jobId/complete`9. `GET /internal/guilds/:guildId/daily-messages` (solo frases habilitadas)
## 5. Auditoría

1. Cada mutación del Hub queda registrada (config, XP, panels).
2. Entradas: guild, actor, acción, detalle, fecha.
3. Solo lectura: no hay rutas de edición/borrado.
4. Lectura: `GET /guilds/:guildId/audit-logs` (solo owner).

## 6. Persistencia Prisma

Schema: `apps/api/prisma/schema.prisma`

Tablas:

1. `guild_configs`
2. `reaction_role_rules`
3. `reaction_role_panels`
4. `reaction_role_panel_jobs`
5. `xp_configs`
6. `xp_profiles`
7. `audit_log_entries`
8. `discord_sessions`
9. `oauth_states`
10. `communications` — plantillas de comunicados
11. `communication_instances` — publicaciones concretas (snapshot)
12. `daily_messages` — frases del loro de Karpindomo
13. `raid_logs` — logs de raid sincronizados con Warcraft Logs

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
