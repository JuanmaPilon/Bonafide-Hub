// Duración de un evento: se CARGA y se MUESTRA en horas. El API (y la base)
// guardan MINUTOS, que es también lo que usa Discord para calcular el final, así
// que la conversión vive acá y no en cada formulario o tarjeta.
//
// Ojo con los decimales: la base guarda minutos enteros, así que 0.21 hs
// (12.6 min) se guarda como 13 min y al reabrir se ve 0.22. Los valores redondos
// (0.25, 0.5, 1.5, 3…) vuelven exactos.

// Minutos → horas listas para mostrar/cargar, sin decimales de más:
// 180 → "3", 90 → "1.5", 13 → "0.22".
export function hoursFromMinutes(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}

// Horas escritas en el formulario → minutos para el API. Vacío, cero o cualquier
// cosa que no sea un número positivo es "sin duración" (undefined).
export function minutesFromHours(value: string): number | undefined {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0
    ? Math.round(hours * 60)
    : undefined;
}
