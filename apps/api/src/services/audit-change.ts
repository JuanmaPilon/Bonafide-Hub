/**
 * Detalle legible de un cambio para el registro de auditoría.
 *
 * El registro guarda un solo texto (`details`), así que acá se arma con la
 * forma "campo: antes → después", separando los campos con " · ".
 *
 * Solo se incluyen los campos que REALMENTE cambiaron: la comparación es por
 * el texto ya formateado, así que mandar el mismo valor (o uno que se muestra
 * igual) no genera ruido. Si no cambió nada, `describeAuditChanges` devuelve
 * null y la acción no se registra.
 */

/** Un campo auditado: su nombre visible y el valor antes y después. */
export type AuditChange =
  | {
      /** Valor nuevo (crudo; se compara y se formatea). */
      after: unknown;
      /** Valor previo (crudo). */
      before: unknown;
      /** Cómo mostrar los valores. Por defecto `formatAuditValue`. */
      format?: (value: unknown) => string;
      /** Nombre visible del campo, en castellano y en minúscula. */
      label: string;
      note?: undefined;
    }
  // Cambio de una sola frase: para altas/bajas de listas, donde repetir el
  // valor completo en los dos lados sería ilegible.
  | {
      label: string;
      note: string;
    };

// El detalle es una línea de texto en el panel: lo cortamos para que un
// cambio enorme (módulos, catálogos) no llene la fila.
const MAX_DETAIL_LENGTH = 500;
const MAX_VALUE_LENGTH = 90;

/** Texto corto y en una sola línea (los textos largos se recortan con …). */
export function snippetText(value: string, max = MAX_VALUE_LENGTH): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "(vacío)";
  }
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Fecha en formato corto y estable (la API corre en UTC). */
export function formatAuditMoment(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return "(vacío)";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/** Valor crudo → texto legible (booleanos, listas, fechas, vacíos). */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "(vacío)";
  }
  if (typeof value === "boolean") {
    return value ? "sí" : "no";
  }
  if (value instanceof Date) {
    return formatAuditMoment(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? "(ninguno)"
      : snippetText(value.map((item) => formatAuditValue(item)).join(", "));
  }
  if (typeof value === "object") {
    return snippetText(JSON.stringify(value));
  }
  return snippetText(String(value));
}

/**
 * Cambio con los valores ya convertidos a texto: para campos estructurados
 * (listas, mapas, catálogos) donde comparar el crudo daría un diff ilegible.
 * Un null/"" queda como "(vacío)", o sea "sin configurar".
 */
export function auditTextChange(
  label: string,
  before: string | null,
  after: string | null,
): AuditChange {
  return {
    after: after ?? "(vacío)",
    before: before ?? "(vacío)",
    label,
  };
}

/** Envuelve un formateador para que los vacíos se muestren como "(vacío)". */
export function orEmpty(
  format: (value: unknown) => string | null,
): (value: unknown) => string {
  return (value) => format(value) ?? "(vacío)";
}

/** Cambio de una sola frase (ver el tipo `AuditChange`). */
export function auditNoteChange(
  label: string,
  note: string | null,
): AuditChange | null {
  return note ? { label, note: snippetText(note) } : null;
}

/**
 * Compara dos listas y describe las altas y bajas de ítems: más legible que
 * repetir la lista entera a los dos lados del "antes → después". `label`
 * traduce cada ítem (ids → nombres) y el orden que se muestra es el nuevo.
 */
export function describeListDelta(
  before: readonly unknown[] | null | undefined,
  after: readonly unknown[] | null | undefined,
  label?: (item: string) => string,
): string | null {
  const beforeSet = new Set((before ?? []).map(String));
  const afterSet = new Set((after ?? []).map(String));
  const added = [...afterSet].filter((item) => !beforeSet.has(item));
  const removed = [...beforeSet].filter((item) => !afterSet.has(item));
  if (added.length === 0 && removed.length === 0) {
    return null;
  }

  const text = (items: string[]) =>
    items.map((item) => label?.(item) ?? item).join(", ");
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`se suma${added.length > 1 ? "n" : ""} ${text(added)}`);
  }
  if (removed.length > 0) {
    parts.push(`se quita${removed.length > 1 ? "n" : ""} ${text(removed)}`);
  }
  return parts.join(" · ");
}

/**
 * Arma el detalle de una entrada de auditoría: solo los campos que cambiaron,
 * en formato "campo: antes → después". Devuelve null si no cambió nada.
 * Los items null (cambios sin nada que contar) se ignoran.
 */
export function describeAuditChanges(
  changes: (AuditChange | null)[],
): string | null {
  const parts: string[] = [];

  for (const change of changes) {
    if (!change) {
      continue;
    }
    if (change.note !== undefined) {
      parts.push(`${change.label}: ${change.note}`);
      continue;
    }
    const format = change.format ?? formatAuditValue;
    const before = format(change.before);
    const after = format(change.after);
    if (before === after) {
      continue;
    }
    parts.push(`${change.label}: ${before} → ${after}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return snippetText(parts.join(" · "), MAX_DETAIL_LENGTH);
}
