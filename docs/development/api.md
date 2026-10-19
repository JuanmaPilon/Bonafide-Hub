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
3. `POST /guilds/:guildId/roster/members` (sumar al roster a alguien del servidor que todavía no tiene ficha: la crea **vacía**)
4. `PUT /guilds/:guildId/roster/:userId/rank` (estado: `raid` | `bench` | `null`)
5. `POST /guilds/:guildId/roster/:userId/remove` (salir del roster: saca los roles de estado y deja la ficha inactiva)
6. `PUT /guilds/:guildId/roster/ranks` (mapeo rango → rol de Discord)
7. `DELETE /guilds/:guildId/roster/:userId` (borra la ficha y sus clases secundarias)

El estado del roster **es** el rol de Discord del miembro: solo el endpoint de
rango mueve roles. Administra `raid` (Activo) y `bench` (Bench); `guild`
(Raid Officer) se mapea aparte y el roster nunca lo toca. Guardar la ficha no toca
los roles. Si Discord rechaza el cambio, la respuesta trae `roleSyncError` con
el motivo y el guardado no se pierde.

**Estados de la tarjeta** (los mismos cuatro del filtro y del menú de la web, en
ese orden):

1. **Activo** — tiene el rol `raid` (`PUT .../rank` con `raid`).
2. **Bench** — tiene el rol `bench` (`PUT .../rank` con `bench`).
3. **Inactivo** — la ficha está `active: false`: se salió del roster
   (`POST .../remove`). En el menú no se ofrece si ya está inactivo.
4. **Sin asignar** — tiene ficha y ningún rol de estado: sigue en el roster, pero
   todavía no se lo asignaron a Raid ni a Bench (`PUT .../rank` con `null`, que
   solo saca los roles y no toca la ficha).

El color de cada estado sale de su clave (`raid`, `bench`, `inactive`,
`unassigned`) en el filtro, en el badge de la tarjeta y en el menú, así no se
pueden desincronizar: verde, ámbar, rojo y gris.

**Quién aparece en la lista:** un miembro entra al roster si tiene el rol de
`raid`, el de `bench`, el de Raid Officer **o una ficha** (`active: true` o
`false`). Por eso "Inactivo" (`/remove`) hace dos cosas: saca los dos roles de
estado en Discord **y** marca la ficha `active: false`, que es lo que la muestra
como "Inactivo". La clase, la spec y los alters **no se borran**: al volver a
ponerle un rol de estado (desde el mismo menú) la ficha se reactiva sola
(`reactivated: true`). Los dos endpoints tiran la caché de miembros (4 min)
después de tocar roles, así el cambio se ve al instante.

**Sumar sin ficha** (`POST .../roster/members`): valida que el `userId` sea un
snowflake y que **esté en el servidor** (`fetchGuildMemberRecord`; si no, 404),
después crea la ficha vacía (`className: ""`, `specName: ""`, sin offs ni tags) y
la persona aparece como "Sin asignar" para marcarle el estado y completarla desde
su tarjeta. Es la única vía para que alguien sin ficha ni rol de estado entre a la
lista: el `PUT` de ficha exige clase y spec válidas del catálogo.

**Contador y filtros de la web** (`apps/web/src/main.tsx`): el `X de Y jugadores`
compara contra los que pasan los chips de estado/rol/tags, **no** contra el total
del roster (el total queda en el `title`), y la búsqueda mueve solo el numerador.
Así "Activo" dice `20 de 20` y no `20 de 45`. "Rol" sigue siendo el rol de la spec
principal; quien no tiene clase cae en "Sin rol". Arriba de la lista, "Agregar/
Modificar mi ficha" abre la ficha propia y "Sumar jugador" (solo staff con el
módulo de raids) busca entre los miembros del servidor que todavía no tienen
tarjeta.

Los tres grupos de filtros (Estado, Rol, Etiqueta) usan **los mismos chips que el
resto del hub**: los estados son *chips de color* —el mismo componente que las
etiquetas—, así que sin seleccionar van tenidos con su color al 22% y al
seleccionarlos se llenan con el color pleno y el texto de contraste (antes tenían
colores propios en CSS y al seleccionarlos solo se aclaraban un poco, que es lo
que se veía distinto al resto de los módulos). Los colores viven en
`ROSTER_STATUS_FILTERS` (`#35b96f` activo, `#f5b540` bench, `#e5484d` inactivo,
`#869ed6` sin asignar), los mismos que usa la tarjeta del jugador.

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
omite. Las listas del análisis **mantienen el alto de la fila** (el de la lista
más corta de las dos columnas) y lo que sobra se scrollea adentro, con un
scrollbar fino y un degradado abajo que avisa que hay más (desaparece al llegar
al final). El análisis se abre en una **ventana emergente** (el mismo modal que
el resto de los módulos: cierra con la X, con Escape o clickeando afuera, y
mientras está abierto la página de atrás no scrollea), así no empuja la ficha de
la noche. Arriba a la izquierda los contadores muestran noches, semanas distintas
y días de la semana en los que se raideó (2 con miércoles y jueves).

