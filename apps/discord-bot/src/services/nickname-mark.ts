// Los adornos (de nivel y de multiplicador) van al FINAL del nombre y se limpian
// de las dos puntas antes de volver a armar el nick: las versiones anteriores los
// ponían adelante, así que quien ya tenía "⭐ Juan" terminaría "⭐ Juan ⭐".
export const NICKNAME_MAX_LENGTH = 32;

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

// El adorno de nivel va primero y los de multiplicador después, en el orden en
// que están configurados: "Juan ⭐ 🔥". El primero se pega sin espacio para no
// cambiar los nicks que ya existen; los siguientes, separados.
export function nicknameSuffix(
  levelMark: string | undefined,
  multiplierMarks: readonly string[],
): string {
  const parts = [
    ...(levelMark ? [levelMark] : []),
    ...multiplierMarks.filter(Boolean),
  ];
  if (parts.length === 0) {
    return "";
  }
  return `${parts[0]}${parts
    .slice(1)
    .map((part) => ` ${part}`)
    .join("")}`;
}

// Se recorta el NOMBRE, nunca los adornos: cortando el final se perdía justo lo
// que se quería mostrar. Si los adornos solos no entran en 32, se recortan ellos
// (Discord rechaza el nick entero si se pasa y el miembro quedaría sin ninguno).
export function withSuffix(baseName: string, suffix: string): string {
  const cappedSuffix = suffix.slice(0, NICKNAME_MAX_LENGTH - 1);
  const maxBaseLength = Math.max(1, NICKNAME_MAX_LENGTH - cappedSuffix.length);
  return `${baseName.slice(0, maxBaseLength).trimEnd()}${cappedSuffix}`;
}
