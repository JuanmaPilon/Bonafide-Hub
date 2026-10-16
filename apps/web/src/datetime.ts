// Fechas y horas en formato fijo (dd/mm/aaaa + 24 hs).
//
// No usamos toLocaleString/toLocaleDateString porque dependen del idioma del
// navegador: con el navegador en inglés muestran mm/dd y AM/PM.
//
// Vive aparte de main.tsx para que lo compartan la UI y los archivos que se
// descargan (informe de un evento en CSV y PDF): si la pantalla dice una hora,
// el archivo tiene que decir la misma.

export function toDateOrNull(value: string | Date | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate24(value: string | Date | undefined): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatTime24(
  value: string | Date | undefined,
  withSeconds = false,
): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad2(date.getSeconds())}` : base;
}

export function formatDateTime24(value: string | Date | undefined): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  return `${formatDate24(date)} ${formatTime24(date)}`;
}

// Día y mes cortos ("mié 15 oct") para las tarjetas de evento, donde la fecha
// completa no entra y lo que importa es ubicarla en la semana. El locale va
// explícito: sin eso, un navegador en inglés diría "Wed 15 Oct".
export function formatDayMonthShort(value: string | Date | undefined): string {
  const date = toDateOrNull(value);
  if (!date) {
    return "—";
  }
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).formatToParts(date);
  const part = (type: string): string =>
    parts.find((entry) => entry.type === type)?.value.replace(".", "") ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}
