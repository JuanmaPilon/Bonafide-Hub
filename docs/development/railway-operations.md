# Railway Operations

## 1. Servicios

1. `Discord_BOT`
2. `API`
3. `PRD_DB` (PostgreSQL)
4. `Web` (frontend estático de Vite; URL pública de la comunidad)

Dominio propio: `bonafide-cum.com` (web y callback de OAuth). El `vite.config.ts`
de la web incluye `allowedHosts` para `bonafide-cum.com` y sus subdominios.

## 2. Variables por servicio

### Bot

1. `DISCORD_BOT_TOKEN`
2. `DISCORD_APPLICATION_ID`
3. `DISCORD_GUILD_ID`
4. `BOT_CONFIG_API_URL`
5. `BOT_CONFIG_API_TOKEN`
6. `BOT_DISABLED`

### API

1. `DATABASE_URL`
2. `DISCORD_CLIENT_ID`
3. `DISCORD_CLIENT_SECRET`
4. `DISCORD_REDIRECT_URI`
5. `SESSION_SECRET`
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
16. `PUBLIC_API_URL` — URL pública de esta API (por ejemplo
    `https://tu-api.up.railway.app`), para que Discord pueda bajar la imagen de un
    evento. Si no está, se usa `RAILWAY_PUBLIC_DOMAIN`, que Railway expone solo.

### Web

1. `VITE_API_BASE_URL` (`/api`)
2. `VITE_API_TARGET` — URL real de la API para el proxy del preview
3. `VITE_SITE_URL` (opcional) — dominio público del hub, para la URL absoluta de
   `og:image` (la imagen que se ve al compartir el link). Si no está, el build usa
   `https://bonafide-cum.com`.

## 3. Comandos recomendados de deploy

> **Orden de deploy:** primero API (corre `prisma db push` y crea las tablas nuevas), luego Web y Bot.
> ⚠️ Cada servicio tiene sus propias Variables; el token del bot debe estar en el **Bot** y en el **API** por separado (y actualizarse en ambos si se rota).

### API

1. Pre-deploy: `npx prisma db push --accept-data-loss`
   - Crea/actualiza las tablas nuevas del schema (ej. `audit_log_entries`, `admin_role_modules`, `communications`, `daily_messages`, `raid_logs`, `event_player_characters`, `karuta_album_pages`).
   - ⚠️ **Usar `--accept-data-loss`**: cuando el schema quita columnas/tablas (p. ej. al eliminar un módulo, como se hizo con `karuta_drops` y `karuta_debug_events`), un `prisma db push` pelado **falla** y el deploy de la API no avanza. Con el flag, borra solo lo que ya no está en `schema.prisma`.
2. Build: `npm ci --include=dev && npm run build`
3. Start: `npm run start`

### Bot

1. Build: `npm ci && npm run build`
2. Start: `npm run start`

Opcional:

1. Pre-deploy bot: `npm run register`

- solo si quieres registrar slash en cada deploy

## 4. API dormida y fallback del bot

Si la API duerme:

1. El bot intenta remoto.
2. Si remoto falla, usa fallback local.
3. Mantiene funcionalidades criticas (ej. voice dinamico).

## 5. Diagnostico rapido

### Error de variables Required

1. Revisar variables en servicio correcto.
2. Revisar environment correcto (Production vs Preview).
3. Guardar cambios y redeploy.

### Error DATABASE_URL missing (Prisma)

1. Verificar `DATABASE_URL` en servicio API.
2. Verificar referencia a DB.
3. Redeploy.

### Bot no mueve usuarios / no elimina salas

1. Verificar permisos de Discord (Move Members, Manage Channels).
2. Verificar jerarquia de rol.
3. Revisar logs del bot para fallback remoto/local.
4. Confirmar que el servicio esta corriendo el ultimo commit: un bot con un build
   viejo se comporta como antes del cambio y parece un bug nuevo.

### Falla el clone del repo (integracion de GitHub)

Railway no guarda el codigo: guarda un token con el que clona el repo en cada
build. Si ese token queda invalido, el deploy falla aunque el commit exista.

