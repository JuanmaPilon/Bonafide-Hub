# Cómo se construyó

Este documento no describe la app: describe **el proceso** con el que se armó y
por qué quedó así. Sirve para entender el criterio con el que están tomadas las
decisiones que después aparecen en [architecture.md](architecture.md) y
[api.md](api.md), y para que el próximo cambio no tenga que redescubrir las
mismas trampas.

## De dónde salió

Arrancó como un bot chico para un servidor de World of Warcraft: saludar, loguear
entradas y salidas, guardar la configuración del servidor en algún lado. A medida
que el staff empezó a pedir cosas (niveles, roles automáticos, avisos, después
raids, inscripciones, informes) quedó claro que el bot solo no alcanzaba: lo que
se administra desde una pantalla no se hace cómodo con comandos, y lo que pasa
dentro de Discord no se ve desde una pantalla.

De ahí salieron las tres piezas y el reparto que se mantiene hasta hoy:

- **El bot** es dueño de lo que pasa dentro de Discord (eventos del gateway,
  comandos, voz, música).
- **La API** es dueña de la memoria y de las reglas: no dibuja nada, no decide
  nada por su cuenta, pero es la única que escribe la base.
- **El hub** es dueño de la administración y de la lectura. Nunca habla con
  Discord: pide todo al API.

La regla que ordena el resto: **una sola fuente de verdad**. Si el bot y la web
pueden cambiar el mismo dato, el dato vive en la API y los dos la llaman; ninguno
guarda una copia propia que después se desincroniza.

## Cómo se trabajó

Cada funcionalidad se hizo igual, y ese orden es la parte más importante del
proceso:

1. **Síntoma concreto.** No "hagamos un módulo de eventos" sino "el staff anota
   gente en un mensaje y después no sabe quién vino".
2. **Mirar el código real** antes de tocar: qué existe, qué se puede reusar, qué
   se va a romper.
3. **Decisión chica**, explicada: por qué esta tabla, por qué este endpoint, por
   qué esto no va en el bot.
4. **Implementación en un paso** que se pueda probar sola, sin dejar el resto a
   medias.
5. **Verificación contra la app de verdad**, no contra la intuición: levantar la
   API y la web y mirar la pantalla, o correr la función real con datos armados
   cuando el problema es de cálculo. Un cambio de UI que "debería verse bien" no
   está terminado hasta que se ve bien.
6. **Documentación en el mismo commit** que el código (ver la tabla de
   mantenimiento en [../README.md](../README.md)). Documentar después es
   documentar otra cosa.
7. **Deploy y confirmación.** Push a `main`, el guardián de CI del repo en verde
   y la app en producción.

## Las fases

| Fase | Qué se agregó | Qué obligó a decidir |
| --- | --- | --- |
| 1. Bot | Login, comandos, config por servidor, logs de entrada y salida | La config no podía ser un archivo: el staff la cambiaba desde la web |
| 2. Memoria | PostgreSQL, XP, niveles, roles y prefijos automáticos | El XP se escribe desde dos lados (mensaje y voz): tenía que haber una sola función que sume |
| 3. Hub | OAuth con Discord, sesiones, permisos por rol del servidor | Los permisos de la web son los roles de Discord, no una lista paralela |
| 4. Contenido | Comunicados, sugerencias, plantillas de eventos | Publicar en Discord y guardar en la base son la misma operación: la hace la API |
| 5. Eventos | Inscripciones desde Discord y desde la web, recordatorios, recurrencia | El aviso de Discord y la tarjeta del hub se dibujan del mismo estado |
| 6. Raids | Roster, logs de Warcraft Logs, análisis de la noche, asistencia real | Cruzar "quién se anotó" con "quién apareció en el log" es lógica de la API, no de la pantalla |
| 7. Comunidad | Karuta, juegos más jugados, Home, perfil, torneos | Todo lo que ya existía (XP, roster, cartas) se puede mirar desde una persona |

