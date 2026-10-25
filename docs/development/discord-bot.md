# Discord Bot Guide

## 1. Stack

1. Node.js >= 20
2. TypeScript
3. discord.js v14

## 2. Comandos disponibles

### Perfil y ranking

1. `/profile [usuario]` — tarjeta del miembro (o tuya, si no pasás usuario): avatar
   y banner, rol más alto como color, booster, antigüedad, nivel, XP, mensajes,
   tiempo en voz y barra de progreso al siguiente nivel.
2. `/ranking` — top 20 por XP: banner con el podio en imagen (top 3) y la tabla del
   4 al 20; al pie, tu propia posición.

### Estadísticas

1. `/memberstats [publico]`
2. `/rolstats rol:<rol> [listar] [publico]`

### Timers (aviso por DM)

1. `/settimer [segundos] [minutos] [horas] [repetir]` — combina unidades; rango 1s a 7 días
2. `/listtimers`
3. `/canceltimer id:<id>` (requiere Manage Server)
4. `/removetimer` — borra los timers propios

### Comunicados

1. Los comunicados se administran y publican desde la **web** (Admin → Comunicados): el API publica en Discord vía REST y en el hub.
2. El comando `/publicarcomunicado` fue retirado del bot (ya no se usa).

### Loro de Karpindomo (mensajes diarios)

1. No es un comando: el bot publica frases aleatorias con **openers estilo mayordomo** a intervalos aleatorios (min/max minutos) en el canal configurado.
2. Config desde la web (Admin → Mensajes Diarios): canal, activado, intervalo y frases.
3. El scheduler relee la config cada ~2 min (aplica cambios sin reiniciar).

### XP (niveles)

1. `/addlvl usuario:<usuario> niveles:<n>` (Manage Server)
2. `/removelvl usuario:<usuario> niveles:<n>` (Manage Server)
3. `/setlvl usuario:<usuario> nivel:<n>` (Manage Server)
4. `/resetlvl usuario:<usuario>` (Manage Server)

### Música

1. `/play cancion:<texto o URL> [fuente:youtube|soundcloud]` — reproduce o encola un tema (YouTube por defecto; SoundCloud funciona desde IPs de datacenter, YouTube no)
2. `/pause`, `/resume`
3. `/skip`
4. `/queue`
5. `/nowplaying`
6. `/volume nivel:<0-200>`
7. `/stop` — detiene y limpia cola
8. `/leave` — sale del canal
   > Al reproducir se manda un **player embed con botones** (estilo Rythm) en el canal:
   > ⏯️ pausar/reanudar, ⏭️ saltar, ⏹️ detener, 👋 salir, 🔉/🔊 volumen, 📜 cola. Se actualiza solo.
   > Streaming con `yt-dlp` (vía `youtube-dl-exec`) + `@discordjs/voice`. El bot se desconecta solo cuando el canal queda sin oyentes (15s de gracia) o tras 60s de inactividad.
   > **Permisos DJ**: para detener/desconectar (`/stop`, `/leave` y botones ⏹️/👋) hay que estar en el **mismo canal de voz** que el bot (además del rol DJ configurado).
   > El fallback a SoundCloud **deduplica por título** para no encolar copias del mismo tema.

### Salas de voz dinámicas

Al entrar al canal creador (`dynamicVoiceCreateChannelId`) el bot abre una sala
propia, mueve a la persona y borra la sala cuando queda vacía.

**Dónde se crean:** debajo del canal creador, dentro de su categoría. La sala se
crea sin `parent` ni `position` y después se ubica en dos pasos explícitos
(`setParent` y `setPosition` con el índice del creador + 1), porque mandar las dos
cosas en el `create` no era confiable: en producción la sala terminaba fuera de la
categoría, al final de la lista. Al final se relee el canal y el log dice dónde
quedó de verdad, con nombres además de IDs.