1. Distinguir el error: `failed to clone`, `repository not found` o
   `authentication` es la integracion; `error TS` o `npm ERR!` es el codigo.
2. Reconectar: *Project Settings → Integrations → GitHub → Disconnect* y volver a
   conectar. Es una sola vez por proyecto, no por servicio.
3. Revisar en **cada** servicio (*Settings → Source*) que sigan en el repo, la
   rama `main` y su carpeta: `apps/api`, `apps/discord-bot`, `apps/web`. Un Root
   Directory vacio hace que Railway buildee la raiz del monorepo y falle.
4. `PRD_DB` no se reconecta: no viene del repo.
5. Desplegar hacia adelante, nunca reintentar un deploy viejo: los que quedaron
   en cola durante un incidente arrastran credenciales invalidas y vuelven a
   fallar.
6. Rotar secretos **solo** con aviso de impacto. Recordar que
   `DISCORD_BOT_TOKEN` y `BOT_API_TOKEN` tienen una copia en el Bot y otra en el
   API: si se rota una, hay que rotar las dos.

### Los permisos Admin/Officer desaparecen después de un deploy

Los permisos se guardan en PostgreSQL, en `admin_role_modules`; un redeploy
normal no debería borrarlos. La API usa `prisma db push` para sincronizar el
schema, no para recrear la base de datos.

El bot y las demás tarjetas de configuración usan guardados parciales: no
tocan `admin_role_modules`. Solo la tarjeta **Permisos de staff**, guardada por
el owner, reemplaza esas reglas. Si desaparecen tras un deploy, revisar que el
servicio API siga apuntando a la misma `DATABASE_URL` y que no se haya creado
una base de datos nueva o cambiado de environment en Railway.

### Escaneo de Warcraft Logs: qué es automático y qué no

Conviene tenerlo claro porque cambia dónde mirar cuando algo no aparece:

1. **Detectar reports nuevos es manual**: se dispara desde **Raids → Logs**
   ("Escanear"). No hay ningún proceso que recorra la guild de Warcraft Logs solo.
2. **Refrescar los logs EN CURSO es automático**: el scheduler de la API los
   revisa cada 5 minutos (`apps/api/src/services/raid-logs-sync.ts`), así el
   estado (en vivo / terminado), la cantidad de pulls y el resultado avanzan sin
   que nadie apriete nada. Solo toca los que están en `new`/`live` y hace como
   mucho **4 refrescos por pasada**.

   Un log ya terminado (`synced`) **no** se refresca solo: cada refresco baja el
   report completo de Warcraft Logs (varios MB) y lo vuelve a analizar, así que
   tenerlo cada 5 minutos para siempre era el mayor gasto de **memoria y CPU** del
   proyecto (ese tráfico es de entrada: se ve en RAM, no en egress). Los
   terminados se actualizan a mano con **"Actualizar log"**. Tampoco entran los
   `failed`: esos se reintentan con un escaneo manual.

Revisar los logs de Railway de `API` al solicitar un escaneo:

1. Confirmar que la guild y el realm configurados coinciden con Warcraft Logs.
2. `WARCRAFT_LOGS_API_KEY` ausente o inválida puede provocar una respuesta 401;
   403 indica falta de permisos o una key no autorizada.
3. Un **504** (el cuerpo es el error de Cloudflare con su link a la documentación)
   es del lado de Warcraft Logs: tardó más de lo que el borde espera. Es
   transitorio; se reintenta con otro escaneo.
4. El log `[raid-logs] scan manual` aparece cuando el escaneo termina y resume
   reports detectados y borradores refrescados. Si el sync automático falla, deja
   `[raid-logs] sync de logs falló:` con el motivo.
5. Publicar y actualizar son acciones aparte. Si falla la publicación, revisar
   `logsChannelId` y que el bot pueda ver el canal, enviar mensajes y leer historial.

Variables necesarias en el servicio `API` (environment correcto):

- `WARCRAFT_LOGS_API_KEY`
- `DISCORD_BOT_TOKEN`

La Web consulta la lista al entrar a Raids o abrir el popup. Para detectar
reports nuevos o reintentar uno que falló, se debe solicitar un escaneo manual.

