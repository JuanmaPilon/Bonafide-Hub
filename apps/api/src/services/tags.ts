// ── Etiquetas de color (eventos y comunicados) ──────────────────────
// Lista de etiquetas cortas con color (texto + #rrggbb) que el staff edita en
// el panel y la web pinta en las tarjetas y en los filtros. Antes cada modelo
// tenía UNA sola etiqueta (tagLabel/tagColor); ahora es una lista (`tags`) y
// las columnas viejas quedan solo como respaldo de lectura.

export const MAX_TAGS = 6;
export const DEFAULT_TAG_COLOR = "#6aa8ff";

export type Tag = {
  color: string;
  label: string;
};

function normalizeTagColor(value: unknown): string {
  const hex = String(value ?? "")
    .trim()
    .replace(/^#/, "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  return /^[0-9a-f]{6}$/i.test(expanded)
    ? `#${expanded.toLowerCase()}`
    : DEFAULT_TAG_COLOR;
}

// Acepta lo que venga (body del request o JSON de la base) y devuelve una lista
// limpia: sin vacíos, sin repetidos (por texto) y con tope. El color se
// normaliza a #rrggbb para que la web y Discord pinten lo mismo.
export function normalizeTags(value: unknown): Tag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags: Tag[] = [];
  for (const entry of value) {
    const label = String((entry as { label?: unknown } | null)?.label ?? "")
      .trim()
      .slice(0, 24);
    if (!label) {
      continue;
    }
    if (tags.some((tag) => tag.label.toLowerCase() === label.toLowerCase())) {
      continue;
    }
    tags.push({
      color: normalizeTagColor((entry as { color?: unknown }).color),
      label,
    });
    if (tags.length >= MAX_TAGS) {
      break;
    }
  }
  return tags;
}

// Etiquetas de un registro: la lista guardada y, si está vacía, la etiqueta
// ÚNICA del modelo viejo (así lo cargado antes sigue mostrando la suya sin
// migrar la base). OJO: al guardar una lista vacía hay que limpiar también
// `tagLabel`/`tagColor`, si no la etiqueta vieja reaparece.
export function tagsFromRecord(record: {
  tagColor?: string | null;
  tagLabel?: string | null;
  tags?: unknown;
}): Tag[] {
  const tags = normalizeTags(record.tags);
  if (tags.length > 0) {
    return tags;
  }
  return normalizeTags(
    record.tagLabel ? [{ color: record.tagColor, label: record.tagLabel }] : [],
  );
}
