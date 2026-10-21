# Architecture Overview

Cómo está armado el sistema. Para el porqué de las decisiones y el orden en que se
construyó, ver [process.md](process.md).

## 1. Componentes

1. `apps/discord-bot`

- Runtime de Discord (discord.js v14)
- Comandos slash (perfil, ranking, timers, XP, música, salas de voz)
- Eventos: entrada/salida de miembros, XP por mensaje y por voz, presencias
  (juegos que se juegan), mensajes de Karuta en el canal vigilado
- Salas de voz temporales, música y control de los avisos de eventos (botones)
- Scheduler del loro: publica frases aleatorias a intervalos aleatorios
- Tiene la config del bot en memoria (caché) y un archivo local de respaldo

2. `apps/api`

- API HTTP (Fastify) + validación de payloads (Zod)
- OAuth con Discord + sesiones
- Persistencia en PostgreSQL via Prisma
- Endpoint interno para el bot (x-bot-token), con merge selectivo de config
- Registro de auditoría de cambios del Hub
- Comunicados: publica en Discord vía REST + los muestra en el hub
- Logs de raid: sincroniza con Warcraft Logs, analiza la noche y publica en Discord/web
- Módulo de eventos ("Módulo X"): eventos por juego, inscripciones, publicación en
  Discord (scheduled event + aviso-embed con botones), roster y asistencia
- Roster de raids: fichas, estados y rangos (lo comparten la web y los raid leads de Home)
- Karuta: cartas raras, wishlists y álbumes (con las imágenes cacheadas)
- Sugerencias: las manda por DM a los rangos configurados
- Boosters, widget del servidor y raid leads para Home
- Tareas periódicas que hacen avanzar el estado sin intervención (ver §9)

3. `apps/web`