## 6. Seguridad operativa

1. No guardar secretos en repo.
2. Rotar secretos cuando se exponen.
3. Mantener tokens por servicio.
4. Preferir private networking entre servicios.

## 7. Límites y costos

Las dos piezas se comportan distinto y conviene saberlo antes de que aparezca una
factura sorpresa.

### Railway (acá está el gasto real)

El costo sale del cómputo de los servicios siempre encendidos: `API`, `Bot` y
`PRD_DB`. Railway **sí tiene límite duro**: al alcanzarlo, apaga los servicios.

1. Se configura en el workspace: *Usage → Set Usage Limits*.
2. Por CLI: `railway usage limit set --target workspace --soft <aviso> --hard <tope>`.
   El `soft` avisa por email; el `hard` corta. El hard no puede ser menor al soft.
3. El consumo se sigue en la misma pantalla de Usage.

#### Memory: lo que hay que mirar

La memoria es la línea más cara del proyecto. Los dos consumidores con
crecimiento no acotado eran:

1. **El cache de mensajes de discord.js** (bot): guarda en RAM cada mensaje que
   ve y no lo suelta, así que la RAM sube hasta el próximo reinicio. El bot no
   lee mensajes del cache (el historial se pide con `fetch`), así que
   `MessageManager: 0` en `makeCache` no le saca nada.
2. **El cache de análisis de raid logs** (API): cada entrada es una noche entera
   (pulls, daño por jugador, muertes y consumibles), varios MB. Se bajó de 100
   entradas / 10 min a **3 / 5 min**.

**El número de RAM que muestra Railway no baja nunca, y eso no es un leak.** Es el
`rss`, el máximo que el proceso pidió al sistema; V8 no devuelve el heap que
liberó, lo deja reservado para reusarlo. Un pico de trabajo (un deploy, una
noche de raid) sube la marca y el escalón queda hasta el próximo reinicio. Para
distinguir las dos cosas el API escribe `[mem]` cada 5 minutos con cuatro
números: `heapUsedMb` (lo que el GC puede soltar — si crece **sin tráfico**, hay
leak), `heapTotalMb` (lo reservado), `externalMb` (buffers nativos: Prisma,
zlib) y `rssMb` (lo que se cobra). Un leak crece en reposo; una marca de agua
queda plana cuando no hay tráfico.

Ojo con el tamaño relativo: en el acumulado de un mes el **API** pesa ~4,5 veces
más que el bot (≈236 MB promedio contra ≈53 MB), así que un escalón del bot es
chico al lado del mismo escalón en el API.

**Una muestra real, y lo que dice:**

```json
{"heapTotalMb":72,"heapUsedMb":68,"externalMb":3,"rssMb":392}
```

El heap de JS son **68 MB** y el `rss` **392 MB**: 324 MB que no son del heap de
V8. Con ese reparto, **poner `--max-old-space-size` no sirve de nada** —el techo
se aplica al heap, que ya está chico—. Lo que ocupa el resto es memoria nativa:

1. **El motor de Prisma** (una librería en Rust mapeada en el proceso), que no
   aparece en `external` porque no es un buffer de Node.
2. **Las arenas de `malloc`.** glibc crea hasta `8 × núcleos` arenas y cada una
   retiene lo que liberó. Dentro de un contenedor `os.cpus()` ve los núcleos del
   host, así que el número de arenas es el del servidor físico, no el del plan.
   Se acota con la variable de entorno **`MALLOC_ARENA_MAX=2`**, que es el ajuste
   estándar para Node en contenedores con muchos núcleos: se lee al arrancar el
   proceso, así que va en *Variables* del servicio y necesita redeploy.
3. **El piso de Node + Fastify**, que no baja de ~50-60 MB.

Por eso, cuando `heapUsed` está muy por debajo de `rss`, el camino no es el GC:
es la memoria nativa. Y cuando `heapUsed` **sí** acompaña al `rss`, ahí sí el
tope del heap y la búsqueda de leaks tienen sentido.

#### La cuenta es "GB de RAM × 10"

Medido en un período de *Usage* real:

