# Colores de los roles

Los degradados y colores de los roles del servidor, en un solo lugar. Discord
acepta **dos colores por rol** (primario + secundario) y pinta el nombre con el
degradado entre los dos; el hub lee los mismos dos y los usa en los chips y en los
nombres, así que la fuente de verdad sigue siendo Discord: esto es sólo la
referencia de qué valor va en cada rol.

## Rangos

De mejor a peor: R1 es el tope. Los tres primeros llevan degradado; del Rare hacia
abajo son colores plenos, como las rarezas del juego.

| Rango | Rareza | Primario | Secundario |
| --- | --- | --- | --- |
| R1 | Mítico | `#a50f1a` | `#ff5a00` |
| R2 | Legendario | `#ff8b00` | `#ffc13d` |
| R3 | Épico | `#840bda` | `#ff4dff` |
| R4 | Rare | `#0070dd` | — |
| R5 | Uncommon | `#1eff00` | — |
| R6 | Common | `#ffffff` | — |
| R7 | Poor | `#9d9d9d` | — |

## Roles de la casa

| Rol | Primario | Secundario |
| --- | --- | --- |
| Server Booster | `#ff73fa` | `#5865f2` |
| Karpindomo | `#00b8d9` | `#ffffff` |

El Server Booster usa los **dos colores de marca de Discord** (el rosa de Nitro y
el blurple): es el único rol que va de claro a oscuro, a propósito, para que
coincida con lo que hace Discord. Karpindomo termina en blanco puro, así que no se
confunde con ningún rango.

## Reglas

1. **El primario va medio/oscuro.** El hub lo usa para el texto del chip; si
   arranca casi blanco se lava en el tema claro. La excepción es el Server
   Booster, que necesita el rosa de Discord.
2. **El brillo va al final.** Los rangos encienden de oscuro a claro, siempre en
   el mismo sentido: así la escalera se lee como escalera.
3. **El tono no retrocede.** Si un rango alto vuelve a un tono que ya usó uno
   bajo (el violeta, por ejemplo), se lee como una degradación.
4. **El naranja no pasa los 40° de tono.** `#ffcc4d` (43°) ya se lee amarillo;
   `#ffc13d` (40°) es el límite que funciona.
5. **Nada de `#ff0000` puro.** Vira a magenta en OLED y compite con el épico.
6. **Cuidado con el blanco pleno en un rango.** Un miembro sin rol también se ve
   blanco en Discord: un rango en `#ffffff` queda indistinguible de "sin rol".

## Referencia: rarezas de WoW

| Rareza | Hex |
| --- | --- |
| Poor | `#9d9d9d` |
| Common | `#ffffff` |
| Uncommon | `#1eff00` |
| Rare | `#0070dd` |
| Epic | `#a335ee` |
| Legendary | `#ff8000` |
| Artifact | `#e6cc80` |

El legendario propio (`#ff8b00`) está a 11 puntos del canónico (`#ff8000`): es el
mismo color. El **Mítico no tiene equivalente en WoW** — arriba de legendario el
juego pone artefacto dorado — así que es un escalón propio del servidor y por eso
usa rojo, que en el juego base no aparece en ninguna rareza.

Si algún día se agrega un rango por encima del Mítico, conviene que sea claro o
dorado: ya no queda nada más caliente hacia dónde escalar.