**La categoría se puede fijar a mano** en *Admin → Configuraciones → Categoría de
las salas* (`dynamicVoiceCategoryId`). Si está vacía se usa la del canal creador.
Sirve para servidores con dos categorías del mismo nombre, donde "la del canal" no
alcanza para saber cuál es la buena; el selector muestra la posición cuando hay
nombres repetidos. Al arrancar, el bot además barre las salas registradas: borra
las vacías y saca de la lista las que ya no existen, para que no queden salas
huérfanas de intentos anteriores.

Solo funcionan dentro de la sala de voz temporal propia (creada por Karpindomo).

1. `/desperuanizar` — oculta la sala a los roles vetados (`bannedVoiceRoleIds`); agrega el sufijo ` 🚫🇵🇪` al nombre.
2. `/reperuanizar` — revierte `/desperuanizar`; quita el sufijo.
3. `/lock` — tranca la sala para `@everyone` (deniega Connect): los que ya están adentro se quedan, nadie nuevo puede entrar; agrega el sufijo ` 🔒`.
4. `/unlock` — revierte `/lock`; quita el sufijo.

## 3. Eventos y automatizaciones

1. `GuildMemberAdd` → asigna rol de entrada (`defaultRoleId`) y log de entrada
2. `GuildMemberRemove` → log de salida (con el nombre de la persona: `Nick (usuario)`,
   el nick del servidor o si no el nombre de la cuenta; si el evento llega con un
   miembro parcial se pide la cuenta con `users.fetch`, que existe aunque ya no esté
   en la guild, para no terminar mostrando un id)
3. `MessageCreate` → XP por mensaje (cooldown anti-spam)
4. `VoiceStateUpdate` → XP por tiempo en voz + salas de voz dinámicas
5. Polling de `xpSyncRequested` → re-sincroniza roles/nicknames por nivel
6. Scheduler de timers → avisa por DM al vencer (con opción de repetir)
7. Scheduler del loro → publica una frase aleatoria a intervalos aleatorios (relee config cada ~2 min)
8. `MessageCreate`/`MessageUpdate` (Karuta) → detecta cartas raras (`kv`), su colección (`ka`) y transferencias (`kg`/grab) en el canal vigilado y las guarda en la API
9. `PresenceUpdate` → juegos que se juegan en el server (ver abajo)

### Juegos que se juegan en el server

Discord **no expone por API** los Server Insights (el panel donde el cliente
muestra los juegos del servidor), así que la agregación la hace el bot:

```text
PresenceUpdate (intent GuildPresences, ya habilitado)
   -> actividad tipo "Playing" con applicationId
   -> POST /internal/guilds/:g/games/presence (x-bot-token)
   -> tabla member_game_activity: 1 fila por persona + juego + DÍA
   -> GET /guilds/:g/games/activity -> grilla del dashboard
```

1. Solo se reporta cuando el juego **cambia** (o aparece uno nuevo), y el flush
   agrupa cada 60 s: el Gateway dispara muchísimos `PresenceUpdate` y no
   queremos una request por cada uno.
2. Solo aparece quien **comparte su actividad** y está online mientras el bot
   corre. Discord no da historial: el panel arranca vacío y se va llenando.
3. El API ordena la lista por cantidad de jugadores distintos; la web muestra
   las portadas (hoy sin arte, con el nombre) en el dashboard. El perfil de un
   miembro usa la misma tabla para sus **juegos más jugados** (ahí ordena por
   días, que es lo que importa cuando se mira a una persona).

### Recordatorios de asistencia: el marcador y la lista tienen que hablar de lo mismo

El bot recibe los recordatorios vencidos por `GET /internal/.../events/control`
y avisa que ya los mandó por `POST /internal/.../events/:id/reminders-sent`. Si
esas dos cosas no coinciden, el recordatorio **se repite en cada pasada** (cada
60 s, para siempre): pasó con eventos viejos que tenían **48 h** guardadas
mientras el marcador solo aceptaba 24 h y 2 h, así que nunca se guardaba nada.

Dos defensas, en ese orden:

1. La lista de vencidos filtra las horas con el **mismo** normalizador que el
   form (`normalizeEventReminderHours` en `events-store`), y el marcador guarda
   las horas tal como las reporta el bot (sin filtro): si el aviso salió, queda
   registrado.
