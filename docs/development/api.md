# API Guide

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

Sugerencias del hub: `POST /guilds/:guildId/suggestions` → la API la envía por DM a los rangos configurados en `suggestionsDmTiers` (`owner`, `admin` y/o `officer`). Si no hay rangos seleccionados, se usa el owner.

Comunicados:

1. `GET/POST /guilds/:guildId/communications` (plantillas)
2. `PATCH/DELETE /guilds/:guildId/communications/:communicationId`
3. `POST /guilds/:guildId/communications/:communicationId/publish`
4. `DELETE /guilds/:guildId/communications/instances/:instanceId`
5. `GET /guilds/:guildId/communications/published` (instancias para el hub)

Mensajes diarios (loro de Karpindomo):

1. `GET/POST /guilds/:guildId/daily-messages`
2. `PATCH/DELETE /guilds/:guildId/daily-messages/:messageId`

Roster de raids:

1. `GET /guilds/:guildId/roster` (miembros, fichas y rangos)
2. `PUT /guilds/:guildId/roster/me` y `PUT /guilds/:guildId/roster/:userId` (ficha: clase, spec, offs, tags)
3. `PUT /guilds/:guildId/roster/:userId/rank` (estado: `raid` | `trial` | `null`)
4. `PUT /guilds/:guildId/roster/ranks` (mapeo rango → rol de Discord)
5. `DELETE /guilds/:guildId/roster/:userId` (borra la ficha)

El estado del roster **es** el rol de Discord del miembro: solo el endpoint de
rango mueve roles. Administra `raid` (Activo) y `trial` (Prueba); `guild`
(Raid Officer) se mapea aparte y el roster nunca lo toca. Guardar la ficha no toca
los roles. Si Discord rechaza el cambio, la respuesta trae `roleSyncError` con
el motivo y el guardado no se pierde.

Registro de mapeos (Admin → Mapeo):

1. `GET /guilds/:guildId/mappings` (catálogo de entidades + lo ya elegido)
2. `PUT /guilds/:guildId/mappings` (guarda los vínculos)

El catálogo de entidades lo define el código (rangos del roster, clases del
catálogo), así que la guild solo elige el rol y/o el emoji de cada una. Se
guardan en la tabla `guild_mappings` con la clave de la entidad (`roster.raid`,
`class.Demon Hunter`). El roster lee sus rangos de acá; si todavía no hay nada
mapeado, cae al `rosterRanks` viejo de la config.

Logs de raid (Warcraft Logs):

1. `GET/POST /guilds/:guildId/raid-logs`
2. `DELETE /guilds/:guildId/raid-logs/:logId`
3. `GET /guilds/:guildId/raid-logs/:logId/analysis`
4. `GET /public/leaderboard` (top 30 público para la landing)

La API consulta Warcraft Logs v1 con `WARCRAFT_LOGS_API_KEY`. No hay un
watcher periódico: los reports nuevos y sus fights se consultan al solicitar
un escaneo manual. Los reports se filtran por zona `Raid` o por título que
contenga `raid`.

El flujo mantiene los reports como borradores hasta que alguien decide
publicarlos. Así, el escaneo puede repetirse mientras Warcraft Logs termina de
subir partes del report sin publicar datos incompletos. Las acciones manuales
son:

1. `POST /guilds/:g/raid-logs/scan` — escaneo manual: busca reports nuevos y
   refresca los reports nuevos y todos los borradores de la guild. No publica.
2. `POST /guilds/:g/raid-logs/:logId/publish` — refresca y publica la entrada
   completa en `logsChannelId`; guarda `discordChannelId`/`discordMessageId`.
3. `POST /guilds/:g/raid-logs/:logId/refresh` — re-escanea y **edita** el
   mensaje publicado si los números cambiaron.

El escaneo se inicia desde Raids → Logs. Publicar, actualizar, ocultar o
restaurar una entrada también requiere una acción explícita.

