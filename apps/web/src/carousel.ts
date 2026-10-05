// Auto-avance del carrusel del dashboard. Puro y separado del DOM a propósito:
// los bordes (cuándo volver al principio, no pasarse del final) son lo único que
// puede fallar, y así se verifica sin navegador.

export type CarouselScrollTarget = {
  behavior: ScrollBehavior;
  left: number;
};

export function nextAutoScroll(input: {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
  step: number;
}): CarouselScrollTarget | null {
  const maxScroll = input.scrollWidth - input.clientWidth;
  // Nada cortado: no hay a dónde moverse.
  if (maxScroll <= 1) {
    return null;
  }
  // Al final: volver al principio de un salto (rebobinar animado mareaba). Si ya
  // está en el principio no hay nada que hacer, así el que llama no repite un
  // no-op en cada tick.
  if (input.scrollLeft >= maxScroll - 2) {
    return input.scrollLeft <= 1 ? null : { behavior: "auto", left: 0 };
  }
  return {
    behavior: "smooth",
    left: Math.min(input.scrollLeft + input.step, maxScroll),
  };
}
