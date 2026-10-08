// Comparación de nombres de personaje entre Warcraft Logs (que no trae reino)
// y las inscripciones de los eventos (guardadas a veces como "Personaje-Reino").

// Un typo de una letra en un nombre de 6 letras ya da 0.83; con 0.7 entran los
// que tienen dos letras cambiadas sobre 10. Por debajo de eso es adivinar.
const SIMILAR_NAME_MIN_RATIO = 0.7;
// Los nombres de 1 a 3 letras se parecen entre sí por casualidad.
const SIMILAR_NAME_MIN_LENGTH = 4;
// Si dos candidatos quedan casi igual de parecidos no se elige ninguno: en una
// misma raid puede haber "Azzai" y "Azzaio", y atribuirle los pulls a la
// persona equivocada es peor que dejar que el staff lo confirme.
const SIMILAR_NAME_MIN_MARGIN = 0.1;

// Clave de comparación: sin acentos, sin signos y en minúsculas.
export function nameKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

// Igual que nameKey pero quedándose con el nombre antes del reino.
export function characterKey(value: string | null | undefined): string {
  return nameKey((value ?? "").split("-")[0]);
}

function levenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0 || right.length === 0) {
    return left.length || right.length;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

// Parecido entre dos nombres, de 0 (nada) a 1 (iguales).
export function nameSimilarity(left: string, right: string): number {
  const a = nameKey(left);
  const b = nameKey(right);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) {
    return 0;
  }
  return 1 - levenshtein(a, b) / longest;
}

// El candidato más parecido al nombre buscado, o null si ninguno se parece lo
// suficiente o si hay empate entre los dos mejores.
export function bestSimilarName(
  target: string,
  candidates: string[],
): { name: string; ratio: number } | null {
  if (nameKey(target).length < SIMILAR_NAME_MIN_LENGTH) {
    return null;
  }
  const scored: Array<{ name: string; ratio: number }> = [];
  for (const candidate of candidates) {
    if (nameKey(candidate).length < SIMILAR_NAME_MIN_LENGTH) {
      continue;
    }
    const ratio = nameSimilarity(target, candidate);
    if (ratio >= SIMILAR_NAME_MIN_RATIO) {
      scored.push({ name: candidate, ratio });
    }
  }
  if (scored.length === 0) {
    return null;
  }
  scored.sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name));
  const [best, runnerUp] = scored;
  if (runnerUp && best.ratio - runnerUp.ratio < SIMILAR_NAME_MIN_MARGIN) {
    return null;
  }
  return best;
}