Los reports que comparten título (normalizado) y fecha de inicio se agrupan en
una sola entrada (`raidLogGroupKey`, con la fecha corrida 6 h para que una raid
que cruza la medianoche no se parta): una subida en dos partes sale como **un**
mensaje con los dos links. El estado (`status: new | live | synced | failed`)
sale del mismo cálculo de estabilidad y es lo que muestra la web: `live` =
sigue creciendo, `synced` = terminado, `failed` = no se pudo consultar. La web
además marca **"Actualizando…"** cuando la entrada está publicada pero el
mensaje quedó viejo (`needsUpdate`, que calcula el API comparando el texto
guardado con el que generaría ahora).

Análisis de una noche de raids: `GET /guilds/:guildId/raid-logs/:logId/analysis`.
Se calcula a pedido (la web lo pide al abrir "Ver análisis"), se cachea 10
minutos por entrada y se apoya en tres consultas a la API v1 de Warcraft Logs:
`tables/summary` (roles), `tables/casts` + `events/casts` (consumibles) y
`events` con `filter=type in ('combatantinfo')` (quién estaba en cada pull).

Devuelve:

1. `averageDps` — DPS promedio por jugador con `role` (`dps | healer | tank`).
   La web usa el rol para dejar healers y tanks fuera de la tabla de DPS y del
   "top DPS" por pull. Si WCL no devuelve roles, se muestran todos.
2. `deathsByPlayer` / `deathsByAbility` / `encounters` — muertes y detalle por
   pull (todos los roles cuentan acá).
3. `consumables` — poción, prepot, piedra de brujo, poción de vida, flask,
   comida y runa. `categories` lista lo que se pudo medir en la noche (y su
   orden es el que usa la web); `players[].counts` y `pulls[].used/missing`
   usan esas mismas claves, así que una categoría que no se pudo medir no
   aparece y la web no inventa faltantes. Pociones y piedras se identifican por
   NOMBRE en `tables/casts` (sin ids por expansión) y su uso real sale de
   `events/casts` filtrado por esos ids; la **prepot** es la poción usada en los
   30 s previos al pull, contada aparte de las de la pelea. Flask, comida y runa
   salen de las auras de CombatantInfo (activas al empezar el pull): en la v1
   cada aura trae el id, así que cuando no viene el nombre se resuelve con
   `tables/buffs`.
4. `attendance` — cruce entre los que aparecen en el log y los anotados al
   evento de raid más cercano (±14 h, `type: raid`). Cuenta "voy" y "tarde"
   como compromiso; bench y tentativo, si vienen, caen en `unsignedPresent`.
   `partial` avisa cuando no se pudo leer la presencia por pull (CombatantInfo)
   y los participantes salieron de la tabla de daño: ahí un "no vino" puede ser
   un heal que no hizo daño.

Juegos que se juegan en el server:

1. `GET /guilds/:guildId/games/activity?days=30` — grilla del dashboard.
2. `POST /internal/guilds/:guildId/games/presence` — lote que manda el bot.

Discord no expone los Server Insights por API, así que la agregación la hace el
bot con `PresenceUpdate` (intent `GuildPresences`) y el API guarda una fila por
persona + aplicación + **día** en `member_game_activity`. El endpoint devuelve
`{ days, games: [{ applicationId, days, name, players, coverUrl }], source }`,
ordenado por jugadores distintos (la web solo muestra el nombre; el orden es la
señal de qué se juega más). `source: "configured"` significa que todavía no hay
actividad registrada y se están mostrando los juegos configurados del módulo de
eventos.

La portada (`coverUrl`) sale de `GET /applications/{applicationId}`
(`cover_image`, la que Discord usa en su panel de "Juegos jugados") y se sirve
por el CDN de Discord en `app-icons/{applicationId}/{cover_image}.png`. No es
dato de la guild: se cachea por aplicación 12 h (y 10 min los fallos) y, si la
aplicación no tiene portada, el juego va sin `coverUrl`.

XP:

