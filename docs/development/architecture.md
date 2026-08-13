# Architecture Overview

Este documento resume cómo se conectan bot, API, web y base de datos.

## 1. Componentes

1. `apps/discord-bot`

- Runtime de Discord (discord.js)
- Eventos, comandos slash, XP, voz dinámica, timers
- Ejecuta los jobs de reaction roles encolados por la web

2. `apps/api`

- API HTTP (Fastify)
- OAuth con Discord + sesiones
- Persistencia en PostgreSQL via Prisma
- Endpoint interno para config del bot
- Registro de auditoría de cambios del Hub

3. `apps/web`

- UI de Guild Hub (React + Vite)
- Home (podio + nitro), dashboard, panel admin
- Consume endpoints del API

4. `PostgreSQL`

- Fuente principal de verdad (config, XP, reaction roles, auditoría, sesiones)

## 2. Flujo de alto nivel

```text
Discord Client
   |
   v
Discord Bot
   |\
   | \_ Slash commands / events / timers
   |
   v
API (internal bot endpoint)
   |
   v
PostgreSQL

Web Client --> API --> PostgreSQL
```

## 3. Configuración del bot: remoto + fallback

El bot usa dos modos para guild config:

1. Remoto (preferido)

- `BOT_CONFIG_API_URL`
- `BOT_CONFIG_API_TOKEN`
- Llama:
  - `GET /internal/guilds/:guildId/config`
  - `PUT /internal/guilds/:guildId/config`

2. Fallback local

- Archivo `apps/discord-bot/data/guild-config.json`
- Se usa cuando API no responde o no hay variables remotas

## 4. Patrón de jobs (web -> bot)

Los paneles de reaction roles se administran desde la web:

```text
Web -> POST /guilds/:guildId/reaction-roles/panels
        -> crea job en DB (reaction_role_panel_jobs, status=pending)
Bot (cada ~20s) -> GET /internal/guilds/:guildId/reaction-roles/jobs
        -> ejecuta create/update/delete en Discord
        -> POST /internal/guilds/:guildId/reaction-roles/jobs/:jobId/complete
        -> actualiza reglas + metadata + status (done/failed)
```

El mismo patrón se usa para la sincronización de roles de XP (`xpSyncRequested`).

## 5. Sistema de XP

```text
Mensaje / Voz (Discord)
   |
   v
Bot -> addRemoteXp (API)
   |
   v
xp_profiles (level, xp, contadores)
   |
   v
Bot: asigna roles por nivel + prefijo de nickname + anuncio de rank
   |
   v
Web: leaderboard con colores/neón, niveles configurables en Admin
```

La config vive en `xp_configs` (JSON `levelRoles` y `roleMultipliers`). Cada regla de nivel puede tener `color` para el hub.

## 6. Registro de auditoría

1. Modelo `AuditLogEntry` (tabla `audit_log_entries`).
2. Solo escritura: se crea en cada mutación del Hub (config, XP, panels).
3. Solo el owner puede leerlo (`GET /guilds/:guildId/audit-logs`).
4. No hay rutas de edición/borrado.

## 7. Endpoint interno bot <-> API

Autenticación: header `x-bot-token` validado contra `BOT_API_TOKEN`.

Endpoints:

1. `GET /internal/guilds/:guildId/config`
2. `PUT /internal/guilds/:guildId/config`
3. `GET /internal/guilds/:guildId/xp-config`
4. `POST /internal/guilds/:guildId/xp/add`
5. `POST /internal/guilds/:guildId/xp/level`
6. `GET /internal/guilds/:guildId/xp/profiles`
7. `GET /internal/guilds/:guildId/reaction-roles/jobs`
8. `POST /internal/guilds/:guildId/reaction-roles/jobs/:jobId/complete`

## 8. Persistencia actual

Tablas:

1. `guild_configs` — config por guild (canales, rol de entrada, `xpSyncRequested`, salas temporales)
2. `reaction_role_rules` — reglas por `guildId + messageId + emojiKey`
3. `reaction_role_panels` — metadata de paneles (título, descripción, modo, canal)
4. `reaction_role_panel_jobs` — jobs encolados (create/update/delete)
5. `xp_configs` — config de XP (niveles, multiplicadores, colores)
6. `xp_profiles` — XP/nivel/contadores por usuario
7. `audit_log_entries` — registro de auditoría
8. `discord_sessions` / `oauth_states` — OAuth

## 9. Decisiones operativas

1. Mantener API como capa de persistencia/negocio.
2. Permitir fallback local para resiliencia en planes con sleep.
3. Sincronizar local -> remoto cuando remoto vuelve y está vacío.
4. Log de auditoría: solo escritura, lectura solo para owner.