| Línea | Consumo | Costo | % |
| --- | --- | --- | --- |
| **Memory** | 1435 GB·min | $0,3322 | **97%** |
| CPU | 13,3 vCPU·min | $0,0062 | 2% |
| Egress | 0,07 GB | $0,0036 | 1% |
| Volume | 225 GB·min | $0,0008 | — |
| Backup | 61 GB·min | $0,0002 | — |

La tarifa de memoria es `$0,000231 / GB / minuto`, o sea **≈ $10 por GB por
mes**. Por eso la factura se estima así:

```text
cuenta ≈ GB de RAM promedio × 10 + $5 del plan
```

El Hobby son **$5 de suscripción que incluyen $5 de uso**: mientras el uso quede
por debajo de $5 se paga $5, y cada peso que lo pasa se suma. El objetivo
concreto para no pagar más de $5 es **menos de 0,5 GB de RAM promedio en total**.
Y como la memoria es casi todo, mirar CPU, egress o disco para bajar la factura
es perseguir el número equivocado.

Reparto por servicio en ese mismo período: **API 69%**, PRD_DB 18%, Bot 7%,
Web 5%. El API solo es más de dos tercios.

#### El pool de conexiones de Prisma

`new PrismaClient()` sin `connection_limit` usa el default de Prisma:
`núcleos físicos × 2 + 1`. Dentro de un contenedor `os.cpus()` devuelve los
núcleos del **host**, no los asignados, así que el API podía abrir 30+
conexiones. Cada conexión ocupa memoria en el API **y** crea un proceso backend
en Postgres, que se factura en la línea de `PRD_DB`.

En `db/prisma.ts` la URL se completa con `connection_limit=5` y
`pool_timeout=20` (si la variable ya trae los parámetros, se respetan: permite
probar otro valor sin deploy). El valor resuelto se puede ver en
`prisma._engineConfig.overrideDatasources`.

#### Qué se materializa en cada pasada

El sync de logs de raid corre cada 5 minutos y antes pedía `listRaidLogs`, que
trae **todas** las noches guardadas con su resumen de pulls y el texto
publicado, para después usar una o dos filas. Ahora consulta sólo las que están
en curso (`status` en `new`/`live`) y sólo las columnas que usa. Lo mismo con la
lista de guilds: era un `findMany` de todas las filas para sacar los `guildId`
distintos.

El cache de análisis de una noche bajó de 8 entradas a **3**: cada una es una
noche entera (pulls, daño por jugador, muertes y consumibles) y se guarda para
poder volver al informe sin bajarla de nuevo.

#### Postgres: bajar el piso de memoria

`PRD_DB` es el 18% de la factura de memoria y viene con valores pensados para un
servidor grande: 128 MB de caché y 100 conexiones. El API es el único cliente y
con el pool de 5 le sobra.

Desde la consola SQL del servicio (Railway → `PRD_DB` → *Data*), primero mirar
lo que hay:

```sql
SELECT name, setting, unit
FROM pg_settings
WHERE name IN ('shared_buffers', 'max_connections', 'work_mem', 'effective_cache_size');
```

Después:

```sql
ALTER SYSTEM SET shared_buffers = '64MB';
ALTER SYSTEM SET max_connections = 20;
ALTER SYSTEM SET work_mem = '2MB';
```

Los tres son parámetros de arranque: **no se aplican hasta reiniciar el
servicio** (Railway → `PRD_DB` → *Settings* → *Restart*). `work_mem` es por
operación, no por conexión, así que con 2 MB alcanza de sobra para este volumen.

Bajar `shared_buffers` no hace que la base vaya más lenta acá: los datos son
chicos y el sistema operativo cachea el resto. Lo que sí cambia es que ese
colchón se descuenta de la memoria facturada del contenedor.

#### Compresión: dejar la calidad de brotli donde está

`@fastify/compress` **no** usa la calidad 11 de zlib: trae `BROTLI_PARAM_QUALITY:
4` por default y lo deja escrito en su código. Medido sobre un payload de 151 kB
de este API (20 requests, plugin real):

| Calidad | Sale | Tiempo por respuesta |
| --- | --- | --- |
| **4 (default)** | 27,7 kB | **2,9 ms** |
| 5 | 25,8 kB | 4,1 ms |
| 11 | 20,6 kB | 148,8 ms |

