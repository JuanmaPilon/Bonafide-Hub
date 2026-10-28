// Cada cuánto se repite una serie de eventos. Vive aparte de app.ts porque es
// lógica pura (sin base ni Discord) y es la que decide las fechas de todas las
// ocurrencias: si se equivoca, la serie se corre de día.
export const RECURRENCE_UNITS = ["days", "weeks", "months"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export function parseRecurrenceUnit(value: unknown): RecurrenceUnit | null {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  return (RECURRENCE_UNITS as readonly string[]).includes(key)
    ? (key as RecurrenceUnit)
    : null;
}

// Paso de una serie: las series viejas sólo tienen `everyDays`, así que se leen
// como días. Sin nada, se asume semanal, que es el default histórico.
export function recurrenceStep(event: {
  recurrenceEvery?: number | null;
  recurrenceEveryDays?: number | null;
  recurrenceUnit?: string | null;
}): { count: number; unit: RecurrenceUnit } {
  const count = event.recurrenceEvery ?? event.recurrenceEveryDays ?? 7;
  return {
    count: Math.max(1, Math.trunc(count)),
    unit: parseRecurrenceUnit(event.recurrenceUnit) ?? "days",
  };
}

// Días del mes `month` (0-11) del año `year`.
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Avanza una fecha en la unidad pedida.
//
// Los días y las semanas se pueden sumar en milisegundos; los MESES no: un mes
// no tiene una cantidad fija de días. Además `setMonth` desborda (el 31 de
// enero + 1 mes da el 3 de marzo, porque febrero no tiene 31), así que hay que
// fijar el día en 1 antes de mover el mes y después volver al día original o al
// último del mes si no existe. Ese paso es el que evita que una serie mensual
// se vaya corriendo sola.
//
// Efecto conocido: una serie mensual que arranca un 31 pasa a caer el 28 (o 29)
// en los meses cortos y ya no vuelve al 31, porque el paso se calcula sobre la
// fecha anterior. Para un cumpleaños (paso de 12 meses) no aplica: el mismo mes
// del año siguiente tiene la misma cantidad de días, salvo el 29 de febrero.
export function advanceByUnit(
  date: Date,
  count: number,
  unit: RecurrenceUnit,
): Date {
  if (unit === "months") {
    const day = date.getDate();
    // Se trabaja en UTC para que el paso no dependa del huso del servidor: con
    // hora local, un cambio de horario de verano podía mover el resultado una
    // hora y hacer que una ocurrencia cayera el día anterior.
    const moved = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + count,
        1,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
      ),
    );
    const lastDay = daysInMonth(moved.getUTCFullYear(), moved.getUTCMonth());
    moved.setUTCDate(Math.min(day, lastDay));
    return moved;
  }

  const stepDays = unit === "weeks" ? count * 7 : count;
  return new Date(date.getTime() + stepDays * 24 * 60 * 60 * 1000);
}

// Avanza una fecha varios pasos (para recuperar una serie que quedó atrás).
export function advanceSteps(
  date: Date,
  count: number,
  unit: RecurrenceUnit,
  steps: number,
): Date {
  let current = date;
  for (let index = 0; index < steps; index += 1) {
    current = advanceByUnit(current, count, unit);
  }
  return current;
}

// Cuántos pasos hacen falta para llegar a `target` (o pasarlo).
export function stepsUntil(
  from: Date,
  target: Date,
  count: number,
  unit: RecurrenceUnit,
): number {
  if (from.getTime() >= target.getTime()) {
    return 0;
  }
  // Estimación para arrancar cerca y después corrección paso a paso. Con meses
  // se usa el promedio de 30,44 días: alcanza para no iterar cientos de veces
  // en una serie que estuvo caída años, y el bucle corrige el resto.
  const dayMs = 24 * 60 * 60 * 1000;
  const stepDays = unit === "months" ? 30.44 * count : count * (unit === "weeks" ? 7 : 1);
  const rough = Math.max(
    1,
    Math.floor((target.getTime() - from.getTime()) / (stepDays * dayMs)),
  );
  let steps = 0;
  let current = from;
  // El tope es la estimación con margen: si el promedio se quedó corto, el
  // bucle sigue hasta pasar el objetivo.
  const limite = rough + 64;
  while (current.getTime() < target.getTime() && steps < limite) {
    current = advanceByUnit(current, count, unit);
    steps += 1;
  }
  return steps;
}
