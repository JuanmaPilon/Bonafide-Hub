# API Guide

Guia de la API de Bonafide.

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
6. `BOT_API_TOKEN` (opcional pero requerido para endpoint interno del bot)
7. `HOST`
8. `PORT`
9. `NODE_ENV`

## 3. Endpoints publicos

Salud y metadata:

1. `GET /health`
2. `GET /`

OAuth Discord:

1. `GET /auth/discord/start`
2. `GET /auth/discord/callback`

Sesion:

1. `GET /me`
2. `GET /guilds`

Config guild:

1. `GET /guilds/:guildId/config`
2. `PATCH /guilds/:guildId/config`

Reminders:

1. `GET /guilds/:guildId/reminders`
2. `POST /guilds/:guildId/reminders`
3. `DELETE /guilds/:guildId/reminders/:reminderId`

## 4. Endpoint interno para bot

1. `GET /internal/guilds/:guildId/config`
2. `PUT /internal/guilds/:guildId/config`

Auth:

1. Header `x-bot-token`
2. Debe coincidir con `BOT_API_TOKEN`

## 5. Persistencia Prisma

Schema: `apps/api/prisma/schema.prisma`

Tablas actuales:

1. `guild_configs`
2. `reaction_role_rules`

Scripts relevantes (`apps/api/package.json`):

1. `npm run db:generate`
2. `npm run db:migrate:dev`
3. `npm run db:migrate:deploy`
4. `npm run build`

## 6. Notas de OAuth

1. `DISCORD_REDIRECT_URI` debe coincidir exactamente con Discord Developer Portal.
2. En produccion usar URL publica HTTPS.
3. Si no coincide exacto, callback falla.