Subirla a 11 cuesta ~50 veces más CPU para ahorrar 25% de bytes — centavos de
egress — y, como Node comprime en un pool de 4 hilos, encola las respuestas
grandes cuando hay concurrencia. Si hace falta bajar egress, el camino es otro
(que la web no proxee el API, cachear los assets), no la calidad de compresión.

#### Network Egress: qué lo genera y qué se hizo para bajarlo

Es tráfico que **sale** del servicio hacia internet: respuestas HTTP a la web,
mensajes y audio hacia Discord. Lo que el servicio **baja** (un report de
Warcraft Logs, la lista de miembros de Discord, el arte de una carta) es
**ingress** y no mueve esta línea: reducirlo ahorra RAM, CPU y tiempo, pero no
egress. Esa confusión cuesta caro, porque lleva a perseguir el número equivocado.

Lo que sí pesa, de mayor a menor:

1. **Las respuestas del API al navegador.** Es el grueso y tiene dos
   multiplicadores propios:
   - Viajaban **sin comprimir**: Fastify no comprime solo. Ahora
     `@fastify/compress` (brotli/gzip desde 1 kB) las achica ~10x.
   - Viajaban **dos veces**: la web pide `/api` y el servicio `Web` lo proxea al
     API, así que cada byte sale del API y vuelve a salir del servicio Web. Si
     algún día se apunta la web directo a un subdominio del API, este doble
     conteo desaparece (hay que resolver cookies y CORS antes).
2. **El audio del bot.** `@discordjs/voice` manda Opus al canal de voz: a
   ~128 kbps son ~57 MB por hora de música, y es un piso constante mientras haya
   algo sonando. Es lo primero a mirar si la curva del bot tiene una meseta alta.
3. **Los assets de la web** (bundle de ~870 kB crudos): los sirve el servicio
   `Web`, y `vite preview` no comprime.
4. **Los mensajes y embeds que manda el API a Discord** al publicar avisos y
   comunicados: chicos, pero constantes.

Un flujo periódico que baja datos grandes se nota al toque en la gráfica
(escalones que suben y quedan). Para el **acumulado**, la línea nunca baja: es un
contador, así que lo que se lee es la **pendiente** (dos puntos y dividir por los
minutos entre ellos), no el valor final.

Para saber **qué servicio** gasta, Railway muestra el detalle por servicio en
*Usage → Network Egress* y en *View Cost by Service* (y cada servicio tiene su
propia gráfica en *Observability*). Un piso alto y constante en el `Bot` es
audio; escalones en la `API` son navegación (y en la `Web`, lo mismo contado dos
veces por el proxy).

### Cloudflare (DNS/CDN delante del dominio)

Estar delante de la web en plan Free **no genera gasto**: Cloudflare no factura el
proxy por requests ni por ancho de banda. Lo que sí factura son los productos
medidos (Workers pago, R2, Images, Stream, Load Balancing, Argo, Logpush), y
**no existe un tope duro nativo**: las *budget alerts* son avisos por email y no
cortan nada.

1. No agregar método de pago ni activar productos medidos que no se usen: sin
   suscripción no hay factura posible.
2. Auditar qué está activo en *Manage Account → Billing* (Subscriptions y
   Billable Usage).
3. Dejar una *budget alert* como aviso temprano: *Manage Account → Billing →
   Billable Usage → Create budget alert*, con un umbral chico (por ejemplo USD 1).
4. Si algún día se necesita un Worker pago, tener presente que el plan Free corta
   al pasar 100.000 requests por día en lugar de facturar; para un tope real hay
   que pausar el Worker por API al pasar el umbral.

### Servicios externos

Discord y la API v1 de Warcraft Logs son gratuitos: no facturan por uso, aunque sí
tienen límites de tasa. El código los respeta con reintentos acotados
(`fetchWithDiscordRetry`) y cachés por recurso (miembros 4 min, roles y canales
5 min, portadas de juegos 24 h). Las tareas periódicas de las dos apps están
listadas en `docs/development/architecture.md`.
