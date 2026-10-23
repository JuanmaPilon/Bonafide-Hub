// El adorno del nivel se agrega al FINAL del nombre y se limpia de las dos
// puntas antes de volver a armarlo: las versiones anteriores lo ponían
// adelante, así que quien ya tenía "⭐ Juan" terminaría como "⭐ Juan ⭐".
export const NICKNAME_MAX_LENGTH = 32;

export function stripKnownLevelMarks(
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

// Se recorta el NOMBRE, nunca el adorno: cortando el final se perdía justo lo
// que se quería mostrar.
export function withLevelMark(baseName: string, mark: string): string {
  const maxBaseLength = Math.max(1, NICKNAME_MAX_LENGTH - mark.length);
  return `${baseName.slice(0, maxBaseLength).trimEnd()}${mark}`;
}
