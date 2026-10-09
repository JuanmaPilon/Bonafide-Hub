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

1. `GET /guilds/:guildId/roster` (miembros, fichas, clases secundarias y rangos)
2. `PUT /guilds/:guildId/roster/me` y `PUT /guilds/:guildId/roster/:userId` (ficha: clase, spec, offs, tags y `alts`)
3. `PUT /guilds/:guildId/roster/:userId/rank` (estado: `raid` | `bench` | `null`)
4. `POST /guilds/:guildId/roster/:userId/remove` (quitar del roster: saca los roles de estado y deja la ficha inactiva)
5. `PUT /guilds/:guildId/roster/ranks` (mapeo rango → rol de Discord)
6. `DELETE /guilds/:guildId/roster/:userId` (borra la ficha y sus clases secundarias)

El estado del roster **es** el rol de Discord del miembro: solo el endpoint de
rango mueve roles. Administra `raid` (Activo) y `bench` (Bench); `guild`
(Raid Officer) se mapea aparte y el roster nunca lo toca. Guardar la ficha no toca
los roles. Si Discord rechaza el cambio, la respuesta trae `roleSyncError` con
el motivo y el guardado no se pierde.

**Quién aparece en la lista:** un miembro entra al roster si tiene el rol de
`raid`, el de `bench`, el de Raid Officer **o una ficha activa** — o sea que tener
ficha alcanza para figurar, aunque no tenga ningún rol de estado (la tarjeta sale
como "Inactivo" y se puede cambiar el estado desde ahí). Por eso "quitar del
roster" (`/remove`) hace dos cosas: saca los dos roles de estado en Discord **y**
marca la ficha `active: false`, que es lo que la esconde de la lista. La clase, la
spec y los alters **no se borran**: al volver a ponerle un rol de estado (desde el
mismo menú) la ficha se reactiva sola (`reactivated: true`). Elegir "Inactivo", en
cambio, solo saca los roles y deja la persona a la vista, para saber quién está
afuera. Los dos endpoints tiran la caché de miembros (4 min) después de tocar
roles, así el cambio se ve al instante.

Clases secundarias ("alter"): `alts: [{ className, specName }]` (tope 4) viajan
en el mismo PUT que la ficha y reemplazan la lista completa. Se guardan en
`roster_alt_profiles` con clave (guild, persona, clase) y en la web salen como
cartas apiladas detrás de la principal. **Nunca cuentan como jugador extra**: la
carta principal es siempre `roster_profiles`, así que los totales y los filtros
de rol/estado siguen mirando una sola ficha por persona.

El bench del roster **sí** cuenta en los eventos, pero solo en los del juego del
roster (WoW): el roster esperado de un evento
(`apps/api/src/services/event-roster.ts`) es el rol mínimo del evento MÁS el rol
de Bench mapeado en el roster. En eventos de otros juegos el universo es solo el
rol mínimo, porque ese bench es de WoW. El `N/M` de la tarjeta, el "faltan
anotarse" del detalle y los avisos de Discord miran ese universo. Los del bench
viajan marcados (`bench: true`) para que la web y el informe del bot los muestren
aparte y no se lean como si faltara el core. El aviso del evento menciona los dos
roles, y el control del bot manda el `benchRoleId` ya resuelto por evento.

Registro de mapeos (Admin → Mapeo):

1. `GET /guilds/:guildId/mappings` (catálogo de entidades + lo ya elegido)
2. `PUT /guilds/:guildId/mappings` (guarda los vínculos)

El catálogo de entidades lo define el código (rangos del roster, clases y specs
del catálogo), así que la guild solo elige el rol y/o el emoji de cada una. Se
guardan en la tabla `guild_mappings` con la clave de la entidad (`roster.raid`,
`class.Demon Hunter`, `spec.Mage.Fire`). El roster lee sus rangos de acá; si
todavía no hay nada mapeado, cae al `rosterRanks` viejo de la config.

Las specs tienen su propio grupo ("Specs de clases (WoW)", una fila por clase +
spec del catálogo) para poder cargarles el emoji: la clave `spec.<Clase>.<Spec>`
**manda sobre** el emoji guardado en el catálogo, y eso se aplica al leer
(`listRaidSpecs`), así que el mismo emoji vale para el aviso de Discord, el
roster, el asistente del bot y la web. Un emoji unicode viaja como
`emojiUnicode` y la web lo usa de respaldo (Discord necesita id + nombre).

