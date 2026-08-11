# Architecture Overview

Este documento resume como se conectan bot, API, web y base de datos.

## 1. Componentes

1. `apps/discord-bot`

- Runtime de Discord (discord.js)
- Maneja eventos, comandos slash y automatizaciones

2. `apps/api`

- API HTTP (Fastify)
- OAuth con Discord
- Persistencia en PostgreSQL via Prisma
- Endpoint interno para config del bot

3. `apps/web`

- UI de Guild Hub (React + Vite)
- Consume endpoints del API

4. `PostgreSQL`

- Fuente principal de verdad para configuraciones de guild en API

## 2. Flujo de alto nivel

```text
Discord Client
   |
   v
Discord Bot
   |\
   | \_ Slash commands / events
   |
   v
API (internal bot endpoint)
   |
   v
PostgreSQL

Web Client --> API --> PostgreSQL
```

## 3. Configuracion del bot: remoto + fallback

El bot usa dos modos para guild config:

1. Remoto (preferido)

- `BOT_CONFIG_API_URL`
- `BOT_CONFIG_API_TOKEN`
- Llama:
  - `GET /internal/guilds/:guildId/config`
  - `PUT /internal/guilds/:guildId/config`

2. Fallback local

- Archivo `apps/discord-bot/data/guild-config.json`
- Se usa cuando API no responde o no hay variables remotas

## 4. Endpoint interno bot <-> API

Autenticacion:

1. Header `x-bot-token`
2. Validado contra `BOT_API_TOKEN` en API

Endpoints:

1. `GET /internal/guilds/:guildId/config`
2. `PUT /internal/guilds/:guildId/config`

## 5. Persistencia actual

Tablas principales:

1. `guild_configs`

- Config por guild
- Incluye `temporaryVoiceChannelIds`

2. `reaction_role_rules`

- Reglas por `guildId + messageId + emojiKey`

## 6. Decisiones operativas

1. Mantener API como capa de persistencia/negocio.
2. Permitir fallback local para resiliencia en planes con sleep.
3. Sincronizar local -> remoto cuando remoto vuelve y esta vacio.
