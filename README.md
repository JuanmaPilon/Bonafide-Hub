# Bonafide Hub

Hub web + bot de Discord para una comunidad de World of Warcraft. Lo que el staff
hacía a mano (configurar el servidor, organizar raids y eventos, avisar cosas,
llevar el roster) vive en una sola app, y el bot se ocupa de lo que pasa dentro de
Discord.

Son tres piezas que comparten la misma base de datos:

- **El hub** (`apps/web`): donde la comunidad consulta su información y el staff administra.
- **El bot** (`apps/discord-bot`): lo que ocurre dentro de Discord (niveles, salas de voz, música, avisos).
- **La API** (`apps/api`): el cerebro y la memoria compartida entre los dos.

Proyecto en desarrollo activo. La app se usa a diario con una comunidad real.

## Para qué sirve

**Para cualquiera del servidor:** ver su nivel y su ranking, abrir su perfil con
sus roles, leer los comunicados, anotarse a los eventos, completar su ficha del
roster, mirar las cartas raras de la comunidad y mandar una sugerencia al staff.

**Para los officers:** organizar raids y eventos, publicar avisos, ordenar el
roster, escribir los mensajes del loro de Karpindomo, dar o quitar XP y revisar
cómo salió cada noche de raid.

**Para el owner:** todo lo anterior, más qué módulos ve la gente, los mapeos con
Discord, los permisos por rol y el registro de todo lo que se cambió.

## La app, módulo por módulo

### Inicio

La vidriera de la comunidad. Arriba y bien grande, los **boosters** de Nitro (los
que bancan el server) en tarjetas; abajo, lado a lado, el **podio** con el top 5
por XP y los **raid leads** (los officers de raid del roster, ordenados por XP).

### Dashboard

El estado del servidor de un vistazo: cuántos hay conectados, cuántos miembros y
cuántos boosts tiene, los **juegos más jugados** de los últimos 30 días (con las
portadas, que se guardan en el navegador para que no aparezcan de golpe) y el
**ranking por XP** con los colores de cada nivel.

### Comunicados

Los anuncios ya publicados, con buscador, etiquetas y orden personalizado por el
staff. Un comunicado se escribe una vez en el panel y sale en Discord y en la web.

### Raids

Dos pestañas:

- **Roster**: la ficha de cada persona (clase, spec, offs, etiquetas y clases
  secundarias) y su estado (raid, bench, inactivo o sin asignar), con filtros y
  contador de jugadores. Cada uno modifica su propia ficha desde el hub; el staff
  puede sumar a alguien que todavía no la tenga.
- **Logs**: los logs de Warcraft Logs. Se escanean los reportes de la guild, se
  revisan como borradores, se publican en un canal de Discord y se actualizan
  cuando el report crece. Cada noche tiene su **análisis**: los pulls, el DPS
  promedio, las muertes por habilidad y por jugador, las flask y la comida que
  faltaron, y la **asistencia real** (quién apareció en el log) cruzada con quién
  se había anotado.

### Eventos

Eventos de cualquier juego del servidor (WoW, LoL y los que se agreguen), con
roles de inscripción propios de cada juego. Se arma con plantillas, se define
cierre de inscripciones, recordatorios y repetición, y se publica como evento de
Discord y/o como aviso con botones en un canal: la gente se anota desde Discord y
el roster del aviso se actualiza solo. Al terminar queda el informe de asistencia
y el historial.

### Karuta

El juego de cartas de la comunidad: qué cartas raras aparecieron (con su print y
las wishlists), las colecciones de cada uno y una guía de los comandos de Karuta.

### Sugerencias

Un formulario que llega por mensaje privado a los rangos que el staff haya
elegido.

### Panel Admin

Todas las tarjetas de administración, cada una visible solo para el rango que
corresponde:

| Sección | Para qué |
| --- | --- |
| Configuraciones | Canales, rol de entrada, sugerencias, logs de raid |
| Mapeo | Qué rol de Discord es cada cosa (rangos del roster, clases, juegos) |
| Roles | Crear y editar roles del servidor, con sus colores |
| Módulos | Qué módulos ve la comunidad en el hub |
| Permisos | Qué rango de Discord ve cada tarjeta del panel |
| XP | Niveles, XP por mensaje y por voz, roles y colores de nivel |
| Karpindomo | Canal, intervalo y frases del loro |
| Karuta | Canal vigilado y umbrales de rareza |
| Plantillas | El catálogo de tipos de evento |
| Eventos | El historial en calendario, con buscador y el detalle de cada noche |
| Registros | Auditoría: quién cambió qué y cuándo |

### Perfil, tema y Karpindomo