El orden no fue caprichoso: cada fase necesitó algo de la anterior. El análisis
de raid necesita el roster; el informe de asistencia necesita eventos y análisis;
el perfil necesita XP, juegos y cartas. Se construyó de abajo hacia arriba.

## Las trampas que dejó el camino

Estas son las que costaron tiempo y quedaron como regla.

**Dos verdades sobre el mismo dato.** Los recordatorios de eventos se repetían
cada minuto para siempre. La lista de "avisos vencidos" aceptaba 48 h viejas pero
el marcador solo guardaba 24 h y 2 h, así que el aviso se mandaba, no se
registraba y volvía a salir. La corrección no fue "agregar un `if`": fue que la
lista y el marcador usen **el mismo normalizador**, y que además el bot no
repita un aviso dentro de las 6 h aunque el marcador falle.

**Lo que se refresca de más se paga.** La sincronización de logs de raid
refrescaba *todos* los logs guardados cada 5 minutos, incluidos los de noches
terminadas: el mismo report bajado entero, para siempre. Railway lo mostró en la
factura (egress y memoria). Ahora solo se refresca lo que está en vivo, con tope
por pasada. La misma lección apareció con las imágenes de los eventos: se
guardaban como data URL dentro de cada respuesta del control de eventos, y la
pantalla las pedía cada minuto. Ahora la API entrega una ruta y el navegador
cachea.

**El cache que crece no se nota hasta que se nota.** El bot guardaba en memoria
los mensajes que veía (para borrar y editar los avisos) y esa memoria subía hasta
reiniciar. Los avisos se editan por id, así que el cache de mensajes se apagó.

**Una lista blanca es más segura que una negra.** Los módulos del hub se
guardan como los que **están** activos; vacío significa "todos". La consecuencia
práctica: un módulo nuevo (Torneos) no aparece hasta prenderlo en Admin →
Módulos, y una entrada directa a esa pestaña rebota al Dashboard. No es un bug,
es el precio de que el owner pueda apagar cualquier cosa sin tocar código.

**La UI es una sola app, no una colección de pantallas.** Con el tiempo el hub
juntó variantes locales de lo mismo (tres tipos de chip, cuatro formas de modal,
barras de herramientas distintas). Se unificó en piezas compartidas y esas reglas
quedaron escritas en `.github/copilot-instructions.md`: una barra de módulo, un
chip, un modal, un ancho de estructura. Escribirlas fue lo que evitó que se
volvieran a separar.

## Decisiones que se sostienen

| Decisión | Por qué |
| --- | --- |
| Monorepo con tres apps independientes | Una base, un dominio, tres procesos con tiempos de deploy distintos. Cada app se instala y se levanta sola |
| Nada compartido entre apps todavía | No hay un `packages/shared`: se evita mantener una capa que solo copia tipos. Cuando duela, se agrega |
| Prisma con `db push` en el deploy | El proyecto lo mantiene una persona: migraciones formales agregan ceremonia sin agregar seguridad real acá |
| El bot tiene fallback local | La API puede estar caída o dormida; el bot tiene que seguir saludando y logueando |
| La API publica en Discord | Publicar es una operación de negocio (guardar + mandar). Si la hiciera el bot, habría dos caminos para el mismo dato |
| Permisos = roles de Discord | Un solo lugar donde dar y quitar acceso, y el staff ya lo conoce |
| Auditoría de solo escritura | Un registro que se puede editar no sirve como registro |

## Lo que falta y lo que no

Lo pendiente no es una lista de deseos: es lo que todavía no duele lo suficiente
como para pagarlo. Música quedó como módulo aislado porque depende de YouTube y
de redes externas. Los torneos están en el nav con el cartel de "Bajo
mantenimiento" porque el lugar ya está reservado. Si alguna de esas cosas empieza
a pedir datos que no existen, primero se agrega la tabla y después la pantalla.
