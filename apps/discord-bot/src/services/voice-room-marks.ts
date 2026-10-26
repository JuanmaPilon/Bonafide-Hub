// Marcas que el bot escribe en el nombre de una sala de voz dinámica. Van
// siempre en el mismo orden (aforo → bandera → candado) y se rearman desde el
// nombre base.
//
// Por qué rearmar y no agregar/quitar sufijos sueltos: cada comando agregaba el
// suyo al final y sólo sabía quitarlo si seguía al final. Con dos marcas, la
// segunda tapaba a la primera y esa marca quedaba pegada para siempre (un
// candado puesto después de la bandera no lo sacaba ni /unlock ni el barrido).

export type VoiceRoomMarks = {
  hidden: boolean;
  limit: number;
  locked: boolean;
};

const HIDDEN_SUFFIX = " 🚫🇵🇪";
const LOCKED_SUFFIX = " 🔒";

// El tope de Discord para el nombre de un canal.
const CHANNEL_NAME_MAX = 100;

// Discord no tiene emoji de números de dos dígitos: el aforo se arma con un
// keycap por dígito (12 -> 1️⃣2️⃣).
function keycapDigits(value: number): string {
  return String(value)
    .split("")
    .map((digit) => `${digit}\uFE0F\u20E3`)
    .join("");
}

// El aforo es la única marca con forma variable: cualquier secuencia de keycaps
// al final del nombre.
const LIMIT_SUFFIX_PATTERN = / (?:[0-9]\uFE0F\u20E3)+$/;

export function readVoiceRoomMarks(name: string): {
  base: string;
  marks: VoiceRoomMarks;
} {
  const marks: VoiceRoomMarks = { hidden: false, limit: 0, locked: false };
  let base = name;

  // En bucle y no en orden fijo: los nombres viejos tienen las marcas en
  // cualquier orden y así se limpian igual.
  for (;;) {
    if (base.endsWith(LOCKED_SUFFIX)) {
      marks.locked = true;
      base = base.slice(0, -LOCKED_SUFFIX.length);
      continue;
    }
    if (base.endsWith(HIDDEN_SUFFIX)) {
      marks.hidden = true;
      base = base.slice(0, -HIDDEN_SUFFIX.length);
      continue;
    }
    const limitMatch = LIMIT_SUFFIX_PATTERN.exec(base);
    if (limitMatch) {
      marks.limit = Number(limitMatch[0].replace(/\D/g, ""));
      base = base.slice(0, -limitMatch[0].length);
      continue;
    }
    break;
  }

  return { base: base.trim(), marks };
}

export function composeVoiceRoomName(
  base: string,
  marks: VoiceRoomMarks,
): string {
  const suffix = [
    marks.limit > 0 ? ` ${keycapDigits(marks.limit)}` : "",
    marks.hidden ? HIDDEN_SUFFIX : "",
    marks.locked ? LOCKED_SUFFIX : "",
  ].join("");
  const roomForName = Math.max(1, CHANNEL_NAME_MAX - suffix.length);
  const trimmed = base.trim() || "Sala temporal";
  return `${trimmed.slice(0, roomForName)}${suffix}`;
}
