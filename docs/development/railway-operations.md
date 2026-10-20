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
   report completo de Warcraft Logs (varios MB), y bajarlo cada 5 minutos para
   siempre era el mayor gasto de egress del proyecto. Los terminados se
   actualizan a mano con **"Actualizar log"**. Tampoco entran los `failed`: esos
   se reintentan con un escaneo manual.

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

#### Network Egress: qué lo genera y qué se hizo para bajarlo

Es tráfico que **sale** del servicio: respuestas HTTP a la web, llamadas a
Discord y a Warcraft Logs. Un flujo periódico que baja datos grandes se nota al
toque en la gráfica (escalones que suben y quedan).

Lo que más pesa, de mayor a menor:

1. **Reports de Warcraft Logs** (varios MB cada uno). Se bajan al escanear, al
   apretar "Actualizar log" y —esto era el gasto grande— por el sync automático
   de logs ya terminados cada 5 minutos. Ahora el sync solo toca los que están
   en curso y como mucho 4 por pasada.
2. **La lista de miembros de Discord** (`GET /guilds/:g/members`, ~1000 por
   página). La pide la web con un cache de 4 minutos en la API, y el bot la pide
   para armar los recordatorios con un cache de 2 minutos (antes la volvía a
   bajar por cada evento: `guild.members.fetch()` sin argumentos).
3. **La portada del evento** es una data URL de hasta ~1 MB y viajaba al bot en
   `GET /internal/.../events/control`, que se pide cada minuto. El bot no la usa:
   ya no se manda.
4. **Assets de la web** (bundle) e imágenes: los sirve el servicio `Web`.

Para saber **qué servicio** gasta, Railway muestra el detalle por servicio en
*Usage → Network Egress* (y cada servicio tiene su propia gráfica en
*Observability*). Un pico del `Bot` apunta a Discord; uno de la `API`, a Warcraft
Logs o a la web.

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