El chip del usuario abre su perfil (roles con sus colores, booster, antigüedad).
Hay tema claro y oscuro, y una burbuja de chat de **Karpindomo**, el asistente de
la comunidad, que aparece con frases cada tanto.

## El bot

| Comando | Para qué |
| --- | --- |
| `/profile [usuario]` | Tarjeta con avatar, roles, nivel, XP, mensajes, voz y progreso |
| `/ranking` | Top 20 por XP, con banner de podio en imagen |
| `/memberstats`, `/rolstats` | Cuánta gente tiene cada rol o cada nivel |
| `/settimer`, `/listtimers`, `/canceltimer`, `/removetimer` | Avisos por mensaje privado, con repetición |
| `/play`, `/pause`, `/resume`, `/skip`, `/queue`, `/nowplaying`, `/volume`, `/stop`, `/leave` | Música en el canal de voz, con un panel de botones |
| `/lock`, `/unlock` | Trancar y destrancar la sala de voz propia |
| `/desperuanizar`, `/reperuanizar` | Ocultar la sala propia a los roles vetados y revertirlo |
| `/addlvl`, `/removelvl`, `/setlvl`, `/resetlvl` | Niveles del sistema de XP (staff) |

Más los **botones** de los avisos de eventos, que maneja el bot con respuestas
privadas: anotarse, cambiar de estado, elegir clase y spec, poner el personaje o
quitarse.

## Lo que pasa solo

- Entrada y salida de miembros: se registran en el canal de logs configurado, con
  el nombre de la persona.
- Al entrar al servidor se asigna el rol de entrada.
- Se gana XP por escribir (con anti-spam) y por tiempo en voz.
- Los roles y los prefijos de nombre por nivel se sincronizan solos.
- Las salas de voz temporales se crean al entrar y se borran al quedar vacías.
- El loro publica sus frases a intervalos aleatorios.
- Los logs de raid en curso se refrescan cada 5 minutos.
- Los juegos que se juegan se toman de las presencias de Discord.
- Los recordatorios de eventos, el cierre de inscripciones y la recurrencia se
  resuelven sin que nadie apriete nada.
- Los perfiles de XP de quien se fue del servidor se limpian una vez por día.

## Tecnologías

| Pieza | Tecnología |
| --- | --- |
| Hub web | React + Vite + TypeScript |
| API | Node.js + Fastify + Prisma + Zod |
| Bot | discord.js v14 + @discordjs/voice + yt-dlp/ffmpeg |
| Base de datos | PostgreSQL |
| Hosting | Railway (API, bot, web y base) |
| DNS/CDN | Cloudflare (delante del dominio) |
| Iconos y gráficos del bot | @phosphor-icons/react, @napi-rs/canvas |
| Export de la web | marked + DOMPurify, jsPDF + html2canvas |
| CI | GitHub Actions (`Repository Guard`) |

## Estructura del repo

```text
apps/
  api/           API HTTP, sesiones, persistencia y publicación en Discord
  discord-bot/   Bot: comandos, eventos, XP, música, salas de voz
  web/           Hub en React (Inicio, Dashboard, Raids, Eventos, Admin)

docs/
  development/   Documentación técnica y operativa

.github/         Plantilla de PR, workflows y reglas del repo
```

## Levantarlo en local

Cada app se instala y arranca por su cuenta. Todas leen su configuración de un
`.env` propio (hay un `.env.example` en cada una, sin secretos):

```bash
# API (necesita un PostgreSQL: ver apps/api/.env.example)
cd apps/api && npm install && npx prisma db push && npm run dev

# Bot
cd apps/discord-bot && npm install && npm run register && npm run dev

# Web
cd apps/web && npm install && npm run dev
```

El bot tiene un modo de respaldo: si la API no responde, sigue funcionando con la
configuración local que guarda en disco.

## Documentación

| Documento | Qué vas a encontrar |
| --- | --- |
| [docs/README.md](docs/README.md) | Índice de la documentación |
| [docs/development/architecture.md](docs/development/architecture.md) | Cómo está armado todo y cómo se hablan las piezas |
| [docs/development/api.md](docs/development/api.md) | La app en detalle: qué hace cada módulo de la web y cada endpoint |
| [docs/development/discord-bot.md](docs/development/discord-bot.md) | El bot: comandos, eventos y automatizaciones |
| [docs/development/railway-operations.md](docs/development/railway-operations.md) | Despliegue, variables, límites de costo y diagnóstico |

## Seguridad y datos

- No hay secretos en el repo: las credenciales se cargan por variables de entorno
  (`.env`, ignorado por git).
- Este repositorio no contiene datos de la comunidad: la base vive en el hosting.
- El bot usa el principio de mínimo privilegio y los intents que necesita.
- El registro de auditoría es de solo lectura desde la app: no se puede editar ni
  borrar, y solo lo ve el owner.