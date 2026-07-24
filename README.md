# Bonafide Platform

Base inicial minima para construir dos piezas conectadas:

- Bonafide BOT: automatizacion y logica dentro de Discord.
- Bonafide Hub: futura aplicacion web para la comunidad.

La idea del repositorio es crecer como un monorepo pequeno desde el principio, para evitar duplicar logica entre bot, backend y frontend cuando llegue la integracion.

## Estructura actual

```text
apps/
  api/          Backend/API futura
  discord-bot/  Bot de Discord (base TypeScript inicial)
  web/          Frontend / Guild Hub

packages/
  shared/       Tipos, utilidades o logica compartida
```

## Objetivo de esta base

Por ahora solo dejamos una estructura minima y clara para empezar a trabajar sin sobreingenieria.

La siguiente capa natural seria definir:

1. El stack tecnico inicial.
2. El setup del bot.
3. El setup del frontend.
4. La forma de compartir configuracion y tipos.

## Estado

Repositorio en fase de arranque.

## Arranque rapido del bot

1. Ir a la carpeta del bot.
2. Instalar dependencias.
3. Crear archivo .env desde .env.example y completar valores.
4. Registrar comandos slash en el servidor de pruebas.
5. Ejecutar en modo desarrollo.

Comandos:

```bash
cd apps/discord-bot
npm install
copy .env.example .env
npm run register
npm run dev
```

Variables minimas para registrar comandos de prueba:

- DISCORD_BOT_TOKEN
- DISCORD_APPLICATION_ID
- DISCORD_GUILD_ID

Configuracion de canal de logs de miembros:

- Usa el comando `/setlogchannel` dentro del servidor para elegir el canal.
- Requiere permiso `Manage Server`.