2. El bot no repite el mismo aviso (evento + horas) antes de 6 h, aunque el API
   no haya guardado el marcador.

**La lista de miembros se cachea.** `guild.members.fetch()` sin argumentos baja
la guild entera por REST (varios MB), y el control corre cada minuto: se pide una
vez cada 2 minutos y el roster por rol se reusa dentro de la misma pasada. Un
bucle de recordatorios, además de spamear el canal, multiplicaba ese gasto de
egress.

### Inscripciones a eventos (Módulo X)

El API publica el aviso-embed del evento con botones (`eventsign:{eventId}:{accion}`);
el bot maneja los clicks con mensajes efímeros y guarda por API interna:

```text
✅ Asistir / ⏰ Tarde / 🪑 Bench / ❌ No asisto
   -> si ya sabemos clase/spec: se registra directo
   -> si no: asistente rol -> clase/spec (catálogo del juego del evento)
   -> ⚙️ Clase y spec · ✏️ Personaje · 🔄 Resetear · 🗑️ Quitar inscripción
```

1. Los roles del asistente salen del **juego del evento**: el bot pide
   `GET /internal/guilds/:g/events/specs?game=<juego>` con el `game` que trae el evento.
2. **Recuerda clase, spec y rol.** Al pedir el evento con `?userId=` el API
   devuelve, además del personaje recordado (`event.playerCharacter` y la clase
   con la que lo usó), `event.playerClass` / `event.playerSpec` /
   `event.playerRole`. Esa memoria sale de la **ficha del roster** del mismo
   juego y, si el jugador no tiene ficha, de su **última inscripción** del mismo
   juego. Con eso el botón de estado guarda la inscripción sin abrir el
   asistente, así que no se le pide clase y spec en cada raid; el mensaje
   confirma con qué quedó (`Registrado: Asistir · Warrior — Fury`). Para
   cambiarlas está el botón **⚙️ Clase y spec**, que sí abre el asistente.
3. **Nombre de personaje obligatorio**: si el evento lo pide y el jugador no tiene
   ninguno (ni en este evento ni recordado de antes), NO se guarda la inscripción:
   se abre el modal (obligatorio) y la inscripción se completa cuando lo envía.
   El personaje recordado sólo vale para **su** clase: si el jugador cambia de
   clase se entiende que juega otro PJ y se le vuelve a pedir el nombre.
4. Los recordatorios de asistencia y los informes de "no se anotaron" los dispara
   el scheduler del bot consultando `GET /internal/.../events/control`. Cada
   evento de ese payload trae `benchRoleId` (el rol de Bench del roster) cuando el
   evento es de WoW: los dos roles suman a la hora de contar, avisar y listar,
   porque el bench es parte del roster. En el informe el bench va en un campo
   aparte, para que no se lea como si faltara el core. El **recordatorio manual**
   de "anotate" (`POST .../events/:eventId/remind`) no pasa por acá: lo manda el
   API con `sendDirectMessage` (token del bot) cuando el staff lo pide desde el
   control del roster.

### Karuta (cartas raras y wishlists)

`kv` (ver carta) es lo único que registra cartas en la colección; `ka` guarda
álbumes y `grab`/`kg` transfieren el dueño. El criterio de rareza es OR:
`print <= karutaRarePrintMax` **o** `wishlist >= karutaRareWishlistMin`.

Karuta NO muestra la wishlist en `kv`: la aporta Card Companion al dropear. El
bot la resuelve en cascada y la usa tanto en el `kv` como en el `grab`:

```text
kv / grab de una carta
   -> 1. aviso FRESCO de Card Companion en el canal (memoria, 15 min)
   -> 2. caché en memoria de wishlists vistas (30 min)
   -> 3. base de datos (karuta_wishlists), vía API interna
   -> si no está: la carta solo puede entrar por el criterio de print
```

