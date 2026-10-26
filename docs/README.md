# Documentación

El mapa de todo lo que está documentado. Si recién llegás al repo, empezá por el
[README](../README.md): ahí está la app contada por funcionalidad. Acá está el
detalle técnico, el proceso con el que se armó y lo operativo.

## Por dónde empezar

1. [../README.md](../README.md) — qué es la app y qué hace cada módulo. Cinco
   minutos para saber de qué se está hablando.
2. [development/architecture.md](development/architecture.md) — las tres piezas,
   cómo se hablan y qué guarda cada tabla. Es el mapa.
3. [development/process.md](development/process.md) — cómo se llegó a esto: el
   orden en que se construyó, las trampas que costaron tiempo y las decisiones
   que se sostienen.

Después, según lo que vayas a tocar, entrá por el documento de esa pieza.

| Documento | Qué contesta | Leelo si… |
| --- | --- | --- |
| [../README.md](../README.md) | Qué es la app y qué hace cada módulo | Querés entender el producto |
| [development/architecture.md](development/architecture.md) | Cómo está armado: piezas, flujos, persistencia, decisiones | Vas a tocar más de una pieza a la vez |
| [development/process.md](development/process.md) | Cómo se fue construyendo y qué se aprendió en el camino | Querés entender por qué está así, o llegás nuevo al repo |
| [development/api.md](development/api.md) | La app en detalle: cada módulo del hub y cada endpoint | Trabajás en el API o en la web |
| [development/discord-bot.md](development/discord-bot.md) | El bot: comandos, eventos, automatizaciones y permisos | Trabajás en el bot |
| [development/role-colors.md](development/role-colors.md) | Los degradados y colores de los roles del server, y las reglas de la paleta | Tocás rangos, chips o cualquier nombre pintado con color de rol |
| [development/railway-operations.md](development/railway-operations.md) | Despliegue, variables por servicio, límites de costo y diagnóstico | Desplegás o debuggeás en producción |

## Cómo se mantiene

Cada documento es dueño de una parte del sistema y se actualiza en el mismo
cambio que el código, no después:

| Si tocás… | Actualizá… |
| --- | --- |
| Un endpoint o su payload | `development/api.md` |
| Un módulo del hub (UI, módulo nuevo, sección del Admin) | `development/api.md` y, si cambia el mapa general, `../README.md` |
| Un comando, evento o automatización del bot | `development/discord-bot.md` |
| El color o el degradado de un rol | `development/role-colors.md` |
| Un flujo que cruza piezas, una tabla nueva o una decisión de arquitectura | `development/architecture.md` |
| Una decisión de proceso, una trampa nueva o una fase que se cierra | `development/process.md` |
| Variables de entorno | El `.env.example` de la app y `development/railway-operations.md` |
| Cómo se despliega o un límite de costo | `development/railway-operations.md` |

Los `.github/instructions/*` y `.github/copilot-instructions.md` son la guía de
trabajo del repo (reglas de estilo, flujo de ramas y de PR): no describen la app.

## Alcance

Este repo no contiene datos de la comunidad ni credenciales. Los ejemplos de
configuración van con valores de mentira y las tablas de la base se describen por
nombre, sin filas reales.
