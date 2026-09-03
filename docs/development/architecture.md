# Architecture Overview

Este documento resume cómo se conectan bot, API, web y base de datos.

## 1. Componentes

1. `apps/discord-bot`

- Runtime de Discord (discord.js)
- Eventos, comandos slash, XP, voz dinámica, timers
- Ejecuta los jobs de reaction roles encolados por la web
- Scheduler del loro: publica frases aleatorias a intervalos aleatorios

2. `apps/api`

- API HTTP (Fastify)
- OAuth con Discord + sesiones
- Persistencia en PostgreSQL via Prisma
- Endpoint interno para config del bot
- Registro de auditoría de cambios del Hub
- Comunicados: publica en Discord vía REST + los muestra en el hub
- Logs de raid: sincroniza con Warcraft Logs y publica en Discord/web

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

> **Merge selectivo (importante):** el bot desconoce los campos del hub
> (`enabledModules`, `suggestionsDmUserId/Tiers`, `adminRoleModules`,
> `logsWatch*`, `logsChannelId`). El `PUT /internal/.../config` **fusiona** los
> campos del bot sobre la config actual y preserva los del hub; el bot nunca
> los resetea.

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
9. `GET /internal/guilds/:guildId/daily-messages` (frases habilitadas del loro)

## 8. Persistencia actual

Tablas:

1. `guild_configs` — config por guild (canales, rol de entrada, `enabledModules`, `suggestionsDm*`, `xpSyncRequested`, salas temporales, loro, logs)
2. `admin_role_modules` — permisos de staff: qué módulos del Admin ve cada rol de Discord
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

## 9. Decisiones operativas

1. Mantener API como capa de persistencia/negocio.
2. Permitir fallback local para resiliencia en planes con sleep.
3. Sincronizar local -> remoto cuando remoto vuelve y está vacío.
4. Log de auditoría: solo escritura, lectura solo para owner.

## 10. Flujo de comunicados (web -> Discord)

```text
Web (Admin → Comunicados) -> API guarda la plantilla
   -> Publicar -> API crea una instancia (snapshot) y publica en Discord vía REST
   -> El hub muestra las instancias publicadas (tab Comunicados)
```

## 11. Flujo del loro de Karpindomo (mensajes diarios)

```text
Admin (web) configura canal/intervalo/frases -> API guarda en DB
Bot (cada ~2 min) -> lee config + frases habilitadas -> programa un timer aleatorio
   -> publica opener aleatorio + frase aleatoria en el canal
```

## 12. Flujo de Logs de Raid (Warcraft Logs)

```text
Admin pega un link (o activa el vigilado de perfil) -> API guarda un RaidLog
   -> API consulta Warcraft Logs (endpoint público o API v1 con key)
   -> guarda resumen (fights/kills) y publica en el canal configurado de Discord
Scheduler (cada 5 min) -> observa reports sin publicar / perfiles vigilados
   -> solo RAID (zone tipo Raid + título contiene "raid") -> publica cuando hay fights
Web -> tab Raids muestra los logs (acordeón colapsable)
```

## 13. Módulos del hub y permisos de staff

El panel Admin no es un único bloque: se compone de tarjetas por funcionalidad y
cada una exige acceso a un módulo. El acceso se decide así:

```text
Web -> GET /guilds/:guildId/admin-access -> { owner, modules }
        - owner (dueño del server) => acceso total
        - resto => se leen sus roles de Discord y sus reglas en admin_role_modules
                  -> se obtiene la lista de módulos permitidos
```

1. `enabledModules` (guild_configs) decide qué tabs se muestran en la web.
   Vacío/ausente = todos visibles. Solo el owner lo edita.
2. `admin_role_modules` asocia roles de Discord a módulos del Admin
   (config, comunicados, raids, daily, reaction, xp).
3. La UI agrupa el staff en tiers para mostrar quién tiene qué:
   owner (naranja) > admin (dorado) > officer (verde).
4. Los guardados parciales de configuración y los del bot no modifican
   `admin_role_modules`. Esa relación solo se reemplaza cuando el owner guarda
   explícitamente la tarjeta de permisos de staff.

## 14. Sugerencias del hub (web -> DM)

```text
Web (tab Sugerencias) -> POST /guilds/:guildId/suggestions
   -> API resuelve destinatarios:
        suggestionsDmUserId (persona) + suggestionsDmTiers (rangos owner/admin/officer)
        (si no hay ninguno, cae al dueño del server)
   -> envía el DM por Discord
```

## 15. Tema claro/oscuro y widget de Karpindomo

1. Tema: la web aplica `data-theme="light"` en `<html>` y persiste la elección en
   `localStorage` (`bonafide-theme`). El tema claro redefine variables CSS y las
   superficies oscuras hardcodeadas se adaptan con overrides bajo
   `:root[data-theme="light"]`.
2. Karpindomo (web): FAB de chat flotante con burbuja de frases del asistente;
   aparece solo tras login. Usa clases tipo "widget" para no ser bloqueado por
   adblockers.
