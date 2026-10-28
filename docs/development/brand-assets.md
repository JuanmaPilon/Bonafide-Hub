# Imágenes e iconos

Los tamaños de cada imagen que usa el hub y el server, medidos sobre la app real.
Sirve para pedirlos y para chequear lo que llega: si un archivo no coincide con su
fila, algo se va a ver mal en algún lado.

Los nombres de archivo son los de `apps/web/public`. Las imágenes de Discord no
están en el repo: se suben a mano en el cliente.

## Iconos del sitio

| Archivo | Uso | Exportar | Se muestra |
| --- | --- | --- | --- |
| `favicon-v6.png` | Pestaña y manifest (Android) | 256 × 256 | 16×16 en la pestaña, 32×32 en bookmarks |
| `favicon.ico` | Pestaña y bookmarks (fallback) | 48, 32 y 16 en un solo `.ico` | 16×16 y 32×32 |
| `favicon.svg` | Pestaña en navegadores modernos | Vectorial, PNG de 64 embebido | 16×16 |
| `apple-touch-icon-v6.png` | Icono en el home de iOS | 180 × 180 | 180×180 |
| `og-cover.png` | Preview al compartir el link (Discord, WhatsApp, X) | 1200 × 630 | — |

Los cuatro primeros son el mismo dibujo. Idealmente salen de un master de
512 × 512; con 256 × 256 alcanza para todo lo que usa el hub hoy (el `manifest`
declara 256 y 180). Todos van con transparencia, salvo `apple-touch-icon`, que iOS
enmascara y por eso va a sangre.

El `og-cover` **no** va redondeado ni con transparencia: es una tarjeta, y las apps
que la muestran esperan 1.91:1. Hoy el archivo es de 600 × 600, así que se recorta.

## Banners del sitio

| Archivo | Dónde va | Exportar | Se muestra (máx) | Proporción |
| --- | --- | --- | --- | --- |
| `landing-banner.webp` | Pantalla de login | 3200 × 1200 | 1626 × 605 | 2.7:1 |
| `home-banner.webp` | Hero de Inicio | 3200 × 520 | 1632 × 260 | 6.3:1 |

Los dos se ven a `background-size: cover`, o sea que la imagen se escala hasta
cubrir la caja y se recorta lo que sobra. En el banner de login el alto sale de
`clamp(380px, 56vh, 660px)`, así que depende del alto de la ventana: 605 px con
una ventana de 1080, 504 con una de 900. El tamaño de exportación es la caja más
grande (1920 px de ancho) ×2, para que no se vea blanda en pantallas de alta
densidad. Con el archivo actual de 2560 × 600 (4.27:1) el `cover` recorta los
costados, así que el arte tiene que poder perder un 35% a cada lado.

La caja cambia con el ancho de pantalla (y, en el login, con el alto de la
ventana). Medido con una ventana de 900 px de alto:

| Pantalla | Banner login | Banner Home |
| --- | --- | --- |
| 1920 px | 1626 × 605 | 1632 × 260 |
| 1440 px | 1326 × 504 | 1377 × 260 |
| 1024 px | 910 × 430 | 961 × 260 |
| 390 px (celular) | 276 × 338 | 327 × 260 |

En el celular la proporción se da vuelta y del ancho original sólo entra una
parte:

| Banner | Se ve del ancho | Dónde mira |
| --- | --- | --- |
| Login | 31% | Centro (`center`) |
| Home | 20% | Derecha (`78%` en escritorio, `90%` por debajo de 760 px) |

Los chips con los nombres de los miembros carruselan sobre la franja **superior**
del banner de login (18 px del borde, unos 60 px de alto): esa franja no lleva
detalle importante.

Por eso el arte del banner de Home va en el 60% derecho: el 40% izquierdo lo tapa
el velo oscuro donde caen el título y el saludo. En el de login lo importante va
al centro, porque los costados desaparecen en el celular.

Si algún día hace falta controlar el encuadre del celular, la salida es una
segunda imagen servida por `@media`, no un encuadre distinto del mismo archivo.

## Imágenes de Discord

No son archivos del repo: se suben desde el cliente. El tamaño recomendado es el
que pide Discord al subir, salvo donde se aclara.

| Imagen | Exportar | Se muestra | Nota |
| --- | --- | --- | --- |
| Avatar del bot | 512 × 512 | 128×128 | Se recorta en círculo |
| Icono del servidor | 512 × 512 | 128×128 | Se recorta en círculo |
| Banner del servidor | 1920 × 1080 | ~960 de ancho | Discord pide 960 × 540; se manda el doble. Requiere Nivel 2 |
| Banner de invitación | 1920 × 1080 | 1920 × 1080 | Requiere Nivel 1 |

## Al recibir un archivo

1. Que el tamaño sea el de la tabla. Un icono de 1024 se reescala sin drama, pero
   un banner de 1600 × 350 no cubre la caja y sale borroso.
2. Que los iconos tengan transparencia real (alfa 0 en las esquinas) y no un fondo
   blanco. Un JPG no sirve: deja halo al redondear.
3. Que el `16 × 16` esté dibujado a mano y no escalado. A ese tamaño se ve en la
   pestaña y en la barra de marcadores, que es donde más se mira.
4. Que el arte importante de los iconos entre en el 80% central: se recortan en
   círculo.