1. `GET /guilds/:guildId/xp-config`
2. `PATCH /guilds/:guildId/xp-config`
3. `GET /guilds/:guildId/xp/leaderboard`
4. `GET /guilds/:guildId/xp/export`
5. `POST /guilds/:guildId/xp/import`
6. `POST /guilds/:guildId/xp/reset-all`
7. `POST /guilds/:guildId/xp/sync`

Emojis del servidor: `GET /guilds/:guildId/emojis`

Boosters de Nitro: `GET /guilds/:guildId/boosters`

Auditoría (solo owner, readonly): `GET /guilds/:guildId/audit-logs`

Reminders (legacy): `GET/POST /guilds/:guildId/reminders`, `DELETE /guilds/:guildId/reminders/:reminderId`

### Módulo de eventos ("Módulo X")

Eventos con inscripciones estilo Raid Helper. Un evento puede publicarse como
Scheduled Event de Discord y/o como aviso-embed en un canal (el bot maneja los
botones de inscripción).

**Juegos por evento (importante):** el módulo sirve para varios juegos a la vez.
Cada evento elige un JUEGO y de ahí salen sus roles de inscripción y su catálogo:

```text
Evento (game: wow)  ->  roles de WoW      + catálogo de WoW
Evento (game: lol)  ->  roles de LoL      + catálogo de LoL
```

Los roles de cada juego salen de la **plantilla del código**
(`apps/api/src/services/event-templates.ts`: `wow`, `lol`, `encuesta`); la guild
no los personaliza, así el mismo tipo se ve igual en todos lados. El catálogo de
clases/specs también sale de ahí (`listTemplateSpecs`) y se completa con las
filas de `RaidSpec` que no estén en la plantilla, para no perder clases/specs
que la guild haya cargado a mano.

> **Nombre en la UI:** esto se muestra como **"Tipo de evento"** (en el evento y
> en el Admin), porque no todos los tipos son juegos. Internamente (columna,
> endpoints y payloads) la clave sigue siendo `game`.
> La web NO aplica plantillas: elige el tipo y edita sus roles + su catálogo a
> mano. `POST /events/templates/:key/apply` queda disponible en el API (precarga
> roles y catálogo de un juego) por si se quiere usar más adelante.

1. `GET/POST /guilds/:guildId/events`
2. `GET /guilds/:guildId/events/games` -> `{ games: [{ key, label, roles, configured }] }` (juegos disponibles con sus roles; `configured: false` = roles de plantilla)
3. `PATCH/DELETE /guilds/:guildId/events/:eventId`
4. `PUT/DELETE /guilds/:guildId/events/:eventId/signups/me` (propia inscripción)
5. `DELETE /guilds/:guildId/events/:eventId/signups/me/reset` (borra inscripción + personaje recordado)
6. `GET/POST /guilds/:guildId/events/specs` (catálogo; `?game=` filtra por juego)
7. `PATCH/DELETE /guilds/:guildId/events/specs/:specId`
8. `GET /guilds/:guildId/events/templates` (plantillas disponibles)
9. `POST /guilds/:guildId/events/templates/:templateKey/apply` (agrega/actualiza ESE juego en `eventGames` y precarga su catálogo sin borrar nada)
10. `GET/POST/DELETE /guilds/:guildId/events/images` (biblioteca de imágenes)
11. `GET /public/guilds/:guildId/events/:eventId/image` (imagen pública para el embed de Discord)

## 4. Endpoint interno para bot

Auth: header `x-bot-token` == `BOT_API_TOKEN`.