La tabla `karuta_wishlists` se llena con cada aviso que el bot ve **en vivo**.
Para los huecos (bot caído, o avisos anteriores a que existiera la tabla) el bot
lee el historial del canal al arrancar (`KARUTA_WISHLIST_BACKFILL_MESSAGES`,
default 1000, máximo 5000) y guarda lo que encuentra. Es idempotente: se puede
correr en cada reinicio sin duplicar nada. La clave es el nombre normalizado de
la carta (no el código), así que un `kv` posterior de cualquier copia ya la ve.

Card Companion cambia de formato seguido. Desde 2026-09 manda **Components V2**
(`type: 19` + `flags: IsComponentsV2`): `content` y `embeds` vienen **vacíos** y
el texto vive en los componentes (`container.components[].content`). Por eso
`collectKarutaMessageTexts()` recolecta las TRES fuentes (content, embeds y
componentes anidados). Si vuelven a faltar wishlists, comparar el JSON crudo del
mensaje (`GET /channels/:id/messages`) con lo que espera `parseCardCompanionDrop`:
el log del backfill dice cuántos mensajes de otros bots vio y cuántos traían `♡`.

### El tono de Karpindomo (frases aleatorias)

Karpindomo es el mayordomo de la comunidad: un capincho que habla en "usted", dice
"Señor/Senior", arranca con un emoji y cierra con un remate. No es cosmético: es
la voz del bot en todos los avisos que la gente ve.

Su nombre completo es el chiste: **D.E.R.E.K. — Desperuanizador Elegante,
Regordete y Educado, Karpindomo**. En el acta es el D.E.R.E.K.; en el canal es
Karpindomo. Varias frases lo presentan con el nombre entero o con las siglas: es
la forma de que el chiste circule sin colarlo en todas.

Cada aviso sale de un **repertorio** (`pickRandom` sobre un array) en vez de un
texto fijo, así el servidor no lee la misma frase dos veces:

| Aviso | Dónde | Repertorio |
| --- | --- | --- |
| Entrada al servidor | `formatWelcomeMessage` | `WELCOME_TEMPLATES` |
| Salida, kick o ban | `formatLeaveMessage` | `FAREWELL_TEMPLATES` / `KICK_TEMPLATES` / `BAN_TEMPLATES` (según el audit log) |
| Subida de nivel | anuncio de rank | `LEVEL_UP_TEMPLATES` |
| Timer creado | `/settimer` (respuesta privada) | `timerReplies` |
| Recordatorio de timer | scheduler → DM | `TIMER_TEMPLATES` |
| Sala trancada / destrancada | `/lock` / `/unlock` | `LOCK_CHANNEL_BUTLER_MESSAGES` / `UNLOCK_CHANNEL_BUTLER_MESSAGES` |
| Sala oculta / visible | `/desperuanizar` / `/reperuanizar` | `BAN_CHANNEL_BUTLER_MESSAGES` / `UNBAN_CHANNEL_BUTLER_MESSAGES` |
| Mensaje del loro | `postRandomMessage` | `BUTLER_OPENERS` + la frase que escribió el staff |
| Burbuja del hub | `KarpindomoWidget` (web) | `KARPINDOMO_LINES` |

Dos reglas para agregar frases:

1. **No perder datos.** El texto puede cambiar entero, pero lo que el aviso
   informa tiene que seguir estando: el id de la persona (`-# <@id>` en el pie del
   log de salida, que sobrevive aunque cambie el nick), el motivo del ban o kick
   (`{reason}`), quién lo hizo (`{moderator}`) y la hora del timer (`<t:…:R>`).
2. **No cambiar el significado de una respuesta de comando.** Las respuestas
   efímeras de confirmación o de error dicen lo mismo en todas sus variantes: si
   el aviso dice que el comando solo sirve dentro de una sala temporal, tiene que
   entenderse, por más florida que sea la frase.

## 4. Sistema de XP

1. XP por mensaje (`messageXp`) y por minuto en voz (`voiceXpPerMinute`).
2. Cooldown anti-spam por usuario.
3. Niveles con fórmula triangular (`levelBaseXp`).
4. Roles por nivel (acumular o reemplazar) + roles extra (add/remove).
5. Adorno de nivel al final del nickname (idempotente: se limpia de las dos
   puntas, así los nicks viejos con el adorno adelante se normalizan solos).
