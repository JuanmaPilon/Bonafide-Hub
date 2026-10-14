# Documentación

El mapa de todo lo que está documentado. Si recién llegás al repo, empezá por el
[README](../README.md): ahí está la app contada por funcionalidad. Acá está el
detalle técnico y operativo.

| Documento | Qué contesta | Leelo si… |
| --- | --- | --- |
| [../README.md](../README.md) | Qué es la app y qué hace cada módulo | Querés entender el producto |
| [development/architecture.md](development/architecture.md) | Cómo está armado: piezas, flujos, persistencia, decisiones | Vas a tocar más de una pieza a la vez |
| [development/api.md](development/api.md) | La app en detalle: cada módulo del hub y cada endpoint | Trabajás en el API o en la web |
| [development/discord-bot.md](development/discord-bot.md) | El bot: comandos, eventos, automatizaciones y permisos | Trabajás en el bot |
| [development/railway-operations.md](development/railway-operations.md) | Despliegue, variables por servicio, límites de costo y diagnóstico | Desplegás o debuggeás en producción |

## Cómo se mantiene

Cada documento es dueño de una parte del sistema y se actualiza en el mismo
cambio que el código, no después:

| Si tocás… | Actualizá… |
| --- | --- |
| Un endpoint o su payload | `development/api.md` |
| Un módulo del hub (UI, módulo nuevo, sección del Admin) | `development/api.md` y, si cambia el mapa general, `../README.md` |
| Un comando, evento o automatización del bot | `development/discord-bot.md` |
| Un flujo que cruza piezas, una tabla nueva o una decisión de arquitectura | `development/architecture.md` |
| Variables de entorno | El `.env.example` de la app y `development/railway-operations.md` |
| Cómo se despliega o un límite de costo | `development/railway-operations.md` |

Los `.github/instructions/*` y `.github/copilot-instructions.md` son la guía de
trabajo del repo (reglas de estilo, flujo de ramas y de PR): no describen la app.

## Alcance

Este repo no contiene datos de la comunidad ni credenciales. Los ejemplos de
configuración van con valores de mentira y las tablas de la base se describen por
nombre, sin filas reales.
