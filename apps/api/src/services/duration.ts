// La duración de un evento se CARGA en horas (la web convierte a minutos al
// guardar, que es la unidad de la base) y se muestra siempre en horas: 180 min
// → "3 hs", 90 → "1.5 hs", 13 → "0.22 hs". Sin decimales de más, así el caso
// normal queda redondo.
export function formatDurationHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 100) / 100} hs`;
}
