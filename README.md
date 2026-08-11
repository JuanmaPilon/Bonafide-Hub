# Bonafide Platform

Plataforma privada para una comunidad de Discord, construida como monorepo con tres piezas principales:

1. Discord bot (operacion dentro de Discord)
2. API backend (OAuth, configuracion y persistencia)
3. Web hub (panel para gestion de guild)

## Estado actual

El bot y la API ya estan operativos con:

1. Eventos de entrada/salida de miembros
2. Logs configurables por guild
3. Canales de voz dinamicos
4. Reaction roles
5. Recordatorios
6. OAuth Discord en API
7. Persistencia principal en PostgreSQL via Prisma (API)
8. Fallback local del bot cuando la API no responde

## Estructura del repo

```text
apps/
  api/          Fastify + Prisma + OAuth Discord
  discord-bot/  discord.js + comandos slash + eventos
  web/          React/Vite (Guild Hub)

packages/
  shared/       Espacio para codigo compartido

docs/
  development/  Documentacion tecnica y operativa
```

## Arquitectura resumida

```text
Discord Users
    |
    v
Discord Bot (apps/discord-bot)
    |
    |  internal bot config API (x-bot-token)
    v
API (apps/api) ------------------> PostgreSQL (Railway)
    |
    | OAuth + JSON API
    v
Web (apps/web)
```

Notas importantes:

1. El bot intenta usar configuracion remota en API/DB.
2. Si la API no responde, usa fallback local en `apps/discord-bot/data/guild-config.json`.
3. Cuando remoto vuelve, el bot puede sincronizar configuracion local al remoto.

## Quick start local

### Bot

```bash
cd apps/discord-bot
npm install
copy .env.example .env
npm run register
npm run dev
```

### API

```bash
cd apps/api
npm install
copy .env.example .env
npm run dev
```

### Web

```bash
cd apps/web
npm install
copy .env.example .env
npm run dev
```

## Build commands

```bash
cd apps/discord-bot && npm run build
cd apps/api && npm run build
cd apps/web && npm run build
```

## Documentacion tecnica

1. `docs/development/architecture.md`
2. `docs/development/discord-bot.md`
3. `docs/development/api.md`
4. `docs/development/railway-operations.md`

## Consideraciones de seguridad

1. Nunca commitear `.env` con secretos.
2. Mantener secretos en Railway Variables.
3. Rotar tokens/credentials cuando se exponen.
4. Mantener permisos del bot con principio de minimo privilegio cuando sea posible.

## Consideraciones operativas

1. Si cambias comandos slash, volver a correr `npm run register`.
2. Si el bot no puede llegar a API, entra en fallback local automaticamente.
3. En Railway, confirmar variables por servicio y por environment antes de redeploy.