Logs de raid (Warcraft Logs):

1. `GET/POST /guilds/:guildId/raid-logs`
2. `DELETE /guilds/:guildId/raid-logs/:logId`
3. `GET /guilds/:guildId/raid-logs/:logId/analysis`
4. `POST /guilds/:guildId/raid-logs/aliases`
5. `GET /public/leaderboard` (top 30 público para la landing)

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

El tablero muestra la **progresión** de la guild por dificultad (N / H / M): bosses
distintos matados sobre bosses distintos enfrentados, sobre todos los logs. El
denominador sale del mayor número de bosses vistos en una dificultad (Warcraft
Logs no dice cuántos tiene la banda, y los que todavía no se intentaron no pueden
contar como "vistos"). La etiqueta muestra el nombre de la raid (`zoneName`) solo
cuando **todos** los logs son de la misma; con más de una, la etiqueta mentiría y se
omite. Las listas largas del análisis (DPS, muertes, consumibles, por pull) se
cortan **a la misma altura en las dos columnas** — la de la lista más corta de la
fila, con 320px de techo — y se abren con el triángulo del pie de la lista; el
triángulo aparece solo si hay algo tapado.

**La identidad de un boss es su id de encuentro, no su nombre**: el nombre cambia
con el idioma del cliente que subió el log ("The Coiled Altar" vs "El Altar
Serpenteante"), así que contar por nombre daba un boss de más — el mismo problema
que producía el "10/10" en una raid de 9 bosses. Un **pull** se identifica por boss
+ hora absoluta del fight (`start` en el `summary`, con 15 s de tolerancia): los
pulls que traen dos reports de la misma noche se cuentan una sola vez (en la
tarjeta y en el análisis) y los pulls distintos del mismo boss (un wipe y su kill)
siguen contando los dos. Para mostrar, el análisis usa **un solo nombre por boss**:
el del report más completo de la noche, así el mismo boss no aparece con dos
nombres ("Por boss" y "Por pull" dicen lo mismo que la tarjeta). Los logs
guardados antes de esto no tienen `boss`/`start`
ni `zoneName`: `backfillRaidLogDetails` los refresca una vez al arrancar el API
(fire & forget, como las otras migraciones) y el escaneo manual hace lo mismo, así
las noches viejas también dejan de contar los pulls repetidos.

> La progresión es **una sola**: no se agrupa por zona. El `zone` de Warcraft Logs
> no identifica la raid de forma confiable (la misma raid apareció con dos ids
> distintos, y con logs sin zona, lo que partía la progresión en dos filas que
> parecían dos raids).

Los reports de la **misma fecha** se agrupan en una sola entrada
(`raidLogGroupKey`, con la fecha corrida 6 h para que una raid que cruza la
medianoche no se parta): una subida en dos partes sale como **un** mensaje con los
dos links. La clave es solo la noche, **no el título**: el título lo escribe quien
sube el log, así que dos personas loggeando la misma raid (una con más bosses que
la otra) quedaban como dos entradas y sus fights, kills y pulls contaban dos
veces en el tablero. El nombre de la entrada lo pone el report más completo (el
de más fights), que es el que mejor la nombra. Un report que todavía no se
refrescó (sin fecha) queda solo hasta que el refresh le traiga la fecha. El estado (`status: new | live | synced | failed`)
sale del mismo cálculo de estabilidad; la web solo muestra `live` ("En vivo",
la subida sigue en curso), porque publicar o no es cosa de quien lo maneja: la
acción aparece en la ficha ("Publicar en Discord" / "Actualizar mensaje") según
el estado, pero el estado en sí no se muestra. La web además marca
**"Actualizando…"** cuando la entrada está publicada pero el mensaje quedó viejo
(`needsUpdate`, que calcula el API comparando el texto guardado con el que
generaría ahora).

**Un report se guarda una sola vez** (`reportCode` por guild):

1. El alta manual (`POST`) es idempotente: si el código ya está, devuelve la
   entrada existente con `created: false` y no inserta nada (la web avisa
   "ese report ya estaba cargado" en vez de mostrar un borrador nuevo). Un log
   **oculto** que se vuelve a pegar se restaura: el pedido explícito manda
   sobre el soft-delete.
2. `listRaidLogs` colapsa las filas repetidas que hayan quedado guardadas de
   antes (se queda con la publicada, si no con la de más fights y si no con la
   sincronizada más recientemente), así el análisis y el mensaje publicado no
   ven el mismo report dos veces.
3. El escaneo manual, que ya es una acción de mantenimiento, **oculta** los
   repetidos que encuentra (`hideDuplicateRaidLogs`) y lo informa en el
   resultado (`repeated`) y en el log. No se borran y no se tocan los que ya
   se publicaron, para no dejar el mensaje de Discord huérfano.

Sin esto, dos personas pegando el mismo link dejaban dos filas que caían en la
misma entrada y el análisis bajaba el report una vez por fila: cada pull, muerte
y consumible contaba al doble. En el mismo sentido, cuando dos reports
**distintos** de la misma noche traen los mismos pulls (dos personas loggeando la
misma raid), el análisis los compara por **id de encuentro** + hora absoluta
(`report.start` + `start_time`, con 15 s de tolerancia) y analiza cada pull una
sola vez; los pulls nuevos de cada parte sí se suman, así que una raid partida en
dos sigue contando completa. El report más completo es la **base** del análisis
(el que se analiza primero): define los nombres de los bosses y el detalle de los
pulls repetidos, y lo que se suma de los otros queda informado en `source`
(`extraPulls` / `repeatedPulls`). El nombre del boss no sirve como identidad:
cambia con el idioma del cliente que subió el log.

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
3. `consumables` — poción, prepot, piedra de brujo, poción de vida, flask y
   comida. `categories` lista lo que se pudo medir en la noche (y su
   orden es el que usa la web); `players[].counts` y `pulls[].used/missing`
   usan esas mismas claves, así que una categoría que no se pudo medir no
   aparece y la web no inventa faltantes. Pociones y piedras se identifican por
   NOMBRE en `tables/casts` (sin ids por expansión) y su uso real sale de
   `events/casts` filtrado por esos ids; la **prepot** es la poción usada en los
   30 s previos al pull, contada aparte de las de la pelea. Flask y comida
   salen de las auras de CombatantInfo (activas al empezar el pull): en la v1
   cada aura trae el id, así que cuando no viene el nombre se resuelve con
   `tables/buffs`. **Cada categoría se mide por separado**: una noche con flask
   reconocido y comida sin reconocer muestra flask y no comida, porque listar a
   toda la raid como si no hubiera comido es peor que no informarlo (el log de
   un idioma o un nombre de buff que no matchea se veía exactamente así).
   Los nombres de los consumibles se comparan **sin acentos y por raíz, en
   inglés, español y portugués** ("Healthstone" / "Piedra de brujo" / "Pedra de
   bruxo", "Well Fed" / "Bien alimentado" / "Bem Alimentado" caen en
   `alimentad`): Warcraft Logs devuelve los nombres como los tenía el cliente
   que subió el log, y comparar nombres completos dejaba a todo un report sin
   consumibles. Los nombres que no se reconocen y estaban en casi todos los
   pulls quedan en el log (`auras sin clasificar`), que es la única forma de
   saber con qué nombre viene un consumible nuevo.
   `expected` separa las categorías que corresponden a cada pull (flask, comida,
   pota, prepot) de las de **uso reaccional** (piedra y poción de vida), donde
   no hay un "debería" por pull: la web muestra faltantes de las primeras
   (`pulls[].missing` / `players[].counts`) y **quién las usó** en las segundas
   (`pulls[].usedNames`), con el detalle por pull.
5. `attendance` — cruce entre los que aparecen en el log y los anotados al
   evento de raid más cercano (±14 h, `type: raid`). El evento se elige por
   cercanía y se toman los anotados: "voy" y "tarde" son el compromiso que mide
   `signedPresent` / `signedTotal`, y los que faltaron van a `signedAbsent` (o a
   `unmatchedSignups` si no dejaron PJ escrito). En `unsignedPresent` ("vinieron
   sin anotarse") entran solo los que **no tenían anotación válida**: los que
   dijeron "no voy" (aunque figuren en el evento) y los que no figuran en la
   lista. Estar en bench, anotarse tarde o haber puesto "tentativo" es anotarse,
   así que no aparecen ahí. `partial` avisa cuando no se pudo leer la presencia
   por pull (CombatantInfo) y los participantes salieron de la tabla de daño:
   ahí un "no vino" puede ser un heal que no hizo daño.
6. `source` — de dónde salió el análisis: el report **más completo** de la
   noche es la base (`baseReport` / `basePulls`) y define el nombre de cada boss
   cuando el mismo aparece en los dos reports; `extraPulls` cuenta los pulls que
   solo están en otro report y `repeatedPulls` los que se contaron una vez. No se
   muestra en la web: es para que el análisis y la tarjeta digan lo mismo.

### Análisis de la noche desde el mensaje

El mensaje que se publica a mano ("Publicar en Discord") lleva los links de los
reports de Warcraft Logs y, además, un link al **análisis en el Hub**
(`/?log=<logId>#/raids/logs`): la web lee `log`, selecciona esa noche y abre el
análisis solo. No hay publicación automática: el mensaje de la noche se manda
desde la ficha y se actualiza con "Actualizar mensaje" (ver abajo).

En segundo plano, `startRaidLogSync` (cada 5 min) refresca los reports que siguen
creciendo, así el estado ("En vivo" / terminado) y el aviso de "Actualizar…" no
dependen de que alguien apriete Escanear. No publica nada en Discord.

El emparejamiento por nombre tiene dos pasos:
1. **Exacto**: el nombre normalizado (sin reino, sin acentos, minúsculas) del
   personaje de la inscripción, el recordado en `event_player_profiles` o
   cualquiera de los PJ ya **confirmados** del miembro
   (`event_player_characters`). Un nombre del log se asigna a una sola
   inscripción, así que no se reparte entre dos personas.
2. **Parecido**: si no hubo exacto y el miembro comprometió asistir, se busca el
   nombre del log más parecido por distancia de edición
   (`apps/api/src/services/name-match.ts`). Solo cuenta si el parecido es
   ≥ 0.7, los nombres tienen 4+ letras y el mejor candidato le saca 0.1 al
   segundo: con dos nombres casi iguales de parecido ("Azzai0" y "Azzai1") no se
   elige ninguno, porque atribuirle los pulls a la persona equivocada es peor
   que no atribuirlos.

Los parecidos no se cuentan como asistencia: salen en `likelyPresent`
(`name` de la inscripción, `logName` del log, `pulls`, `similarity`) y la web los
muestra aparte con el % y un botón **Confirmar**, que llama a
`POST /guilds/:g/:raid-logs/aliases` con `{ userId, name, eventId? }`. Eso guarda
el PJ en `event_player_characters` (clave normalizada) y **invalida el cache** de
la noche, así que el mismo caso no se vuelve a preguntar nunca: pasa a ser un
exacto. Los nombres que se parecen pero pertenecen a un bench o a un tentativo no
se atribuyen (no se inventa una identidad que nadie confirmó) y siguen
apareciendo en `unsignedPresent`.

Lo mismo se usa para **linkear a mano** ("Vinieron sin anotarse" ↔ "Anotados que
no aparecieron"): el nombre del log se asocia al miembro elegido y, como el
nombre del log es el PJ real, también se **corrige** el PJ de ese miembro —
`event_player_profiles.character` (memoria: los próximos signups ya lo traen) y,
si viene `eventId`, la inscripción de ese evento (`event_signups.character`), así
el roster de la noche deja de mostrar el nombre mal escrito. La respuesta devuelve
`alias.character` para avisar en pantalla si hubo corrección.

Juegos que se juegan en el server:

1. `GET /guilds/:guildId/games/activity?days=30` — grilla del dashboard.
2. `POST /internal/guilds/:guildId/games/presence` — lote que manda el bot.

Discord no expone los Server Insights por API, así que la agregación la hace el
bot con `PresenceUpdate` (intent `GuildPresences`) y el API guarda una fila por
persona + aplicación + **día** en `member_game_activity`. El endpoint devuelve
`{ days, games: [{ applicationId, days, name, players, coverUrl }], source }`,
ordenado por jugadores distintos: el dashboard muestra los juegos en un carrusel
de portadas y el orden es la señal de qué se juega más. Sobre ese orden el
dashboard marca los **más jugados** (🔥 con la cantidad de jugadores en la
esquina de la portada, más borde y halo cálidos): son los primeros por jugadores
distintos, hasta 3 y con un mínimo de 2 jugadores —con uno solo no hay nada que
distinguir, y `source: "configured"` viene con todo en cero, o sea sin
distintivo—. Los cortes viven en la web (`GAME_HOT_COUNT` /
`GAME_HOT_MIN_PLAYERS`, `apps/web/src/main.tsx`): el API no sabe de presentación.

La agregación agrupa por **nombre normalizado**, no por id de aplicación: Discord
tiene más de un id para el mismo juego (ids viejos y nuevos, una beta aparte) y
agrupando por id el carrusel mostraba la misma tarjeta dos veces (con la misma
portada, porque se resuelve por nombre). Los jugadores y los días de esos ids se
**unen**, y la portada se busca empezando por el id con más actividad, para que un
id viejo sin portada no deje la tarjeta vacía.

La portada (`coverUrl`) es la que Discord muestra en su panel de "Juegos
jugados". No se puede pedir por app: `GET /applications/{id}` está cerrado (401
sin auth, 403 con token de bot). La única vía abierta es
`GET /applications/detectable` — la lista de apps que Discord reconoce, sin auth
— que trae `cover_image_hash` por app y se sirve por el CDN en
`app-icons/{applicationId}/{cover_image_hash}.png`. Es un request de ~13 MB, así
que el API arma un índice en memoria con TTL de 24 h (y lo refresca en segundo
plano cuando vence, para no clavar el request del dashboard). El índice guarda
la portada por id, la portada por nombre/alias (Discord tiene ids viejos y
nuevos del mismo juego, y la presencia puede reportar el viejo) y el icono por
id. La resolución prueba en ese orden: portada por id, portada por nombre —acá
la URL usa el id **canónico** de Discord, porque el CDN arma la ruta con el id—
y, si la app no tiene portada cargada, su icono. Si la app no está en la lista
(CurseForge, editores, launchers), el juego va sin `coverUrl`.

El API descarta las apps que Discord detecta como "está jugando" pero no son
juegos (CurseForge, Steam, OBS, VS Code…): viven en `NON_GAME_APPLICATIONS`
(`apps/api/src/services/games-activity-store.ts`) y se comparan contra el nombre
normalizado, porque esas apps no aparecen en `/applications/detectable`. El
filtro se aplica al mostrar, no al guardar: si sacás un nombre de la lista, su
actividad histórica vuelve a la grilla. La lista también sirve para las entradas
que no se quieren mostrar: Discord tiene ids viejos del mismo juego y la
presencia puede reportar el que no tiene portada ("scp secret laboratory" al
lado del "SCP: Secret Laboratory" bueno), así que la entrada sin portada se
descarta para no dejar dos tarjetas del mismo juego.

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

**Clase de quien no eligió una:** en Discord los botones rápidos de estado no
abren el asistente (sólo Asisto / Bench / Llego tarde), así que quien únicamente
marcó "No asisto" queda sin clase en la inscripción y el aviso lo mostraba con
`❔`. Para que igual salga su emoji, el API agrega `rosterClass` (clase + spec de
`roster_profiles`, y sólo si el juego de la ficha es el del evento) a las
inscripciones que no tienen clase. Es **sólo para mostrar** el renglón: no cambia
la columna del roster, no toca la inscripción guardada y no altera el asistente
del bot (que sigue mirando `wowClass`). El roster se consulta únicamente si hay
alguna inscripción sin clase.

**Aviso en Discord (orden y números):** los datos del evento van de a dos
columnas por fila (Discord empaqueta los fields inline de a tres, así que cada
par se cierra con un field de ancho cero). Primero el **roster** con el cierre al
lado — `👥 Roster 20/24`, donde el número son los que **respondieron** (cualquier
estado, bench incluido, y también "no asisto": haber contestado es lo que saca a
alguien de "faltan anotarse") sobre el roster esperado — después **empieza** y
**duración**, y abajo **asistencia** a lo ancho con los números en el título
(`📊 Asistencia 20 (+3)`, confirmados y posibles). Los conteos salen de
`rosterCoverageFor` ([app.ts]) y el armado de `buildEventAnnouncementEmbeds`
([events-discord-publisher.ts]); el aviso no muestra el total de confirmados
sobre el roster (eso era el viejo `🎯 X/Y del roster`, que contaba sólo a los que
van).

**Duración en horas:** el evento se **carga en horas** (formulario) y se muestra
como el par **Empieza / Termina**, con las horas entre paréntesis
(`🏁 Termina 00:00 (3 hs)`) en la tarjeta del hub y en el aviso de Discord, y en
horas también en el registro de auditoría. El API y la base siguen guardando
**minutos** (`durationMinutes`): es lo que usa Discord para calcular el final y lo
que ya estaba guardado, así que no hay migración. La conversión vive en
`apps/web/src/duration.ts` (cargar) y `apps/api/src/services/duration.ts`
(mostrar); admite decimales para los casos que necesitan minutos (0.25 = 15 min).
Ojo: como la base guarda minutos enteros, 0.21 hs (12.6 min) se guarda como
13 min y al reabrir se ve 0.22.

1. `GET/POST /guilds/:guildId/events`
2. `GET /guilds/:guildId/events/games` -> `{ games: [{ key, label, roles, configured }] }` (juegos disponibles con sus roles; `configured: false` = roles de plantilla)
3. `PATCH/DELETE /guilds/:guildId/events/:eventId`
4. `PUT/DELETE /guilds/:guildId/events/:eventId/signups/me` (propia inscripción)
5. `DELETE /guilds/:guildId/events/:eventId/signups/me/reset` (borra inscripción + personaje recordado)
6. `GET/POST /guilds/:guildId/events/specs` (catálogo; `?game=` filtra por juego)
7. `PATCH/DELETE /guilds/:guildId/events/specs/:specId`
8. `GET /guilds/:guildId/events/templates` (plantillas disponibles; lo ve el staff de eventos: módulo `eventos`)
9. `POST /guilds/:guildId/events/templates/:templateKey/apply` (agrega/actualiza ESE juego en `eventGames` y precarga su catálogo sin borrar nada; esto sí es configuración: módulo `config`)
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
9. `raid_logs` — logs de raid sincronizados con Warcraft Logs (`zone`/`zoneName` son la raid a la que pertenece el report y el `summary` guarda `boss`/`start` por fight para identificar cada pull)
10. `karuta_cards` — posesión de cartas raras (print/wishlist/dueño)
11. `karuta_albums` — álbumes (`ka`) de cada usuario, con puntero al mensaje
12. `karuta_album_pages` — imágenes de páginas cacheadas (bytes propios)
13. `hub_events` — eventos del Módulo X (`game`, `type`, fechas, publicación en Discord, recordatorios, recurrencia propia, `paused`, `characterEnabled`). Con `recurrenceEnabled` el evento es el **molde** de una serie: cada `recurrenceEveryDays` el motor crea una ocurrencia (evento nuevo con el mismo título, publicado `recurrencePublishDaysBefore` días antes). `POST /guilds/:g/events/:id/reset-occurrence` limpia la ocurrencia (avisos + recordatorios en Discord, inscripciones y marcadores) y mueve el molde a la próxima fecha libre de la serie, sin perder la serie.
14. `event_signups` — inscripciones por evento y usuario (`status`, `role`, `wowClass`, `spec`, `character`)
15. `event_player_profiles` — memoria del nombre de personaje por jugador y guild
16. `event_player_characters` — PJ de un miembro ya confirmados en el cruce de asistencia de los logs (clave normalizada del nombre que figura en Warcraft Logs)
17. `raid_specs` — catálogo de clases/specs por guild y JUEGO (`game`, `role`, `className`, `specName`, emoji custom)
18. `event_images` — biblioteca de imágenes del módulo (data URL)
19. `roster_profiles` — ficha principal del roster (clase, spec, offs, tags)
20. `roster_alt_profiles` — clases secundarias ("alter") de una persona: clave (guild, persona, clase). No cuentan para ningún total.

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