**La identidad de un boss es su id de encuentro, no su nombre**: el nombre cambia
con el idioma del cliente que subió el log ("The Coiled Altar" vs "El Altar
Serpenteante"), así que contar por nombre daba un boss de más — el mismo problema
que producía el "10/10" en una raid de 9 bosses. Un **pull** se identifica por boss
+ hora absoluta del fight (`start` en el `summary`, con 15 s de tolerancia): los
pulls que traen dos reports de la misma noche se cuentan una sola vez (en la
tarjeta y en el análisis) y los pulls distintos del mismo boss (un wipe y su kill)
siguen contando los dos. Para mostrar, el análisis usa **un solo nombre por boss**:
el del report más completo de la noche, así el mismo boss no aparece con dos
nombres ("Resumen por boss" dice lo mismo que la tarjeta). Los logs
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
acción aparece en la ficha ("Publicar en Discord" / "Actualizar log") según
el estado, pero el estado en sí no se muestra. Las acciones de la noche
—**Ver análisis**, publicar/actualizar y **Eliminar**— están arriba, al lado del
título, y arriba de ellas van los avisos: "● En vivo" y **"Mensaje
desactualizado"** cuando la entrada está publicada pero el mensaje quedó viejo
(`needsUpdate`, que calcula el API comparando el texto guardado con el que
generaría ahora).
**Actualizar log** vuelve a leer el report en Warcraft Logs y edita el
mensaje ya publicado **solo si el texto cambió** (si no, avisa "sin cambios"); no
toca el análisis, que se recalcula al abrirlo. El refresco automático cada 5 min
solo baja los datos del report: el mensaje de Discord se actualiza a mano.

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
minutos por entrada y se apoya en dos consultas a la API v1 de Warcraft Logs:
`tables/summary` (roles) y `events` con `filter=type in ('combatantinfo')`
(quién estaba en cada pull y qué auras tenía activas).

Devuelve:

1. `averageDps` — DPS promedio por jugador con `role` (`dps | healer | tank`).
   La web usa el rol para dejar healers y tanks fuera de la tabla de DPS y del
   "top DPS" por pull. Si WCL no devuelve roles, se muestran todos.
2. `deathsByPlayer` / `deathsByAbility` / `encounters` — muertes y detalle por
   pull (todos los roles cuentan acá).
3. `consumables` — **flask y comida**. `categories` lista lo que se pudo medir
   en la noche (y su orden es el que usa la web); `players[].counts` y
   `pulls[].missing` usan esas mismas claves, así que una categoría que no se
   pudo medir no aparece y la web no inventa faltantes. Las dos salen de las
   auras de CombatantInfo (activas al empezar el pull): en la v1 cada aura trae
   el id, así que cuando no viene el nombre se resuelve con `tables/buffs`.
   **Cada categoría se mide por separado**: una noche con flask reconocido y
   comida sin reconocer muestra flask y no comida, porque listar a toda la raid
   como si no hubiera comido es peor que no informarlo (el log de un idioma o un
   nombre de buff que no matchea se veía exactamente así).
   Los nombres se comparan **sin acentos y por raíz, en inglés, español y
   portugués** ("Well Fed" / "Bien alimentado" / "Bem Alimentado" caen en
   `alimentad`, "Flask" / "Phial" / "Frasco" / "Vial" en flask): Warcraft Logs
   devuelve los nombres como los tenía el cliente que subió el log, y comparar
   nombres completos dejaba a todo un report sin consumibles. Los nombres que no
   se reconocen y estaban en casi todos los pulls quedan en el log (`auras sin
   clasificar`), que es la única forma de saber con qué nombre viene un
   consumible nuevo.
   Flask y comida se esperan en **cada pull**, así que la web muestra quién
   faltó (`players[].counts` y `pulls[].missing`, con el número de pull en el
   chip). **Pociones y piedras no se reportan**: se identifican por nombre en la
   tabla de casts y en los logs de la guild eso no se pudo medir de forma
   confiable, así que mostrar "nadie la usó" era peor que no mostrarlo.
5. `attendance` — cruce entre los que aparecen en el log y los anotados al
   evento de raid más cercano al primer pull (±14 h, `type: raid`). El evento se
   elige por cercanía y se toman los anotados: "voy" y "tarde" son el compromiso
   que mide `signedPresent` / `signedTotal`, y los que faltaron van a
   `signedAbsent` (o a `unmatchedSignups` si no dejaron PJ escrito). En
   `unsignedPresent` ("vinieron sin anotarse") entran solo los que **no tenían
   anotación válida**: los que dijeron "no voy" (aunque figuren en el evento) y
   los que no figuran en la lista. Estar en bench, anotarse tarde o haber puesto
   "tentativo" es anotarse, así que no aparecen ahí. `partial` avisa cuando no se
   pudo leer la presencia por pull (CombatantInfo) y los participantes salieron
   de la tabla de daño: ahí un "no vino" puede ser un heal que no hizo daño.
   `event` viaja con el cruce porque el staff confirma ahí los nombres parecidos
   (y el API necesita el id para corregir el PJ de esa inscripción), pero **no se
   muestra**: de qué noche es el cruce se ve en el informe del evento, en
   Admin → Eventos.
6. `source` — de dónde salió el análisis: el report **más completo** de la
   noche es la base (`baseReport` / `basePulls`) y define el nombre de cada boss
   cuando el mismo aparece en los dos reports; `extraPulls` cuenta los pulls que
   solo están en otro report y `repeatedPulls` los que se contaron una vez. No se
   muestra en la web: es para que el análisis y la tarjeta digan lo mismo.

En la web cada listado se corta a la altura de la columna más corta y lo que
sobra se scrollea adentro (con un degradado que avisa que hay más), así las dos
columnas cierran en la misma línea. Las grillas usan `auto-fit`, así que una
sección sola ocupa el ancho completo.

### Análisis de la noche desde el mensaje

El **título de la noche** sale del report de Warcraft Logs ("Raid H", "Raid
Hero", "Raid Mitico") y el API le **agrega la fecha del primer pull**
(`raidTitleWithDate`: "Raid Hero · 07/10/2026"), salvo que ya traiga una fecha,
para no tener que escribirla a mano al subir el log. La fecha va en hora
argentina.

El mensaje que se publica a mano ("Publicar en Discord") lleva los links de los
reports de Warcraft Logs y, además, un link al **análisis en el Hub**
(`/?log=<logId>#/raids/logs`): la web lee `log`, selecciona esa noche y abre el
análisis solo. No hay publicación automática: el mensaje de la noche se manda
desde la ficha y se actualiza con "Actualizar log" (ver abajo).

La **configuración del módulo** (canal de publicación, guild/realm/región de
Warcraft Logs, alta por URL y logs ocultos) vive en un modal que abre el botón de
engranaje del encabezado, en vez de un panel fijo arriba de la lista: no compite
con las noches y sólo aparece cuando alguien la necesita. El modal se abre solo si
la guild todavía no tiene logs (es lo primero que hay que configurar) y no lleva
caja ni color propio: el modal ya es la caja y los grupos se separan con una
línea.

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
distintos, hasta 10 y con un mínimo de 2 jugadores —con uno solo no hay nada que
distinguir, y `source: "configured"` viene con todo en cero, o sea sin
distintivo—. Los cortes viven en la web (`GAME_HOT_COUNT` /
`GAME_HOT_MIN_PLAYERS`, `apps/web/src/main.tsx`): el API no sabe de presentación.
La grilla se vuelve a pedir cada 30 s (`GAMES_REFRESH_MS`), aparte del refresco
del dashboard (60 s) que además pega contra Discord. Lo último que se vio queda
guardado en la sesión del navegador (`sessionStorage`, por guild), así una recarga
muestra las portadas de una y el refresco va detrás —igual que los boosters—; sin
nada guardado se ve un spinner en la misma caja que el carrusel (antes eran seis
tarjetas fantasma parpadeando, que se leían como un error de carga).

La agregación agrupa por **nombre base**, no por id de aplicación ni por nombre
exacto: Discord tiene más de un id para el mismo juego (ids viejos y nuevos, una
beta aparte) y también más de un nombre ("Path of Exile", "Path of Exile 2: Dawn
of the Hunt", "Skyrim Special Edition"), y agrupando por id o por nombre exacto el
carrusel mostraba la misma tarjeta dos veces. El nombre base es el nombre sin el
subtítulo (`gameBaseKey` corta en `:` o ` - `), sin el adorno entre corchetes del
final (PoE Overlay II reporta "Path of Exile 2 <PoE Overlay II>") ni el sufijo de
edición/secuela (números romanos o arábigos, "classic", "special edition", "early
access", …), aplicado en cadena y solo si queda un nombre con sentido: el carrusel
mide a qué juega la guild, no el título exacto de la tienda.
Los jugadores y los días de esas variantes se **unen** (no se pierde nada) y el
nombre visible es el de más filas y, a igualdad, el más corto, también sin el
adorno (el carrusel no muestra "Path of Exile 2 <PoE Overlay II>"). La portada se
busca empezando por el id con más actividad y probando todos los nombres vistos
—los limpios y los originales—, para que un id viejo sin portada no deje la
tarjeta vacía.

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

Aun así hay juegos que llegan sin portada (los que no están en la lista de
CurseForge: launchers, editores, juegos muy nuevos). En la grilla esas tarjetas
dibujan un **ícono de joystick** en la misma caja de la portada, en vez de
quedar como un recuadro vacío (`game-cover-fallback`).

XP:

1. `GET /guilds/:guildId/xp-config`
2. `PATCH /guilds/:guildId/xp-config`
3. `GET /guilds/:guildId/xp/leaderboard`
4. `GET /guilds/:guildId/xp/export`
5. `POST /guilds/:guildId/xp/import`
6. `POST /guilds/:guildId/xp/reset-all`
7. `POST /guilds/:guildId/xp/sync`

### Piezas compartidas del panel Admin

Todas las páginas del panel se arman con el mismo vocabulario, así ninguna se ve
distinta de la otra (el editor de XP fue el primero en usarlo):

- `admin-group` — un bloque con rótulo y contenido. Dos grupos seguidos se
  separan con una línea: no hay cajas adentro de cajas (la página ya es un
  panel).
- `admin-group-head` — el rótulo chico en mayúsculas, con ícono opcional.
- `admin-list` / `admin-row` / `admin-row-box` — listas de filas compactas
  (44 px): la caja, el rótulo, el espaciador y los chips (`admin-row-tag`) los
  comparten los niveles del XP, los módulos, el registro de auditoría, el
  historial de eventos, las frases del loro y los catálogos del Mapeo. Lo que se
  abre (una fila con detalle) es un `button.admin-row-main` con el lápiz
  (`admin-row-action`) y los botones chicos al costado.
- `admin-sub` — sub-card plegable (grupos del Mapeo, tipos de evento, lista de
  roles): misma caja y mismas medidas que una fila.
- `admin-actions` — fila de botones chicos, y `admin-save` — la fila de guardado
  al pie de la sección (aparece solo si hay cambios, en todas las secciones
  igual).
- `modal-head` — la cabecera de las ventanas del panel (ícono + título y la cruz
  a la derecha). La comparten el editor de XP y el del loro.
- `form-grid--three` — variante de tres columnas para grupos de tres campos
  cortos (umbrales del watcher de Karuta), porque con dos columnas quedaba media
  fila vacía.
- `admin-switch-field` — un campo cuyo control es un interruptor (`+ su chip de
  estado`), con el mismo padding vertical que los controles: el switch entra
  como un campo más y queda alineado con el select de al lado. Los encendidos
  **no** ocupan una fila estirada a lo ancho del panel (quedaban con ~900 px de
  aire en el medio).

Con eso quedaron migrados los dos últimos módulos: **Karuta** (watcher, canal y
los umbrales por print y por wishlist, en tres grupos) y **Karpindomo** (la
publicación del loro y la lista de frases). En los dos, el canal y su interruptor
comparten la primera fila del grupo, así que no hay cajas solas ocupando media
fila. Las frases dejaron de ser un textarea
siempre abierto: son filas compactas (texto, chip Activa/Pausada y los botones de
pausar y borrar) y el alta y la edición pasan por una ventana con el texto. Antes
no había forma de corregir una frase: había que borrarla y crearla de nuevo.

El editor de XP vive en `apps/web/src/XpSection.tsx` y no guarda nada por su
cuenta: recibe la config y devuelve los cambios al App, que es el que sabe si
quedó sucia (`dirty`) para ofrecer "Guardar configuración". Los roles por nivel
son una fila cada uno y todo el detalle se edita en una **ventana emergente**
(con la búsqueda de roles adentro), así el módulo no se vuelve una página larga
con ocho controles por regla.
Los colores de rol (chip y nombre con degradado) salen de
`apps/web/src/roles.ts`, compartidos con el perfil y el ranking: un rol se ve
igual en todos lados.

Las secciones del panel son: **Configuraciones**, **Mapeo**, **Roles**, **Módulos**,
**Permisos**, **XP**, **Karpindomo**, **Karuta**, **Plantillas** (el catálogo de
tipos de evento), **Eventos** (el historial de los que ya terminaron) y
**Registros** (auditoría). El nombre visible de las dos últimas cambió, pero las
claves siguen siendo `eventos` y `historial`: los enlaces `#/admin/eventos` y
`#/admin/historial` abren lo mismo de siempre.

**Historial de eventos (Admin → Eventos):** tiene dos vistas, **Mes** y **Día**
(el selector de dos botones, como el de Google Calendar). En **Mes** se ve el mes
entero con una tarjetita por evento terminado en su día (emoji del tipo, título,
hora y cuántos asistieron), el contador del mes y la navegación `‹ mes ›` — el día
de hoy va marcado; lo que no entra en un día se pliega en "+N más" y se despliega
ahí mismo. El número de cada día es un botón que abre la vista **Día** de esa
jornada: los eventos de ese día, uno por fila (hora, título y la asistencia
declarada), con la navegación `‹ día ›` y el acento del tipo en una barra a la
izquierda. Al pasar a Día se abre en el día que estabas mirando y, si ese día no
tiene nada, en el día con eventos más cercano; volver a Mes muestra el mes de ese
día. El botón de la derecha dice "Ir al mes actual" o "Ir a hoy" según la vista.
El buscador está en la misma barra y, mientras buscás, muestra chips para saltar
a los meses (o a los días) con coincidencias, así no hay que recorrer el historial
a mano. Al abrir, si el mes actual no tiene eventos, se muestra el mes con
actividad más cercano, una sola vez.

**El informe de un evento** (click en una tarjeta o en una fila del día) va en una
ventana ancha
(`.modal--report`) y tiene cuatro partes:

1. El resumen de la noche: fecha, horario (empieza → termina y las horas), juego
   y tipo, y la convocatoria del roster (`GET .../events/:eventId/roster`:
   confirmados sobre esperados y cuántos no respondieron).
2. La asistencia **declarada**, con los mismos chips que el aviso de Discord
   (👥 anotados, ✅ asistentes, 🪑 bench, ⏰ tarde, ❌ no asisten) y cuántos se
   anotaron como "asisto".
3. La asistencia **real**, en la fila "En el log": el cruce de esa noche contra
   el log de Warcraft Logs (`GET .../events/:eventId/attendance`, que devuelve
   `attendance: null` cuando esa noche no tiene log guardado, que no es lo mismo
   que "no vino nadie"). Los chips resumen cuántos de los que se comprometieron
   vinieron, cuántos no, cuántos de bench jugaron igual, cuántos **dijeron que no
   y aparecieron**, los nombres parecidos que quedan a confirmar y quiénes
   jugaron sin anotarse.
4. **Una fila por jugador, agrupada por lo que declaró** ("Se anotaron para
   asistir", "🪑 Bench", "Avisaron que llegan tarde", "Avisaron que no van", con
   "· N en el log" en el título de cada grupo). Cada fila trae el cruce contra su
   ficha del roster y contra el log: clase y spec (los de la ficha, que es la
   fuente de verdad; si la inscripción decía otra cosa, se muestra abajo como
   "inscripción: …"), el rol (si no eligió, el de su ficha: "según su ficha:
   Healer"), si **jugó** ("✔ jugó (12 pulls)", "✘ no jugó", "¿Danii? (86%)"
   cuando el nombre del log se parece pero no es igual, "sin personaje para
   comparar" o "—" si no hay log de esa noche) y los avisos de ficha en una sola
   columna "A revisar" ("ficha: Fire Mage", "rol distinto a su ficha (Healer)",
   "sin ficha en el roster", "ficha sin clase ni spec"), con ✓ cuando no hay nada
   que revisar. El último grupo son los que tenían que estar y **no
   respondieron** ("❓ Sin responder"): se leen con la misma fila que el resto
   (ficha, rol y si aparecieron en el log igual), para que el cruce se pueda
   hacer de un vistazo sin abrir el roster aparte.

**La ficha se corrige desde el informe.** La fila que tiene algo que revisar trae
un botón "Corregir ficha" que abre el panel del roster (`RosterSheet`, el mismo de
Raids → Roster) precargado con **lo que la persona se anotó** en el evento, con un
aviso de que viene precargado: sin eso, lo que se ve parece ya guardado. Se guarda
sin salir del informe y el cruce de esa fila se rehace con lo que devuelve el API,
así el aviso desaparece en el momento. No se puede **eliminar** la ficha desde acá:
esa acción vive en el roster, con su confirmación.

Tres cosas del botón que no son obvias:

- La ficha **vacía** (la que crea "Sumar jugador" al sumar a alguien al roster)
  también cuenta como "ficha sin clase ni spec": es el caso más común de ficha a
  completar. Una ficha de OTRO juego no: no es que falte, es de otro juego.
- Solo aparece si el roster cargó: al guardar, el panel conserva los tags y los
  alters de la ficha existente, y sin roster esos datos se pisarían a ciegas.
- Pide el módulo `raids` (`PUT /guilds/:guildId/roster/:userId`), así que el staff
  de eventos que no lo tenga ve el aviso pero no el botón.

Mientras el roster y el log están en camino, las columnas que dependen de ellos
muestran **esqueletos** en lugar de contenido provisorio: si no, cada fila
aparecía un instante como "sin ficha en el roster" y después cambiaba de golpe.
La convocatoria dice "Calculando…" y la fila "En el log" avisa que está buscando
el log de esa noche con el anillo de carga.

**La descarga del informe (CSV y PDF) sale del mismo modelo.** Todo lo que se ve
en la ventana —resumen, chips de asistencia declarada, el cruce con el log, la
ficha de cada uno, su presencia real y los avisos— lo arma `event-report.ts` una
sola vez, y la ventana y los dos formatos lo consumen: si la web muestra un dato,
el archivo lo tiene. Antes el CSV lo generaba el API (`report.csv`, sin el cruce
ni la presencia: un informe entero por su cuenta) y el PDF el navegador, así que
los dos salían incompletos y distintos de la pantalla. El CSV va con `;` y BOM
(Excel en español, acentos y emojis), y el PDF se dibuja con jsPDF: encabezado,
resumen en dos columnas, una tabla por grupo y pie con el paginado.

Dos cosas de la descarga que no son obvias:

- El PDF se genera como **Blob** y lo baja `downloadBlob`, que agrega el `<a>` al
  documento antes de clickearlo. Con `doc.save()` de jsPDF el `<a>` queda suelto y
  **Firefox ignora la descarga en silencio**: no bajaba nada y tampoco había error.
- El nombre del archivo se arma con el título (`informe-<slug>.pdf`), así que dos
  eventos distintos no se pisan al descargar.

El cruce usa el catálogo que viene **con el roster** (`GuildRoster.specs`,
`roles` y `classEmojis`), no el de la tab Eventos: entrar directo a
Admin → Eventos (sin pasar por Eventos) dejaba ese catálogo vacío y el cruce de
rol se quedaba sin comparar. El roster se pide al abrir la ventana y se olvida al
cerrarla, así el informe siempre muestra la última ficha guardada.

El endpoint de asistencia devuelve `byUser` con **una entrada por jugador del
evento**: los anotados de cualquier estado (`present`, `pulls`, el `logName` que
coincidió y `likely` cuando el parecido no alcanza para confirmar) y los del
roster esperado que no respondieron (estado `none`, presencia solo si un
personaje suyo —el recordado o un PJ ya confirmado— aparece en el log), así el
informe puede decir de cada persona si jugó o no sin cruzar los nombres de nuevo
en la web. Ese cruce de los que no respondieron se hace **en el endpoint** y no en
el análisis cacheado, porque el roster esperado es del evento y no del log: del
análisis (cacheado 10 minutos) sale lo caro, que es la llamada a Warcraft Logs.
Prueba como mucho dos logs candidatos por cercanía en ±14 h y acepta solo el que
reconoce ese evento, así abrir el informe no dispara el análisis de otras noches.

Dos detalles que no son obvios: el día del calendario se calcula en hora
**local** (con `toISOString()` un evento de las 22:00 caería en el día siguiente)
y en pantallas angostas (≤900 px) el calendario se vuelve una **agenda**: un día
por fila, sin los días vacíos ni los del mes vecino (y las filas del informe
pasan a una columna).

Emojis del servidor: `GET /guilds/:guildId/emojis`

Boosters de Nitro: `GET /guilds/:guildId/boosters`

Inicio: la tarjeta principal son los **boosters** (los que bancan el server, con
el acento de Nitro, el contador de boosts y una tarjeta por miembro —
`.home-member-card`— porque es lo que más se mira) y abajo van dos de
seguimiento, lado a lado (`.home-secondary`, media pantalla cada una y apiladas
abajo de 1020 px): el **podio** por XP (top 5, con el color de rango de cada
puesto —las variables `--podium-*`— y el del nivel en el nombre) y los **raid
leads** (`GET /guilds/:guildId/raid-leads`), que son los que tienen el rol de Raid
Officer mapeado en el roster —liviano a propósito: avatar, nick y usuario, porque
la fila solo muestra quiénes son—. Los leads salen ordenados por XP, de mayor a
menor (y sin perfil de XP al final), así el orden se lee igual que el del podio y
no baila entre cargas. Las tres cajas ocupan el ancho completo sin
importar cuántos miembros haya: la grilla de tarjetas usa `auto-fit` (con
`auto-fill` las columnas sobrantes quedaban vacías a la derecha) y las dos listas
comparten la misma fila (`.home-member-row`, con el acento del grupo en
`--home-member-rgb`), así que no hay dos UI para lo mismo. Ni los boosters ni los
raid leads se borran al salir de Inicio (solo al cambiar de guild): aparecer de
golpe después de esperar la respuesta era peor.

Auditoría (solo owner, readonly): `GET /guilds/:guildId/audit-logs`

Reminders (legacy): `GET/POST /guilds/:guildId/reminders`, `DELETE /guilds/:guildId/reminders/:reminderId`

### Módulo de eventos ("Módulo X")

Eventos con inscripciones estilo Raid Helper. Un evento puede publicarse como
Scheduled Event de Discord y/o como aviso-embed en un canal (el bot maneja los
botones de inscripción).

**Dos niveles: la lista y la página del evento.** El módulo tiene `#/eventos`
(el listado) y `#/eventos/<id>` (la página de un evento). En el listado cada
evento es una **tarjeta compacta** —portada, cuándo empieza, cuánto dura, las
etiquetas y la asistencia con mi estado— que lleva a su página; el detalle
completo vive ahí: portada como banner, datos (empieza, termina, cierre,
requisito de rol), descripción, roster por rol con los estados (bench, tarde, no
asisten) y el panel para anotarse. Las acciones de staff (editar, duplicar,
informe, limpiar ocurrencia, eliminar) viven en la **tuerquita de la cabecera**,
no en una fila de botones dentro de la tarjeta. Antes cada tarjeta de la grilla
traía el evento **entero** (roster, panel de inscripción y botones) apilado en una
columna de 420 px: el listado se volvía una pared y el detalle quedaba apretado.

**Cabecera de la página:** tres columnas (`auto 1fr auto`) —la vuelta a la lista
como icon-button a la **izquierda**, el título del evento **centrado** y la
tuerquita a la derecha—. Las columnas laterales miden lo mismo (38 px, el
icon-button del hub) y por eso el título queda en el centro real del panel y no
corrido; quien no gestiona eventos ve un hueco del mismo ancho en lugar de la
tuerquita. El menú de la tuerquita es una caja sólida anclada al botón (mismo
patrón que el desplegable del nav) con las acciones separadas de "Eliminar" por
una línea.

Tres decisiones que no son obvias:

- La URL sale del **título** (`#/eventos/raid-jueves`), no del id, para que se
  pueda leer y compartir. Una serie repite el título todas las semanas, así que
  si dos eventos quedan con el mismo slug el **primero** (activo, y entre activos
  el más próximo) se queda con la URL limpia y el resto lleva un sufijo corto del
  id. El id sigue funcionando como clave (enlaces viejos, o mientras la lista
  carga): la URL se normaliza al slug con `replaceState`, así el "atrás" no pasa
  por una entrada intermedia.
- La página se busca en **todos** los eventos, no solo en los activos: una
  ocurrencia archivada (Admin → Eventos) también tiene su página y muestra el
  roster que quedó de esa noche. El título de la página y de la pestaña del
  navegador es el del **evento**, con la vuelta a la lista en la cabecera del
  panel (en la fila del título, como el resto de las acciones de módulo).
- El ancho se aprovecha con CSS, no moviendo el markup: el cuerpo de la tarjeta
  se vuelve un grid de dos columnas y cada bloque se ubica con `grid-column`
  (datos y roster a la izquierda; asistencia e inscripción a la derecha). Así el
  orden del DOM sigue siendo el mismo que cuando el componente era una tarjeta de
  la grilla, y en pantallas angostas (≤900 px) vuelve a una sola columna.

**La portada se ve entera.** El banner mantiene el alto del formato 3:1, pero la
imagen va con `object-fit: contain` en vez de `cover`: recortar el arte de una
imagen que ya viene armada (con texto dibujado) comía justo lo que se lee. Lo que
sobra a los costados lo llena la misma imagen ampliada y desenfocada
(`.event-card-image-wrap::before`), así el marco no queda de un color plano.

**La inscripción se hace como en el bot.** El panel de "Mi inscripción" es una
tarjeta con el flujo del asistente de Discord: primero el **estado** (Voy /
Tarde / Bench / No asisto), después el **rol** (Tank / Healer / Melee / Range,
uno por botón con su etiqueta: antes eran círculos con un emoji), después
**clase** y **spec** en dos desplegables —el catálogo entero como grilla de chips
ocupaba media pantalla de alto— y al final el **personaje**. Cambiar de rol
limpia la clase y la spec.

**El catálogo no se recorta por rol.** El desplegable de clase ofrece **todas**
las clases del juego y el de spec **todas las de esa clase** (las del rol
seleccionado primero). Antes la clase se filtraba por el rol que se estaba
mirando, así que en "Tank" aparecían seis clases y una sola spec por clase; el
rol ahora se **deriva** de la spec elegida (`chooseSpec` lo ajusta: Druid →
Feral deja el rol en Melee).

**Clase y spec muestran el emoji del servidor, no un emoji unicode.** Un
`<select>` nativo no puede dibujar imágenes, así que son un botón con el emoji
elegido + un menú (`EmojiSelect`): cada opción trae el emoji custom que el staff
mapeó (spec: `emojiId` de la fila de `RaidSpec`; clase: el grupo `class` del
Mapeo, o `GuildRoster.classEmojis` para quien no es staff, que no puede leer el
Mapeo) y cae al unicode de la clase si el emoji se borró en Discord. El menú va
por **portal** con `position: fixed` anclado al botón: la tarjeta del evento tiene
`overflow: hidden` y un desplegable largo quedaba recortado. Se cierra con click
afuera y con Escape, y sigue al botón si la página se mueve.

**El título y las etiquetas van en la cabecera.** En el cuerpo de la tarjeta el
título estaba repetido justo debajo del banner (que ya lo muestra dibujado en la
portada), así que se sacó: el título es el `h2` del panel y las etiquetas
(`ComunicadoTag`) van a su costado, en la misma fila centrada. En el cuerpo queda
sólo la fila de **estados** (Pausado / Completado / Cerradas), y se omite cuando
no hay ninguno.

**Los grupos del roster van de a dos**: cada rol es un panel y entran **dos por
fila** (Tank | Healer / Melee | Range), con el ancho justo para que
"nick (personaje)" entre en una línea. Antes eran cuatro columnas angostas y el
cuarto rol quedaba solo en una fila con el nombre partido en dos renglones. Cada
panel mantiene el alto de su gente (no se estira al del más largo) y los estados
siguen uno por fila debajo del roster.

**Menú del nav y página del evento.** La tab **Eventos** del nav superior es un
desplegable (como Raids y Admin) pero **dinámico**: arriba el alta
(`＋ Nuevo evento`, sólo con permiso del módulo `eventos`) y después cada evento
abierto del más cercano al más lejano (título y el día). El menú se scrollea
(máx. 460 px) en vez de crecer sin límite, y quien no puede crear eventos no ve
el alta: sólo entra a cada evento. La lista completa (`#/eventos`) se abre
clickeando el título del módulo, que es la única puerta a "todos los eventos".

Ojo con **cuándo se carga la lista**: el menú se abre desde cualquier módulo, así
que la lista se pide con el módulo habilitado y no sólo al entrar a la tab. Antes
el efecto vaciaba `events` al salir de Eventos, y el desplegable abierto desde
Inicio decía "No hay eventos próximos" aunque hubiera eventos (mientras cargaba
tampoco se muestra ese texto: sólo aparece cuando la lista ya llegó y está vacía).

**La barra del módulo (Roster, Eventos y Comunicados).** Los tres módulos usan la
misma barra: el título lo pone la cabecera del panel y abajo va la barra
(`.module-toolbar`) con las acciones a la izquierda (con ícono) y el buscador
ocupando el resto, más los chips de filtro en su propia fila. En Comunicados el
alta (`＋ Nuevo comunicado`) estaba adentro del `ListFilterBar` (quedaba después
del buscador, alineado a la derecha) y los chips compartían fila con el buscador;
ahora sigue la misma disposición que Roster y Eventos.

Dos detalles que hacen que se vean alineados: el `ListFilterBar` trae
`width: 100%` y un margen inferior pensados para ir como bloque suelto, así que
dentro de la barra se neutralizan (ese margen corría al buscador 7 px respecto del
botón, porque el navegador centra la caja **con** su margen), y el botón de la
barra (`.module-toolbar-button`) lleva el ícono alineado al texto con `gap`.

**El título ("Eventos") lo pone la cabecera del panel** y abajo va la barra.

**La ventana de evento es una ventana del panel.** Usa la base (`.modal`: fondo,
borde, radio, padding y la cabecera `.modal-head` con ícono + título + la cruz
circular) y sólo cambia el ancho (920 px) y que el scroll lo hace la capa y no la
ventana: con `overflow` en la ventana, el almanaque de "Fecha y hora"
(`position: absolute`) quedaba recortado por el borde. Los campos van en
`.form-grid` (dos por fila, los bloques anchos ocupan la fila entera) y las
acciones usan el pie estándar (`.admin-save`: línea arriba y `Cancelar` +
`Crear evento`).

**Los modales de eventos van por PORTAL.** El panel de contenido tiene
`backdrop-filter`, y eso lo convierte en el contenedor de los `position: fixed`
de adentro: el overlay del form (y los de editar inscripción, informe y roster)
quedaban recortados por el borde del panel —la ventana "se cortaba" y el fondo
desenfocado tapaba lo que sobresalía—. Con `createPortal` a `document.body` el
overlay vuelve a cubrir la pantalla y su scroll llega hasta el final. Todos los
overlays del hub pasan por el helper `ModalPortal` (`main.tsx`): el panel de
contenido (y el de Admin, que además tiene `overflow: hidden`) recorta cualquier
`position: fixed` que viva adentro, así que el modal de la ficha del roster y el
de la frase del loro también se montaban mal.

**El form es minimalista.** Los toggles ("Pedir personaje", recordatorios,
repetición, pausa, limpieza al completar, publicación en Discord) son switches
chicos (`FormSwitch`, `.form-switch`) agrupados por tema en `.event-options`:
una fila por grupo con el rótulo a la izquierda (Inscripción, Repetición,
Discord, Imagen) y los controles en línea, sin caja ni fondo. Antes cada opción
era una tarjeta `.module-toggle` y "Publicar en Discord" vivía en su propio
recuadro con borde: mucho alto y cajas dentro de cajas. La imagen va como una
fila más: miniatura a la izquierda (104×66) + "Subir"/URL, con la biblioteca en
tiras de 64 px debajo. Los recordatorios son sólo **24 h y 2 h** (el API rechaza
cualquier otra hora) y la **ubicación externa del Scheduled Event se sacó**: el
evento va siempre a una sala de voz y los eventos viejos con
`entityType: external` se normalizan al guardarse.

**El switch se pinta desde el `:checked` del input**, no desde una clase
`.checked` en el label (`.module-switch input:checked + .module-switch-track`).
La clase la usan los `.module-toggle` viejos, pero un switch que no era
`.module-toggle` quedaba siempre gris: la lógica cambiaba y el dibujo no.

**El control del roster tiene filtros.** El modal del contador (`N/M`) abre en
**Faltan** (lo único accionable: a quién hay que ir a buscar) y deja cambiar a
Confirmados, Bench o Todos con los mismo chips del hub (`event-filter-chip`).
Los confirmados y el bench salen de las inscripciones del evento; los que faltan,
de `GET .../events/:eventId/roster`. Los nombres siguen abriendo el perfil.

**Los modales son opacos.** La superficie de `.modal` es `--modal-surface` y no
`--panel`: con el panel semitransparente, sobre una portada colorida se leía el
contenido de atrás a través de la ventana.

**La recurrencia se publica X días antes, no al cerrar la ocurrencia.** Al
completarse (o al tocar "Limpiar ocurrencia") el molde se archiva y se mueve a su
próxima fecha **sin publicar nada en Discord**; el scheduler
(`runEventRecurrenceSync`) lo publica cuando entra en su ventana
(`recurrencePublishDaysBefore`). Antes `resetSeriesOccurrence` republicaba el
aviso en el acto, así que la serie aparecía de nuevo apenas terminaba la raid.

**Íconos en vez de emojis.** En el hub los datos del evento (empieza, termina,
cierre, repetición, ubicación, roster principal, Discord) y los tipos
(`Sword` raid, `Key` M+, `Trophy` PvP, `Confetti` social) se dibujan con íconos de
Phosphor, como el resto de la app. Los **estados** de la inscripción siguen con
emoji (✅ ⏰ 🪑 ❌) a propósito: son los mismos que se clickean en el panel y los
que viajan en el aviso de Discord, así que son un vocabulario compartido y no
adorno. Los emojis de `EVENT_TYPES` se quedan en el API porque los usa el embed
(que no puede dibujar íconos).

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

**Aviso en Discord (orden y números):** los datos del evento van de a DOS
columnas por fila. Discord empaqueta los fields inline de a TRES, así que cada
fila se cierra con un field de ancho cero (`pushSpacer`): sin ese corte el field
siguiente se mete en la fila de arriba y las columnas del roster se corren una
posición (pasó cuando se movió la asistencia: `Empieza | Termina | Tank` en la
misma fila). El orden es: **empieza y termina** (lo primero que se mira para
confirmar la hora), después el **cierre** con el **requisito para anotarse**
—el cierre muestra el **día y la hora** (`Martes 20:00`): Discord no tiene un
estilo de timestamp que sea "día + hora" (los suyos son fecha completa o sólo la
hora), así que el día se calcula en la zona de la guild
(`America/Argentina/Buenos_Aires`) y la hora viaja como timestamp `<t:…:t>`, que
se localiza sola para cada uno. El requisito es `Requiere <@rol>` con la nota del
bench abajo, que es la única advertencia de que sin el rol no entrás al roster—,
después **todo el conteo de gente en un solo field** a lo ancho (`👥 Roster`: los
que **respondieron** sobre el roster esperado —cualquier estado, bench incluido, y
también "no asisto": haber contestado es lo que saca a alguien de "faltan
anotarse"—, la asistencia `✅ 18 (+3)` con los confirmados y, entre paréntesis,
los posibles, y el detalle por estado `🪑 3 - ⏰ 0 - ❌ 1` en el mismo orden) y al
final la gente: **columnas por rol de a dos** (tank, healer, melee, range) y los
**estados** uno por fila (bench → tarde → no asisten), con el roster arrancando
siempre en una fila nueva. Los conteos salen de
`rosterCoverageFor` ([app.ts]) y el armado de `buildEventAnnouncementEmbeds`
([events-discord-publisher.ts]); el aviso no muestra el total de confirmados
sobre el roster (eso era el viejo `🎯 X/Y del roster`, que contaba sólo a los que
van).

**Ojo con dónde van las menciones:** Discord **no resuelve menciones en el
`name` de un field** —las muestra crudas (`<@&123…>`), y encima como es un texto
largo se corta en dos líneas—. La mención del rol del requisito tiene que ir en el
`value` (el nombre queda con un espacio de ancho cero, porque Discord no acepta
un field sin nombre). En el mensaje sí se resuelven, y ahí van las del ping
(`announcementContent`, fuera del embed, con `allowed_mentions`).

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

**Ancho del aviso en Discord:** un embed no tiene ancho propio —la caja se ajusta
a su contenido: el texto llega hasta ~432 px y la imagen se muestra a su tamaño
natural, sin estirarla—, así que una imagen angosta achicaba el aviso entero y
quedaban publicaciones de anchos distintos. Por eso la imagen se guarda **ya
re-encuadrada a 400 px de ancho** (`EMBED_IMAGE_MIN_WIDTH`): el arte queda
centrado y los costados se completan estirando sus columnas de borde (sin marcos
ni colores inventados). El re-encuadre vive en la web
(`apps/web/src/embed-image.ts`), **no en el API**: se aplica al subir la imagen y
al guardar el evento, así lo que se guarda ya está listo y el API solo sirve
bytes (a `GET /public/guilds/:guildId/events/:eventId/image` le llegó a pesar el
trabajo de decodificar: si el proceso se reiniciaba justo cuando Discord pedía la
imagen, el aviso quedaba sin imagen). Los GIF animados no se tocan: pasarlos por
un canvas los dejaría quietos. La URL del embed lleva `?v=<hash de la imagen>`: al
cambiar la imagen cambia la URL y Discord la vuelve a pedir; si no cambió,
mantiene la que ya tiene cacheada.

**Peso de las imágenes:** el archivo que se puede elegir llega a **10 MB**
(`EVENT_IMAGE_MAX_BYTES`) porque una raid en alta se pasa de 3 MB sin drama. Pero
lo que se **guarda** no es ese archivo: antes de subirlo se reduce al ancho máximo
de pantalla (`UPLOAD_IMAGE_MAX_WIDTH`, 1920 px) y se recodifica (WebP; JPEG si no
hay soporte; PNG si la imagen tiene transparencia, que el JPEG aplanaría a negro).
Sin esa reducción, subir el límite solo serviría para llenar la base de megas: el
data URL viaja en la lista de eventos y en la biblioteca. El límite del API
(`14_000_000` caracteres en el data URL, y `bodyLimit` de 16 MB) está calculado
sobre el archivo ya reducido, con margen para el base64.

1. `GET/POST /guilds/:guildId/events`
2. `GET /guilds/:guildId/events/games` -> `{ games: [{ key, label, roles, configured }] }` (juegos disponibles con sus roles; `configured: false` = roles de plantilla)
3. `PATCH/DELETE /guilds/:guildId/events/:eventId`
4. `GET /guilds/:guildId/events/:eventId/roster` (convocatoria del roster: confirmados, esperados y quiénes no respondieron; lo ve el staff de eventos)
5. `GET /guilds/:guildId/events/:eventId/attendance` (asistencia real de esa noche cruzada contra el log de Warcraft Logs: quién vino, quién no, bench que jugó, dijo-que-no-y-jugó, quiénes jugaron sin anotarse y qué pasó con los del roster que no respondieron; `attendance: null` cuando esa noche no tiene log)
6. `PUT/DELETE /guilds/:guildId/events/:eventId/signups/me` (propia inscripción)
7. `DELETE /guilds/:guildId/events/:eventId/signups/me/reset` (borra inscripción + personaje recordado)
8. `GET/POST /guilds/:guildId/events/specs` (catálogo; `?game=` filtra por juego)
9. `PATCH/DELETE /guilds/:guildId/events/specs/:specId`
10. `GET /guilds/:guildId/events/templates` (plantillas disponibles; lo ve el staff de eventos: módulo `eventos`)
11. `POST /guilds/:guildId/events/templates/:templateKey/apply` (agrega/actualiza ESE juego en `eventGames` y precarga su catálogo sin borrar nada; esto sí es configuración: módulo `config`)
12. `GET/POST/DELETE /guilds/:guildId/events/images` (biblioteca de imágenes)
13. `GET /public/guilds/:guildId/events/:eventId/image` (imagen pública para el embed de Discord)

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
10. `GET /internal/guilds/:guildId/events/:eventId` (evento con sus inscripciones: el bot decide si abre el asistente o aplica el estado directo). Con `?userId=` agrega lo que ya sabemos de ese jugador: `event.playerCharacter` / `event.playerCharacterClass` (personaje recordado y su clase) y `event.playerClass` / `event.playerSpec` / `event.playerRole` (cómo se anotó la última vez)
11. `PUT /internal/guilds/:guildId/events/:eventId/signups` / `DELETE .../signups` / `DELETE .../signups/reset`
12. `GET /internal/guilds/:guildId/events/control` (recordatorios e informes pendientes)
13. `POST /internal/guilds/:guildId/events/:eventId/reminders-sent` / `.../report-sent`

> **Merge selectivo en el PUT de config**: el bot no conoce todos los campos que administra el hub (módulos, sugerencias, permisos de staff, logs de raid). El PUT interno **solo fusiona los campos propios del bot** (`temporaryVoiceChannelIds`, canales del loro, `defaultRoleId`, `musicRoleIds`, etc.) sobre la config actual. Los campos del hub se preservan y el bot nunca los resetea.

## 5. Auditoría

1. Cada mutación del Hub queda registrada (config, XP, panels).
2. Entradas: guild, actor, acción, detalle, fecha.
3. Solo lectura: no hay rutas de edición/borrado.
4. Lectura: `GET /guilds/:guildId/audit-logs` (solo owner).

**Nombres en vez de ids**: las acciones sobre una persona guardan su nombre como
`Nick (usuario)` (`memberLogName`, `apps/api/src/app.ts`), resuelto con la lista de
miembros ya cacheada (4 min), así no suma un request a Discord por acción. Si no se
pudo resolver queda el id, que es lo que se veía antes. Al leer
(`GET /audit-logs`) se hace una segunda pasada: el `targetId` de cada entrada se
traduce a su nombre dentro del detalle si quedó crudo, y `actorName` se completa
desde la lista de miembros cuando la entrada vieja no lo tenía. Así el historial ya
cargado también queda legible.

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
15. `event_player_profiles` — memoria del nombre de personaje por jugador y guild (con la clase con la que lo usó; la clase/spec del asistente salen de `roster_profiles` y, si no hay ficha, de la última `event_signups`)
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
