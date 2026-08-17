# Discord Bot Guide

Guía técnica y funcional del bot de Discord.

## 1. Stack

1. Node.js >= 20
2. TypeScript
3. discord.js v14

## 2. Comandos disponibles

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

> Los comandos de reaction roles por Discord fueron retirados: los paneles se administran desde la web (Admin → Reaction Roles) y el bot los publica vía jobs encolados.

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

## 3. Eventos y automatizaciones

1. `GuildMemberAdd` → asigna rol de entrada (`defaultRoleId`) y log de entrada
2. `GuildMemberRemove` → log de salida
3. `MessageCreate` → XP por mensaje (cooldown anti-spam)
4. `VoiceStateUpdate` → XP por tiempo en voz + salas de voz dinámicas
5. `MessageReactionAdd/Remove` → asigna/quita roles de reaction roles
6. Polling de jobs de reaction roles (~20s) → crea/edita/borra paneles pedidos desde la web
7. Polling de `xpSyncRequested` → re-sincroniza roles/nicknames por nivel
8. Scheduler de timers → avisa por DM al vencer (con opción de repetir)
9. Scheduler del loro → publica una frase aleatoria a intervalos aleatorios (relee config cada ~2 min)

## 4. Sistema de XP

1. XP por mensaje (`messageXp`) y por minuto en voz (`voiceXpPerMinute`).
2. Cooldown anti-spam por usuario.
3. Niveles con fórmula triangular (`levelBaseXp`).
4. Roles por nivel (acumular o reemplazar) + roles extra (add/remove).
5. Prefijo de nickname por nivel (idempotente).
6. Anuncios de rank (solo al subir de rango).
7. Multiplicadores de XP por rol.
8. Cap de nivel (`maxLevel`; 0 = sin límite).
9. Config completa desde la web (Admin → Sistema de XP), incluidos colores por rango para el hub.

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

## 6. Permisos recomendados

1. View Channels
2. Send Messages
3. Read Message History
4. Add Reactions
5. Manage Channels (voz dinámica)
6. Move Members (voz dinámica)
7. Connect / Speak (voz)
8. Manage Roles (roles por nivel, reaction roles, rol de entrada)

Notas:

1. El rol del bot debe estar por encima de los roles que intenta asignar/remover.
2. Para debugging rápido Admin funciona, pero no es ideal a largo plazo.

## 7. Persistencia del bot

1. Principal: API + DB vía endpoint interno.
2. Fallback: `apps/discord-bot/data/guild-config.json`.
3. Los timers se guardan en `apps/discord-bot/data/reminders.json`.

## 8. Flujo recomendado de cambios

1. Cambiar código en local.
2. `npm run build`.
3. Si tocaste slash commands: `npm run register`.
4. Validar en Discord.
5. Push a branch/main y deploy en Railway.