6. Anuncios de rank (solo al subir de rango).
7. Multiplicadores de XP por rol. Los de los roles que tenga la persona **se
   suman** (x2 con x3 da x5), no se multiplican: multiplicar hacía que dos roles
   chicos explotaran el XP sin que se pudiera predecir mirando la tabla.
8. Adorno de multiplicador: cada rol con multiplicador puede tener el suyo y va
   **después** del de nivel, pegado al anterior (`Juan⭐🔥👑`). Van sin espacios
   a propósito: con separación, tres adornos se comían el nick. Se aplica cuando
   el miembro sube de nivel o cuando corre la sincronización desde el panel; no
   hay listener de cambio de roles, así que darle el rol a alguien no cambia el
   nick al instante.
9. **El sync rearma el nick desde cero, no lo parchea.** Antes de aplicar los
   adornos se limpia el tramo de símbolos pegado al final y se descartan los
   repetidos, así se van los adornos duplicados, los que ya no están en la config
   y los que quedaron con otro selector de variación (`⭐` vs `⭐️`). Si el
   miembro perdió el rol, sus adornos también se van. Un emoji **separado por un
   espacio** se respeta: ese lo puso la persona, el bot siempre pega el adorno.
10. Cap de nivel (`maxLevel`; 0 = sin límite).
11. Config completa desde la web (Admin → Sistema de XP), incluidos colores por rango para el hub.
12. Cada suma de XP (mensaje o voz) se acumula también en el corte del mes (`xp_monthly_profiles`, ver [api](./api.md)): es lo que muestra el ranking "Activos del mes" de Home.

## 5. Variables de entorno del bot

Archivo ejemplo: `apps/discord-bot/.env.example`

1. `DISCORD_BOT_TOKEN` — login
2. `DISCORD_APPLICATION_ID` — registro slash
3. `DISCORD_GUILD_ID` — registro slash
4. `BOT_CONFIG_API_URL` — config remota (API)
5. `BOT_CONFIG_API_TOKEN` — auth hacia API
6. `BOT_DISABLED` — si es true, no hace login
7. `YOUTUBE_COOKIE` — opcional: cookies de navegador de YouTube (mitiga 429/403 en IPs de datacenter)
8. `YOUTUBE_DL_BIN` — opcional: ruta al binario de `yt-dlp` si no se encuentra en PATH ni se descarga automáticamente
9. `KARUTA_WISHLIST_BACKFILL_MESSAGES` — opcional: cuántos mensajes del canal de Karuta revisar al arrancar para recuperar las wishlists que Card Companion anunció con el bot caído (default 1000, máximo 5000, `0` desactiva)

## 6. Permisos recomendados

1. View Channels
2. Send Messages
3. Read Message History
4. Manage Channels (voz dinámica)
5. Move Members (voz dinámica)
6. Connect / Speak (voz)
7. Manage Roles (roles por nivel, rol de entrada)

Notas:

1. El rol del bot debe estar por encima de los roles que intenta asignar/remover.
2. Para debugging rápido Admin funciona, pero no es ideal a largo plazo.

## 7. Persistencia del bot

1. Principal: API + DB vía endpoint interno.
2. Fallback: `apps/discord-bot/data/guild-config.json`.
3. Los timers se guardan en `apps/discord-bot/data/reminders.json`.

> El bot **solo escribe sus propios campos** de config (salas
> temporales, canales del loro, rol de entrada, etc.). Los campos del hub
> (módulos activables, sugerencias, permisos de staff, logs de raid) se
> preservan: el PUT interno de config es un merge selectivo y el bot no los
> pisa. Esto evita que los módulos ocultos vuelvan a aparecer solos.

## 8. Flujo recomendado de cambios

1. Cambiar código en local.
2. `npm run build`.
3. Si tocaste slash commands: `npm run register`.
4. Validar en Discord.
5. Push a branch/main y deploy en Railway.
