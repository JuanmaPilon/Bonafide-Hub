// Comandos con prefix ("oe …"). A diferencia de los slash, el bot tiene que leer
// el texto: mira si el mensaje arranca con el prefix y si la palabra siguiente es
// un comando conocido.
//
// La regla que hace que esto no sea insufrible: si no matchea un comando, el bot
// NO responde nada. "oe" es una interjección y aparece al principio de mensajes
// reales ("oe, ¿jugamos?"); contestar "no conozco ese comando" cada vez sería
// peor que no tener prefix.

import { env } from "../config/env.js";

export const BOT_PREFIX = (env.BOT_PREFIX?.trim() || "oe").toLowerCase();

// Tope de Discord para el contenido de un mensaje.
const MESSAGE_MAX_LENGTH = 2000;

// El muro: la frase partida en una palabra por renglón, como si alguien
// estuviera gritando de a una sílaba. Una sola pasada: repetir el bloque doce
// veces era demasiado scroll para el mismo chiste.
const DEREK_SPAM_PHRASE =
  "OE OE EO EO MERCADOLIBRE! LO MATAS EO OE OE LE GANAS MERCADOLIBREPULLANGARROZ";
const DEREK_SPAM_LINES = DEREK_SPAM_PHRASE.split(/\s+/);

export type PrefixContext = {
  args: string[];
  argsText: string;
};

export type PrefixReply = {
  content?: string;
};

export type PrefixCommand = {
  name: string;
  run: (ctx: PrefixContext) => PrefixReply | Promise<PrefixReply>;
};

const derekCommand: PrefixCommand = {
  name: "derek",
  run: () => ({
    content: DEREK_SPAM_LINES.join("\n").slice(0, MESSAGE_MAX_LENGTH),
  }),
};

const commands: readonly PrefixCommand[] = [derekCommand];

const byName = new Map<string, PrefixCommand>();
for (const command of commands) {
  byName.set(command.name, command);
}

export type ParsedPrefixCommand = {
  command: PrefixCommand;
  ctx: PrefixContext;
};

// Devuelve null cuando el mensaje no es un comando con prefix. El prefix solo
// cuenta si va seguido de un espacio: "oe, ¿jugamos?" y "oeste" quedan afuera.
export function parsePrefixCommand(
  content: string,
): ParsedPrefixCommand | null {
  const text = content.trim();
  if (!text.toLowerCase().startsWith(`${BOT_PREFIX} `)) {
    return null;
  }

  const rest = text.slice(BOT_PREFIX.length).trim();
  if (!rest) {
    return null;
  }

  const firstSpace = rest.search(/\s/);
  const token = (
    firstSpace === -1 ? rest : rest.slice(0, firstSpace)
  ).toLowerCase();
  const argsText = firstSpace === -1 ? "" : rest.slice(firstSpace).trim();
  const command = byName.get(token);
  if (!command) {
    return null;
  }

  return {
    command,
    ctx: { args: argsText ? argsText.split(/\s+/) : [], argsText },
  };
}
