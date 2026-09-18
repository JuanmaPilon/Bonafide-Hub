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

Logs de raid (Warcraft Logs):

1. `GET/POST /guilds/:guildId/raid-logs`
2. `DELETE /guilds/:guildId/raid-logs/:logId`
3. `GET /public/leaderboard` (top 30 público para la landing)

El watcher automático de raids corre en el scheduler de la API cada 5 minutos.
Usa la API v1 de Warcraft Logs con `WARCRAFT_LOGS_API_KEY`, guarda los reports
nuevos en `raid_logs` y consulta sus fights. Los reports se filtran por zona
`Raid` o por título que contenga `raid`.

**El watcher NO publica solo**: crea el **borrador** y el scheduler lo cierra
cuando la entrada terminó. Un report de Warcraft Logs se sube por partes, así
que "terminado" no se puede detectar en el momento; se deduce de que no crezca:

1. Cada 5 min (`syncRaidLogGroups`) se refrescan todas las partes de las
   entradas activas (las creadas en las últimas 48 h y las que quedaron en
   `live`).
2. Una parte está **terminada** cuando su `fightCount`/`kills` no cambió
   durante `FINISHED_STABLE_MS` (30 min). La cuenta arranca en la consulta
   anterior, no en la actual: un log que ya llevaba horas quieto se reconoce
   terminado en la primera comprobación. **Red de seguridad**: si pasaron más
   de `MAX_NIGHT_MS` (6 h) desde el primer fight, la parte se considera
   terminada igual. Sin ese tope, un report viejo que Warcraft Logs sigue
   ajustando cada tanto queda "en vivo" para siempre, porque cada ajuste
   reinicia la cuenta de estabilidad.
3. Cuando **ninguna parte con fights** sigue creciendo y la entrada tiene al
   menos 1 fight, la entrada se **publica sola** (un mensaje por noche, con
   todas las partes y sus links) contra `logsChannelId`.
4. Si el log crece **después** de publicado (o aparece otra parte de la misma
   noche), el mensaje se **edita solo** cuando la entrada vuelve a estar
   terminada. Nunca se publica dos veces la misma noche: una parte nueva se
   engancha al mensaje existente (`discordMessageId`) y el texto se corrige.
   El texto publicado se guarda en `postedMessageText` para comparar y editar
   solo si cambió.

Publicar temprano ya no "corta" el log: cualquier número que falte entra por la
edición automática. Eso es lo que hizo posible volver a automatizar el cierre
después de haberlo pasado a manual.

Rutas manuales (siguen existiendo, para forzarlo sin esperar el ciclo):

1. `POST /guilds/:g/raid-logs/scan` — escaneo manual: busca reports nuevos y
   refresca los borradores (para cuando ya se subió todo).
2. `POST /guilds/:g/raid-logs/:logId/publish` — refresca y publica la entrada
   completa en `logsChannelId`; guarda `discordChannelId`/`discordMessageId`.
3. `POST /guilds/:g/raid-logs/:logId/refresh` — re-escanea y **edita** el
   mensaje publicado si los números cambiaron.

Las tres usan el mismo servicio que el ciclo automático
(`services/raid-logs-publisher.ts`), así que se comportan igual.

Los reports que comparten título (normalizado) y fecha de inicio se agrupan en
una sola entrada (`raidLogGroupKey`, con la fecha corrida 6 h para que una raid
que cruza la medianoche no se parta): una subida en dos partes sale como **un**
mensaje con los dos links. El estado (`status: new | live | synced | failed`)
sale del mismo cálculo de estabilidad y es lo que muestra la web: `live` =
sigue creciendo, `synced` = terminado, `failed` = no se pudo consultar. La web
además marca **"Actualizando…"** cuando la entrada está publicada pero el
mensaje quedó viejo (`needsUpdate`, que calcula el API comparando el texto
guardado con el que generaría ahora).

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
Evento (game: wow)  ->  roles de WoW      + catálogo RaidSpec.game = "wow"
Evento (game: lol)  ->  roles de LoL      + catálogo RaidSpec.game = "lol"
```

Los roles de cada juego salen de `GuildConfig.eventGames`
(`[{ key, label, roles: [{ key, label, emoji | emojiId+emojiName }] }]`). Si la
guild no personalizó ese juego, se usan los roles de su plantilla
(`apps/api/src/services/event-templates.ts`: `wow`, `lol`). El catálogo de
clases/specs es `RaidSpec` con el mismo `game` como discriminador.

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
- `logsWatchGuild` / `logsWatchServer` / `logsWatchRegion` — vigilado de raid de Warcraft Logs (el viejo `logsWatchCharacter` quedó como legacy sin uso).
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
