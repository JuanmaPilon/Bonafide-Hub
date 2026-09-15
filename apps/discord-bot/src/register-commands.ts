import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands.js";
import { env } from "./config/env.js";

if (!env.DISCORD_APPLICATION_ID) {
  throw new Error("DISCORD_APPLICATION_ID is required to register commands");
}

if (!env.DISCORD_GUILD_ID) {
  throw new Error("DISCORD_GUILD_ID is required to register commands");
}

if (!env.DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN is required to register commands");
}

const applicationId = env.DISCORD_APPLICATION_ID;
const guildId = env.DISCORD_GUILD_ID;
const botToken = env.DISCORD_BOT_TOKEN;

const rest = new REST({ version: "10" }).setToken(botToken);

// ── Registro de slash commands ──────────────────────────────────────
// Este script corre en el pre-deploy de Railway, o sea ANTES de que arranque
// el bot. Dos reglas:
//   1. No gastar el endpoint de escritura si no hace falta. El "bulk
//      overwrite" (PUT .../commands) tiene un rate limit fuerte y es el que
//      devuelve 5xx cuando Discord tiene un hipo. Si los comandos ya están al
//      día, alcanza con un GET y no tocamos nada.
//   2. Un problema de Discord no debe tumbar el deploy: los comandos ya
//      registrados siguen funcionando. Los errores transitorios (5xx/429) se
//      reintentan y, si insisten, se avisan sin frenar el deploy.

type JsonObject = Record<string, unknown>;

// Campos que comparamos de cada comando. `type` se omite a propósito: Discord
// lo devuelve explícito (1 = chat input) aunque la definición no lo traiga.
const COMMAND_FIELDS = [
  "contexts",
  "default_member_permissions",
  "dm_permission",
  "integration_types",
  "nsfw",
] as const;

const OPTION_FIELDS = [
  "autocomplete",
  "channel_types",
  "description",
  "max_length",
  "max_value",
  "min_length",
  "min_value",
  "required",
] as const;

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normaliza una opción dejando solo los campos que definimos localmente, para
// poder compararla contra lo que devuelve Discord (que agrega localizaciones y
// defaults como `required: false`).
function normalizeOption(option: JsonObject): JsonObject {
  const normalized: JsonObject = {
    name: option.name,
    type: option.type,
  };

  for (const field of OPTION_FIELDS) {
    const value = option[field];
    if (
      value === undefined ||
      value === null ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }
    normalized[field] = value;
  }

  const choices = option.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    // De cada choice solo importan el texto visible y el valor.
    normalized.choices = choices.map((choice) => {
      const entry = choice as JsonObject;
      return { name: entry.name, value: entry.value };
    });
  }

  const nested = option.options;
  if (Array.isArray(nested)) {
    normalized.options = nested.map((sub) =>
      normalizeOption(sub as JsonObject),
    );
  }

  return normalized;
}

function normalizeCommand(command: JsonObject): JsonObject {
  const normalized: JsonObject = {
    name: command.name,
    description: command.description,
  };

  for (const field of COMMAND_FIELDS) {
    const value = command[field];
    if (
      value === undefined ||
      value === null ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }
    normalized[field] = value;
  }

  const options = command.options;
  if (Array.isArray(options)) {
    normalized.options = options.map((option) =>
      normalizeOption(option as JsonObject),
    );
  }

  return normalized;
}

// Compara SOLO los campos que definimos localmente (subset): si Discord agrega
// claves extra con sus defaults, no cuenta como diferencia y no re-registramos
// en cada deploy.
function matchesDefinition(local: JsonObject, current: JsonObject): boolean {
  for (const [key, value] of Object.entries(local)) {
    if (JSON.stringify(value) !== JSON.stringify(current[key])) {
      return false;
    }
  }
  return true;
}

function commandsInSync(local: JsonObject[], current: JsonObject[]): boolean {
  if (local.length !== current.length) {
    return false;
  }

  const byName = new Map(
    current.map((command) => [String(command.name), command]),
  );

  return local.every((command) => {
    const existing = byName.get(String(command.name));
    return existing ? matchesDefinition(command, existing) : false;
  });
}

// GET de los comandos registrados. Si falla devolvemos null: preferimos
// intentar el PUT antes que asumir que ya están al día.
async function fetchRegisteredCommands(): Promise<JsonObject[] | null> {
  try {
    const commands = (await rest.get(
      Routes.applicationGuildCommands(applicationId, guildId),
    )) as JsonObject[];

    if (!Array.isArray(commands)) {
      return null;
    }

    return commands.map((command) => normalizeCommand(command));
  } catch (error) {
    console.warn(
      "[discord-bot] no se pudieron leer los comandos actuales; se re-registran igual",
      error,
    );
    return null;
  }
}

// Un 5xx o un 429 son transitorios (Discord caído o límite de tasa): vale
// reintentar. Un 4xx es determinista (permisos, payload): reintentar solo hace
// perder tiempo.
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

function retryDelayMs(error: unknown, attempt: number): number {
  const retryAfter = (error as { retryAfter?: number }).retryAfter;
  if (typeof retryAfter === "number" && retryAfter > 0) {
    // La librería ya nos dice cuánto esperar en los 429 (en ms).
    return retryAfter + 250;
  }
  return 2000 * attempt;
}

async function putCommands(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
        body: commandDefinitions,
      });
      return;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      const waitMs = retryDelayMs(error, attempt);
      console.warn(
        `[discord-bot] registro de comandos falló (${status ?? "sin status"}); reintento ${attempt}/${MAX_ATTEMPTS - 1} en ${Math.round(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
    }
  }
}

function logAccessChecklist(error: unknown): void {
  const discordError = error as { code?: number; status?: number };

  if (discordError.code === 50001 || discordError.status === 403) {
    console.error("[discord-bot] Missing Access while registering commands.");
    console.error(
      "[discord-bot] Checklist: verify DISCORD_GUILD_ID is your SERVER ID (not Application ID), install the app in that server, and keep bot + applications.commands scopes.",
    );
  }
}

async function registerGuildCommands(): Promise<void> {
  const local = commandDefinitions.map((command) =>
    normalizeCommand(command as unknown as JsonObject),
  );
  const current = await fetchRegisteredCommands();

  if (current && commandsInSync(local, current)) {
    // Camino feliz del deploy: no tocamos el endpoint de escritura.
    console.log(
      `[discord-bot] comandos al día (${local.length}); no hace falta re-registrar`,
    );
    return;
  }

  await putCommands();
  console.log(
    `[discord-bot] comandos registrados (${local.length})${current ? "" : " (sin lectura previa)"}`,
  );
}

registerGuildCommands()
  .then(() => {
    // Salida explícita: el pre-deploy termina acá y el contenedor arranca el
    // bot después (los handles de la REST no deben quedar abiertos).
    process.exit(0);
  })
  .catch((error: unknown) => {
    logAccessChecklist(error);

    // Un 5xx/429 es de Discord: NO frenamos un deploy que ya tiene los
    // comandos registrados y funcionando. Un 4xx es nuestro (payload o
    // permisos) y sí debe frenar el deploy para que se corrija.
    const transient = isRetryable(error);
    console.error("[discord-bot] Failed to register commands", error);
    console.error(
      transient
        ? `[discord-bot] Error transitorio de Discord tras ${MAX_ATTEMPTS} intentos. Los comandos ya registrados siguen funcionando, así que el deploy continúa; volvé a deployar (o corré \`npm run register\`) para actualizarlos.`
        : "[discord-bot] El error es determinista (payload o permisos): se frena el deploy para que se corrija.",
    );
    process.exit(transient ? 0 : 1);
  });
