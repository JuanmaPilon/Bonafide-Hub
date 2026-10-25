// Los adornos (de nivel y de multiplicador) van al FINAL del nombre y se limpian
// antes de volver a armar el nick: las versiones anteriores los ponían adelante,
// así que quien ya tenía "⭐ Juan" terminaría "⭐ Juan ⭐".
export const NICKNAME_MAX_LENGTH = 32;

// Cualquier símbolo pegado al final es un adorno del bot, venga de la config que
// venga. `So` cubre ⭐ y compañía; `Extended_Pictographic` los emoji; el selector
// de variación (U+FE0F) y el ZWJ forman parte de la secuencia y hay que
// arrastrarlos con ella.
const TRAILING_ADORNOS = /(?:[\p{Extended_Pictographic}\p{So}\uFE0F\u200D])+$/u;

export function stripKnownMarks(
  currentName: string,
  marks: readonly string[],
): string {
  let name = currentName.trim();
  let changed = true;

  while (changed && marks.length > 0) {
    changed = false;
    for (const mark of marks) {
      if (name.startsWith(mark)) {
        name = name.slice(mark.length).trim();
        changed = true;
        break;
      }
      if (name.endsWith(mark)) {
        name = name.slice(0, -mark.length).trim();
        changed = true;
        break;
      }
    }
  }

  return name;
}

// Saca el tramo de símbolos pegado al final. Es lo que hace que el sync sea
// idempotente aunque haya adornos repetidos, adornos viejos que ya no están en
// la config, o variantes del mismo emoji con y sin selector de variación ("⭐" y
// "⭐️"), que son las que dejaban pares.
//
// Un emoji separado por un espacio NO se toca: ese lo puso la persona. El bot
// siempre pega el adorno al nombre, así que la ausencia de espacio es la señal
// de que es nuestro.
export function stripTrailingAdornos(currentName: string): string {
  const name = currentName.trimEnd();
  const match = TRAILING_ADORNOS.exec(name);
  if (!match || match.index === 0) {
    return name;
  }
  const before = name.slice(0, match.index);
  if (/\s$/.test(before)) {
    return name;
  }
  return before;
}

// El adorno de nivel va primero y los de multiplicador después, en el orden en
// que están configurados, pegados uno al otro: "Juan⭐🔥👑". Sin separación a
// propósito: con espacios, tres adornos se comían el nick. Se descartan los
// repetidos: si el nivel y un multiplicador usan el mismo emoji, va una sola vez.
export function nicknameSuffix(
  levelMark: string | undefined,
  multiplierMarks: readonly string[],
): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const mark of [levelMark, ...multiplierMarks]) {
    const trimmed = mark?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    parts.push(trimmed);
  }
  return parts.join("");
}

// Se recorta el NOMBRE, nunca los adornos: cortando el final se perdía justo lo
// que se quería mostrar. Si los adornos solos no entran en 32, se recortan ellos
// (Discord rechaza el nick entero si se pasa y el miembro quedaría sin ninguno).
export function withSuffix(baseName: string, suffix: string): string {
  const cappedSuffix = suffix.slice(0, NICKNAME_MAX_LENGTH - 1);
  const maxBaseLength = Math.max(1, NICKNAME_MAX_LENGTH - cappedSuffix.length);
  return `${baseName.slice(0, maxBaseLength).trimEnd()}${cappedSuffix}`;
}