1. `GET/PUT /internal/guilds/:guildId/config`
2. `GET /internal/guilds/:guildId/xp-config`
3. `POST /internal/guilds/:guildId/xp/add`
4. `POST /internal/guilds/:guildId/xp/level`
5. `GET /internal/guilds/:guildId/xp/profiles`
6. `GET /internal/guilds/:guildId/daily-messages` (solo frases habilitadas)
7. `POST /internal/guilds/:guildId/karuta/grabs` (transferencia de posesión de una carta rara)
8. `POST /internal/guilds/:guildId/karuta/cards` / `.../cards/burn` / `.../transfers` / `.../albums`
9. `GET /internal/guilds/:guildId/events/specs?game=<juego>` (roles del juego + catálogo: alimenta el asistente de inscripción del bot)
10. `GET /internal/guilds/:guildId/events/:eventId` (evento con sus inscripciones: el bot decide si abre el asistente o aplica el estado directo). Con `?userId=` agrega `event.playerCharacter` (el personaje recordado de ese jugador)
11. `PUT /internal/guilds/:guildId/events/:eventId/signups` / `DELETE .../signups` / `DELETE .../signups/reset`
12. `GET /internal/guilds/:guildId/events/control` (recordatorios e informes pendientes)
13. `POST /internal/guilds/:guildId/events/:eventId/reminders-sent` / `.../report-sent`

> **Merge selectivo en el PUT de config**: el bot no conoce todos los campos que administra el hub (módulos, sugerencias, permisos de staff, logs de raid). El PUT interno **solo fusiona los campos propios del bot** (`temporaryVoiceChannelIds`, canales del loro, `defaultRoleId`, `musicRoleIds`, etc.) sobre la config actual. Los campos del hub se preservan y el bot nunca los resetea.

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
3. `xp_configs` — config de XP (niveles, multiplicadores, colores)
4. `xp_profiles` — XP/nivel/contadores por usuario
5. `audit_log_entries` — registro de auditoría
6. `discord_sessions` / `oauth_states` — OAuth
7. `communications` / `communication_instances` — comunicados y sus publicaciones
8. `daily_messages` — frases del loro de Karpindomo
9. `raid_logs` — logs de raid sincronizados con Warcraft Logs
10. `karuta_cards` — posesión de cartas raras (print/wishlist/dueño)
11. `karuta_albums` — álbumes (`ka`) de cada usuario, con puntero al mensaje
12. `karuta_album_pages` — imágenes de páginas cacheadas (bytes propios)
13. `hub_events` — eventos del Módulo X (`game`, `type`, fechas, publicación en Discord, recordatorios, recurrencia propia, `paused`, `characterEnabled`). Con `recurrenceEnabled` el evento es el **molde** de una serie: cada `recurrenceEveryDays` el motor crea una ocurrencia (evento nuevo con el mismo título, publicado `recurrencePublishDaysBefore` días antes). `POST /guilds/:g/events/:id/reset-occurrence` limpia la ocurrencia (avisos + recordatorios en Discord, inscripciones y marcadores) y mueve el molde a la próxima fecha libre de la serie, sin perder la serie.
14. `event_signups` — inscripciones por evento y usuario (`status`, `role`, `wowClass`, `spec`, `character`)
15. `event_player_profiles` — memoria del nombre de personaje por jugador y guild
16. `raid_specs` — catálogo de clases/specs por guild y JUEGO (`game`, `role`, `className`, `specName`, emoji custom)
17. `event_images` — biblioteca de imágenes del módulo (data URL)

Campos relevantes de `guild_configs`:

- `enabledModules` — módulos visibles del hub (vacío = todos visibles). Lo escribe solo el owner.
- `suggestionsDmTiers` — rangos que reciben sugerencias por DM. El antiguo `suggestionsDmUserId` queda como columna legacy y ya no se usa.
- `logsWatchGuild` / `logsWatchServer` / `logsWatchRegion` — origen consultado al escanear Warcraft Logs manualmente (`logsWatchCharacter` y `logsWatchEnabled` quedan como legacy sin uso).
- `eventGames` — juegos del módulo de eventos con sus roles (`[{ key, label, roles }]`). Un juego sin entrada acá usa los roles de su plantilla.
- `eventRoles` — **legacy**: era la lista única de roles de la guild. Al pasar a "juego por evento" se migra a `eventGames` al arrancar el API (`apps/api/src/services/event-games-migration.ts`) y ya no se lee.

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
