# Bonafide Platform

Plataforma privada para una comunidad de Discord, construida como monorepo con tres piezas principales:

1. Discord bot (operación dentro de Discord)
2. API backend (OAuth, configuración y persistencia)
3. Web hub (panel para gestión de guild + home de la comunidad)

## Estado actual

### Discord bot (`apps/discord-bot`)

1. Eventos de entrada/salida de miembros (logs configurables por guild)
2. Canales de voz dinámicos (salas temporales)
3. Sistema de XP: XP por mensaje y por tiempo en voz, niveles, cooldown anti-spam
4. Roles por nivel (con colores para el hub), prefijos de nickname, roles extra
5. Anuncios de nivel (rank up) y sincronización de roles por nivel
6. Rol de entrada automático al unirse
7. Timers (`/settimer`) con aviso por DM + gestión (`/listtimers`, `/canceltimer`, `/removetimer`)
8. Música (`/play`, `/pause`, `/resume`, `/skip`, `/queue`, `/nowplaying`, `/volume`, `/stop`, `/leave`) con player de botones
9. Estadísticas de miembros/roles (`/memberstats`, `/rolstats`)
10. Comandos de gestión de XP (`/addlvl`, `/removelvl`, `/setlvl`, `/resetlvl`)
11. Ejecutor de paneles de reaction roles creados desde la web (job polling ~20s)
12. Loro de Karpindomo: publica frases aleatorias a intervalos aleatorios

### API (`apps/api`)

1. OAuth Discord + sesiones en PostgreSQL
2. Configuración por guild
3. Config de XP (niveles, roles, multiplicadores, colores)
4. Leaderboard enriquecido (avatar, nombre, `isBooster`)
5. Paneles de reaction roles (jobs encolados que ejecuta el bot)
6. **Registro de auditoría** de cambios del Hub (solo lectura, visible para el owner)
7. Widget del servidor (conectados, totales, boosts de Nitro)
8. Boosters de Nitro (lista de quienes boostean)
9. Comunicados: plantillas + publicación en Discord y en el hub (opción solo web)
10. Mensajes diarios del loro de Karpindomo (CRUD + config)
11. Logs de raid con Warcraft Logs: links manuales + vigilado de perfil (solo raids)
12. Leaderboard público (`/public/leaderboard`) para la landing

### Web hub (`apps/web`)

1. Home de bienvenida con podio top 5, carrusel de boosters y login centrado
2. Dashboard con stats del servidor, leaderboard, neón por rango y badge de booster
3. Tab Comunicados (publicados desde el admin)
4. Tab Raids con card colapsable de Logs de Raid (sincronizados con Warcraft Logs)
5. Panel Admin: configuración general, comunicados, reaction roles, mensajes diarios (loro), logs de raid, sistema de XP y registro de auditoría
6. Navegación por hash (`/#/home`, `/#/dashboard`, `/#/admin`, ...)

## Estructura del repo

```text
apps/
  api/          Fastify + Prisma + OAuth Discord
  discord-bot/  discord.js + comandos slash + eventos
  web/          React/Vite (Guild Hub)

docs/
  development/  Documentación técnica y operativa
```

## Arquitectura resumida

```text
Discord Users
    |
    v
Discord Bot (apps/discord-bot)
    |
    |  internal bot config API (x-bot-token)
    v
API (apps/api) ------------------> PostgreSQL (Railway)
    |
    | OAuth + JSON API
    v
Web (apps/web)
```

Notas importantes:

1. El bot intenta usar configuración remota en API/DB.
2. Si la API no responde, usa fallback local en `apps/discord-bot/data/guild-config.json`.
3. Los paneles de reaction roles se crean desde la web: la API encola un job y el bot lo publica/actualiza/borra en Discord (polling ~20s).
4. El registro de auditoría es de solo escritura; solo el owner puede leerlo desde el panel Admin.

## Quick start local

### Bot

```bash
cd apps/discord-bot
npm install
copy .env.example .env
npm run register   # registra los slash commands en la guild
npm run dev
```

### API

```bash
cd apps/api
npm install
copy .env.example .env
npm run dev
```

### Web

```bash
cd apps/web
npm install
copy .env.example .env
npm run dev
```

## Build commands

```bash
cd apps/discord-bot && npm run build
cd apps/api && npm run build
cd apps/web && npm run build
```

## Base de datos

- Schema: `apps/api/prisma/schema.prisma`
- Tablas: `guild_configs`, `reaction_role_rules`, `reaction_role_panels`, `reaction_role_panel_jobs`, `xp_configs`, `xp_profiles`, `audit_log_entries`, `discord_sessions`, `oauth_states`, `communications`, `communication_instances`, `daily_messages`, `raid_logs`
- Al agregar tablas al schema: `cd apps/api && npx prisma db push --skip-generate` (pre-deploy en Railway)

## Documentación técnica

1. `docs/development/architecture.md`
2. `docs/development/discord-bot.md`
3. `docs/development/api.md`
4. `docs/development/railway-operations.md`

## Consideraciones de seguridad

1. Nunca commitear `.env` con secretos.
2. Mantener secretos en Railway Variables.
3. Rotar tokens/credentials cuando se exponen.
4. Mantener permisos del bot con principio de mínimo privilegio cuando sea posible.
5. El registro de auditoría es de solo lectura (no hay endpoints de edición/borrado).

## Consideraciones operativas

1. Si cambias comandos slash, volver a correr `npm run register`.
2. Si el bot no puede llegar a API, entra en fallback local automáticamente.
3. En Railway, confirmar variables por servicio y por environment antes de redeploy.
4. Si agregás tablas Prisma, correr `npx prisma db push` antes del deploy de la API.