- UI de Guild Hub (React + Vite)
- Home (tarjeta de boosters al frente y, debajo, tres tarjetas: el podio por
  nivel, los raid leads y los activos del mes), dashboard, comunicados, raids
  (roster y logs), eventos, karuta, torneos (por ahora sólo el cartel de "Bajo
  mantenimiento"), sugerencias y perfil. Home y Perfil no son módulos apagables:
  son la puerta y la ficha de cada persona
- La barra de navegación es **Home + los módulos activos + Admin**. Admin no va
  entre los módulos: vive al lado del chip del perfil, con su submenú anclado a la
  derecha (`right: 0`) para no salirse de la pantalla
- En el panel admin, "Plantillas" es el catálogo de tipos de evento y "Eventos" el
  historial en **calendario** (mes con una tarjeta por evento, buscador con salto
  a los meses con coincidencias y el informe de cada noche en una ventana, con el
  cruce de los anotados contra su ficha del roster y contra el log de esa noche,
  que dice quién vino de verdad); las claves de los enlaces no
  cambian
- El informe se puede **descargar** en CSV y PDF con todo lo que muestra la
  ventana: las dos salidas se arman del mismo modelo (`apps/web/src/event-report.ts`),
  no de una copia paralela que se desactualiza
- Consume endpoints del API
- Iconos: `@phosphor-icons/react` con `weight="fill"` (un solo set, formas
  sólidas que se leen en el panel oscuro); el tamaño y el color los fija el CSS

4. `PostgreSQL`

- Fuente principal de verdad (config, XP, auditoría, sesiones)

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

## 4. Sistema de XP

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

## 5. Módulo de eventos (juego por evento)

El bot y la web comparten la misma lógica: el API es la fuente de verdad y el
bot solo dibuja los botones del aviso y manda la inscripción.

```text
Evento            (hub_events.game = "wow" | "lol" | ...)
   |
   +-- roles     -> plantilla del código (event-templates.ts)
   +-- catálogo  -> plantilla del código + raid_specs (lo que no esté ahí)
   |
   v
Aviso-embed (botones)  +  Tarjeta en la web
   |
   v
event_signups (rol, clase, spec, personaje, estado)
```

1. La guild puede tener varios juegos configurados a la vez; cada evento elige uno.
2. Las **plantillas** (`event-templates.ts`: `wow`, `lol`, `encuesta`) son data pura y la fuente de verdad de los roles y del catálogo: agregar un juego no requiere configurar nada.
3. `raid_specs` quedó como complemento: solo aporta las clases/specs que no están en la plantilla.
4. Los eventos anteriores al cambio tienen `game = "wow"` (default de la columna), así que sus inscripciones siguen cuadrando con los roles clásicos.

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
7. `GET /internal/guilds/:guildId/daily-messages` (frases habilitadas del loro)
8. `POST /internal/guilds/:guildId/karuta/grabs` (transferencia de posesión de una carta rara)
9. `POST /internal/guilds/:guildId/karuta/cards|cards/burn|transfers|albums` (colección de cartas raras)
10. `GET /internal/guilds/:guildId/events/specs?game=<juego>` (roles del juego + catálogo para el asistente de inscripción)
11. `GET /internal/guilds/:guildId/events/:eventId`
12. `PUT /internal/guilds/:guildId/events/:eventId/signups` / `DELETE` / `DELETE .../signups/reset`
13. `GET /internal/guilds/:guildId/events/control`
14. `POST /internal/guilds/:guildId/events/:eventId/reminders-sent` / `report-sent`

## 8. Persistencia actual

Tablas:

1. `guild_configs` — config por guild (canales, rol de entrada, `enabledModules`, `suggestionsDm*`, `xpSyncRequested`, salas temporales, loro, logs, juegos de eventos)
2. `guild_mappings` — mapeo clave → rol/emoji de Discord (rangos del roster, clases, juegos)
3. `role_templates` — plantillas para crear roles del servidor
4. `admin_role_modules` — permisos de staff: qué módulos del Admin ve cada rol de Discord
5. `xp_configs` — config de XP (niveles, multiplicadores, colores)
6. `xp_profiles` — XP/nivel/contadores por usuario (+ última identidad vista)
7. `audit_log_entries` — registro de auditoría
8. `discord_sessions` / `oauth_states` — OAuth
9. `communications` / `communication_instances` — comunicados y sus publicaciones
10. `daily_messages` — frases del loro de Karpindomo
11. `raid_logs` — logs de raid sincronizados con Warcraft Logs (summary con los pulls)
12. `hub_events` / `event_signups` — eventos e inscripciones
13. `event_player_profiles` / `event_player_characters` — personaje recordado por jugador y PJs del cruce de asistencia
14. `raid_specs` — catálogo de clases/specs por guild y juego
15. `event_images` — biblioteca de imágenes de eventos (data URL, ya re-encuadradas)
16. `roster_profiles` / `roster_alt_profiles` — ficha principal y clases secundarias
17. `karuta_cards` / `karuta_card_images` / `karuta_wishlists` — cartas raras, arte cacheado y wishlists
18. `karuta_albums` / `karuta_album_pages` — álbumes (comando `ka`) y sus páginas cacheadas
19. `member_game_activity` — 1 fila por persona + juego + día (presencias de Discord)
20. `xp_monthly_profiles` — XP y contadores por persona y mes; se escribe en la
    misma operación que `xp_profiles` y alimenta el ranking "Activos del mes" de
    Home. El perfil histórico no se toca: el corte mensual es una fila aparte

## 9. Tareas periódicas

Nada de esto lo dispara una persona y ninguna tarea se re-agenda a sí misma: son
intervalos fijos, con cachés por recurso para que un pico de pedidos no se
multiplique.

`apps/api`:

1. Cada 1 min — cierre de inscripciones, recurrencia y auto-completado de eventos
2. Cada 5 min — refresh de los logs de raid **en vivo** (`raid-logs-sync.ts`): sólo
   `new`/`live` y con tope por pasada (`MAX_REFRESHES_PER_PASS`). Un log ya
   terminado no se vuelve a bajar: era el grueso del egress
3. Cada 15 min — imágenes de cartas y álbumes de Karuta (con throttle de 10 min)
4. Cada 24 h — limpieza de perfiles de XP de quien dejó el servidor

`apps/discord-bot`:

1. Cada 30 s — recordatorios por DM y pedidos de re-sincronización de XP/roles
2. Cada 1 min — voz→XP, control de eventos (recordatorios e informes) y flush de las presencias
3. Cada 2 min — barrido del loro (relee la config y reprograma si cambió)
4. Cada 30 s / 5 s — música: barrido de estados y panel "sonando ahora" (con música activa)

`apps/web` (solo con la pestaña abierta):

1. Cada 30 s — portadas de los juegos más jugados (con caché en `sessionStorage`)
2. Cada 60 s — estado del servidor y ranking

## 9.1 Memoria y costo

Dos cosas que no se ven en el código pero explican la mayoría de las decisiones
de este tipo:

1. **Cache de discord.js.** El cliente descarta `MessageManager`
   (`Options.cacheWithLimits`): los avisos se editan por id, no hace falta tener
   los mensajes en memoria, y ese cache crecía hasta reiniciar el proceso.
2. **Lo que viaja en cada respuesta.** Una imagen embebida como data URL en un
   payload que se pide cada minuto se paga cada minuto. Las imágenes de eventos se
   guardan como data URL (Discord las necesita para el embed) pero el API entrega
   una ruta cacheable (`/public/.../events/:id/image?v=`), y el bot no recibe la
   portada cuando no cambió.
3. **Cachés con tope.** El análisis de un log (`ANALYSIS_CACHE_LIMIT = 8`, TTL 5
   min) y la lista de miembros de la guild en el bot (2 min) existen para no
   repetir trabajo caro, no para guardar historia.

## 10. Decisiones operativas

1. Mantener API como capa de persistencia/negocio.
2. Permitir fallback local para resiliencia en planes con sleep.
3. Sincronizar local -> remoto cuando remoto vuelve y está vacío.
4. Log de auditoría: solo escritura, lectura solo para owner.

## 11. Flujo de comunicados (web -> Discord)

```text
Web (Admin → Comunicados) -> API guarda la plantilla
   -> Publicar -> API crea una instancia (snapshot) y publica en Discord vía REST
   -> El hub muestra las instancias publicadas (tab Comunicados)
```

## 12. Flujo del loro de Karpindomo (mensajes diarios)

```text
Admin (web) configura canal/intervalo/frases -> API guarda en DB
Bot (cada ~2 min) -> lee config + frases habilitadas -> programa un timer aleatorio
   -> publica opener aleatorio + frase aleatoria en el canal
```

## 13. Flujo de Logs de Raid (Warcraft Logs)

```text
Web (Raids -> Logs) -> "Escanear": detecta reports NUEVOS de la guild/realm
   -> API consulta Warcraft Logs y guarda/refresca borradores en raid_logs

API (cada 5 min) -> refresca sólo los logs EN VIVO (new/live, con tope por
   pasada): cantidad de pulls, kills y estado. No crea logs nuevos, saltea los
   que fallaron y no vuelve a bajar un report terminado.

Web -> acción Publicar -> API envía la entrada agrupada al canal de Discord
Web -> acción Actualizar -> API refresca y edita el mensaje publicado
Web -> análisis de la noche -> API pide el detalle del report y lo cruza con los
   anotados del evento; el resultado se cachea 5 min (8 análisis)
Web -> informe del evento (Admin -> Eventos) -> la misma API de asistencia, pero
   pedida por evento: busca el log de esa noche (±14 h) y devuelve quién vino,
   incluidos los del roster esperado que no respondieron (su presencia se cruza
   por el personaje recordado o un PJ ya confirmado, nunca por parecido)
```

El análisis trae los pulls, el DPS promedio, las muertes por habilidad y por
jugador, las flask y la comida que faltaron, y la asistencia real cruzada con las
inscripciones del evento (incluidos los nombres que "se parecen" pero no coinciden).
El informe del historial usa el mismo cruce más el roster esperado del evento: se
rehace ahí (y no dentro del análisis cacheado) porque el roster es del evento, no
del log.

## 14. Módulos del hub y permisos de staff

El panel Admin no es un único bloque: se compone de tarjetas por funcionalidad y
cada una exige acceso a un módulo. El acceso se decide así:

```text
Web -> GET /guilds/:guildId/admin-access -> { owner, modules }
        - owner (dueño del server) => acceso total
        - resto => se leen sus roles de Discord y sus reglas en admin_role_modules
                  -> se obtiene la lista de módulos permitidos
```

1. `enabledModules` (guild_configs) decide qué tabs se muestran en la web.
   Vacío/ausente = todos visibles. Solo el owner lo edita. Es una **lista blanca**:
   un módulo nuevo (Torneos) hay que prenderlo, y la entrada directa por enlace a
   una pestaña apagada rebota al Dashboard.
   Home y Perfil no están en la lista: son la puerta y la ficha de cada persona y
   se ven siempre.
2. `admin_role_modules` asocia roles de Discord a módulos del Admin
   (config, comunicados, raids, daily, xp, karuta, eventos).
3. La UI agrupa el staff en tiers para mostrar quién tiene qué:
   owner (naranja) > admin (dorado) > officer (verde) > sub officer (violeta).
   Los conjuntos de módulos de cada tier viven en `STAFF_TIERS` (web) y
   `STAFF_TIER_MODULES` (API) y tienen que coincidir: config/xp → admin,
   daily/karuta → officer, comunicados/eventos/raids → sub officer. Las páginas
   del panel Admin se muestran según el módulo de cada una (`section.module`).
   La decisión "¿puedo ver Admin?" espera a que `admin-access` responda: si se
   resuelve mientras la respuesta viaja, entrar a `#/admin/...` (o refrescar ahí)
   manda al Dashboard.
4. Los guardados parciales de configuración y los del bot no modifican
   `admin_role_modules`. Esa relación solo se reemplaza cuando el owner guarda
   explícitamente la tarjeta de permisos de staff.

## 15. Sugerencias del hub (web -> DM)

```text
Web (tab Sugerencias) -> POST /guilds/:guildId/suggestions
   -> API resuelve destinatarios:
      suggestionsDmTiers (rangos owner/admin/officer)
      (si no hay ninguno, cae al owner de la guild)
   -> envía el DM por Discord
```

## 16. Tema claro/oscuro y widget de Karpindomo

1. Tema: la web aplica `data-theme="light"` en `<html>` y persiste la elección en
   `localStorage` (`bonafide-theme`). El tema claro redefine variables CSS y las
   superficies oscuras hardcodeadas se adaptan con overrides bajo
   `:root[data-theme="light"]`.
2. Karpindomo (web): FAB de chat flotante con burbuja de frases del asistente;
   aparece solo tras login. Usa clases tipo "widget" para no ser bloqueado por
   adblockers.

## 17. Flujo del Módulo de eventos (web <-> Discord)

```text
Web (Admin → Configuración de eventos)
   -> elige JUEGO (WoW / LoL / …) y edita sus roles + su catálogo
   -> PATCH /guilds/:g/events/games (eventGames) y /events/specs (game)

Web (tab Eventos) / Discord (/evento)
   -> evento con game = <juego>  ->  roles y catálogo de ESE juego

Inscripción
   -> Web: PUT /guilds/:g/events/:id/signups/me
   -> Discord: botones del embed -> PUT /internal/.../signups
   -> el API valida el rol contra el juego del evento y re-renderiza el aviso
```

1. El aviso-embed muestra el tipo en el footer y el roster agrupado por los roles del tipo; quien no eligió rol aparece en la sección "Sin rol".
2. La **repetición** del evento se ve solo en la web: el aviso de Discord (y sus campos) no la muestra.
3. La mención del rol mínimo va pelada en el contenido del mensaje (`<@&rol>`, sin decoración) y se normaliza al refrescar sin re-notificar (`allowed_mentions: { parse: [] }`).
4. Cambiar el tipo de un evento no borra inscripciones: las que tienen un rol de otro tipo pasan a su icono clásico (o "Sin rol").
5. El catálogo se guarda por tipo, así cargar emojis de LoL no toca los de WoW.

## 18. Flujo del roster (fichas, estados y raid leads)

```text
Web (Raids -> Roster) -> GET /guilds/:g/roster -> fichas + rangos + clase de cada uno
Cada persona -> PUT /guilds/:g/roster/me  ("Agregar/Modificar mi ficha")
Staff -> estado (raid | bench | null) -> API cambia el rol de Discord y registra la acción
Home -> GET /guilds/:g/raid-leads -> los que tienen el rol de Raid Officer, por XP
```

1. El estado de la tarjeta es exactamente el rol de Discord que tiene el miembro:
   el API pone el rol del rango pedido y saca los otros estados (el de Raid Officer
   no se toca desde acá).
2. Las **clases secundarias** ("alter") se guardan en su propia tabla y no cuentan
   para ningún total.
3. Sumar a alguien del servidor que no tiene ficha la crea **vacía**, y queda "sin
   asignar" hasta que el staff le ponga estado.
4. El nombre de la persona siempre viaja como `Nick (usuario)`, también en el
   registro de auditoría.

## 19. Flujo de Karuta (cartas raras, wishlists y álbumes)

```text
Bot (canal vigilado) -> lee los mensajes de Karuta (kv / ka / kg) y las reacciones
   -> POST /internal/guilds/:g/karuta/cards  (posesión, print, wishlist)
Backfill -> recorre el historial del canal para completar wishlists viejas

API (cada 15 min) -> renueva el arte de las cartas y las páginas de los álbumes
   (se guardan los bytes propios: las URLs de Discord vencen)

Web (tab Karuta) -> Raras, Colecciones y la guía de comandos
```

1. Se guardan los **bytes** de cada imagen y no el link: los enlaces firmados de
   Discord expiran y el arte se perdía.
2. Los umbrales de rareza (print / wishlist) se configuran en el Admin y deciden
   qué entra en la lista de raras.

## 20. Flujo de Home y del perfil

Ninguna de las dos escribe nada: son vistas que juntan lo que ya existe.

```text
Home -> GET /guilds/:g/boosters          (quién banca el Nitro)
      -> GET /guilds/:g/xp/leaderboard   (podio: top 5 por nivel)
      -> GET /guilds/:g/raid-leads       (raid officers, por XP)
      -> GET /guilds/:g/xp/leaderboard/monthly  (activos del mes)
      -> GET /guilds/:g/widget           (miembros, online, boosts)

Perfil -> GET /guilds/:g/members/:userId
      -> identidad y roles: del bot (avatar, banner, roles con color, booster, antigüedad)
      -> xp, mensajes, minutos en voz y puesto en el ranking: xp_profiles
      -> activity: { xp, month, games[], karutaCards }
            month  -> xp_monthly_profiles
            games  -> member_game_activity, con las portadas que ya usa el dashboard
            cartas -> karuta_cards
```

1. El **corte mensual** se escribe cuando se suma XP, no cuando se consulta: por
   eso `addXp` toca `xp_profiles` y `xp_monthly_profiles` en la misma operación.
2. Los **juegos más jugados** de una persona ordenan por días jugados (a una
   persona le importa la constancia); el dashboard de la guild ordena por cuánta
   gente distinta jugó cada juego.
3. Las portadas no viven en la base: el API resuelve el `cover_image_hash` de la
   aplicación de Discord (cache de 24 h) y arma la URL de la CDN; el hub se queda
   con esas URLs en el navegador para que no aparezcan de golpe al cambiar de
   pestaña.
