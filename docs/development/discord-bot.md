# Discord Bot Guide

Guia tecnica y funcional del bot de Discord.

## 1. Stack

1. Node.js >= 20
2. TypeScript
3. discord.js v14

## 2. Comandos disponibles

### Basicos

1. `/saludo`
2. `/ping`
3. `/help`

### Logs de miembros

1. `/setlogchannel canal:<texto|announcement>`
2. `/getlogchannel`
3. `/testmemberlog`

Eventos relacionados:

1. `GuildMemberAdd`
2. `GuildMemberRemove`

### Voz dinamica

1. `/setvoicecreator canal:<voice>`
2. `/getvoicecreator`
3. `/clearvoicecreator`

Comportamiento:

1. Usuario entra al canal creador.
2. Bot crea sala temporal.
3. Bot mueve al usuario a la sala.
4. Cuando la sala temporal queda vacia, se elimina.

### Estadisticas

1. `/memberstats [publico]`
2. `/rolstats rol:<rol> [listar] [publico]`

### Comunicados markdown

1. `/publicarcomunicado archivo:<ruta> [canal]`

Fuente de archivos:

1. `apps/discord-bot/docs/comunicados/**`

### Reaction roles

1. `/setreactionrole canal mensaje_id emoji rol [modo]`
2. `/removereactionrole canal mensaje_id emoji`
3. `/listreactionroles`
4. `/setreactionpanelmode canal mensaje_id modo`
5. `/createreactionpanel titulo emoji_1 rol_1 [modo] [canal] [descripcion] [emoji_2] [rol_2] [emoji_3] [rol_3]`

Modos:

1. `multiple`
2. `unique`
3. `additive`

### Recordatorios

1. `/setreminder minutos mensaje [canal] [mencionar_rol]`
2. `/listreminders`
3. `/cancelreminder id`

## 3. Variables de entorno del bot

Archivo ejemplo: `apps/discord-bot/.env.example`

Requeridas para login:

1. `DISCORD_BOT_TOKEN`

Recomendadas para registro slash:

1. `DISCORD_APPLICATION_ID`
2. `DISCORD_GUILD_ID`

Integracion con API para config remota:

1. `BOT_CONFIG_API_URL`
2. `BOT_CONFIG_API_TOKEN`

Control operativo:

1. `BOT_DISABLED`

- Si esta en true, el proceso arranca pero no hace login a Discord

## 4. Permisos recomendados

Minimos tipicos:

1. View Channels
2. Send Messages
3. Read Message History
4. Add Reactions
5. Manage Channels
6. Move Members
7. Connect
8. Manage Roles (reaction roles)

Notas:

1. El rol del bot debe estar por encima del rol que intenta asignar/remover.
2. Para debugging rapido, Admin funciona, pero no es ideal a largo plazo.

## 5. Persistencia del bot

1. Principal: API + DB via endpoint interno.
2. Fallback: `apps/discord-bot/data/guild-config.json`.

Si API falla o duerme:

1. Bot sigue operando con fallback local.
2. Cuando API vuelve, puede sincronizar local -> remoto.

## 6. Flujo recomendado de cambios

1. Cambiar codigo en local.
2. `npm run build`.
3. Si tocaste slash commands: `npm run register`.
4. Validar en Discord.
5. Push a branch/main y deploy en Railway.
