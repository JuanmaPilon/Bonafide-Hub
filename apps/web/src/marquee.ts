// Motor del carrusel del dashboard (marquee).
//
// No usa una animación CSS a propósito: con `animation` el `transform` lo maneja
// el navegador, así que no se puede "agarrar" el carrusel y moverlo. Acá la
// posición es un número que avanza solo con requestAnimationFrame y que el
// arrastre modifica; al soltar, la velocidad del gesto se disuelve en la de
// crucero, así sigue andando.
//
// El track viene con la lista repetida: la mitad es idéntica a la otra mitad, así
// que mover la posición dentro de esa mitad (el "largo del bucle") no deja
// costura. Ver en el componente cuántas repeticiones se arman.

// Techo del envión al soltar: un gesto rápido no debería mandar el carrusel a
// volar (a 43px/s de crucero, 700 sigue siendo un empujón notorio).
export const MARQUEE_MAX_FLING_PX_PER_S = 700;
// Si el gesto termina casi quieto, se retoma la velocidad de crucero de una en
// vez (en vez de arrancar de cero y tardar en recuperar).
const FLING_THRESHOLD = 0.35;
// Qué tan rápido la velocidad vuelve a la de crucero.
const SPEED_RECOVERY = 2.5;

export type MarqueeOptions = {
  // Velocidad de crucero en px/s (positiva = hacia la izquierda, que es lo normal).
  speed: number;
  track: HTMLElement;
};

export type Marquee = { destroy: () => void };

// Posición dentro del bucle, siempre positiva (el módulo de JS no lo es).
export function wrapOffset(offset: number, loopWidth: number): number {
  if (loopWidth <= 0) {
    return 0;
  }
  return ((offset % loopWidth) + loopWidth) % loopWidth;
}

// Velocidad un instante después: se acerca a la de crucero sin pegar el salto.
export function approachSpeed(
  current: number,
  target: number,
  dt: number,
): number {
  const next = current + (target - current) * Math.min(1, dt * SPEED_RECOVERY);
  return Math.abs(next - target) < 1 ? target : next;
}

export function clampFling(speed: number): number {
  return Math.max(
    -MARQUEE_MAX_FLING_PX_PER_S,
    Math.min(MARQUEE_MAX_FLING_PX_PER_S, speed),
  );
}

export function createMarquee(options: MarqueeOptions): Marquee {
  const { track } = options;
  // Sin animaciones, no hay carrusel: la fila queda quieta y tampoco se arrastra
  // (arrastrar también es movimiento). Lo decide el motor y no quien lo llama,
  // así hay una sola fuente de verdad.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return { destroy(): void {} };
  }

  const cruise = options.speed;
  let dragging = false;
  let frame = 0;
  let lastMoveAt = 0;
  let lastX = 0;
  let offset = 0;
  let pointerId: number | null = null;
  let previous = performance.now();
  // Velocidad medida durante el gesto: es lo que se conserva al soltar.
  let speed = cruise;

  // Largo del bucle: la mitad del track, que es la repetición exacta de la otra
  // mitad. Verificado con capturas: mover la posición un bucle entero deja la
  // fila pixel a pixel igual, así que la costura no se ve.
  const loopWidth = (): number => track.scrollWidth / 2;

  const render = (): void => {
    track.style.transform = `translate3d(${-wrapOffset(offset, loopWidth())}px, 0, 0)`;
  };

  const tick = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (!dragging) {
      speed = approachSpeed(speed, cruise, dt);
      offset += speed * dt;
      render();
    }
    frame = window.requestAnimationFrame(tick);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) {
      return;
    }
    dragging = false;
    pointerId = null;
    // Lo soltado sigue: si el gesto venía lento se retoma la velocidad de
    // crucero, y si venía lanzado el envión se disuelve solo.
    speed =
      Math.abs(speed) < Math.abs(cruise) * FLING_THRESHOLD
        ? cruise
        : clampFling(speed);
    track.style.cursor = "grab";
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastMoveAt = performance.now();
    speed = 0;
    // Se captura el puntero: el gesto sigue aunque salga del carrusel. Puede
    // tirar si el puntero ya no está activo (evento sintético): no es motivo
    // para dejar el arrastre a medias.
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      // Sin captura el gesto igual funciona mientras no salga del carrusel.
    }
    track.style.cursor = "grabbing";
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    const dx = event.clientX - lastX;
    if (dx === 0) {
      return;
    }
    const now = performance.now();
    const dt = Math.max(8, now - lastMoveAt) / 1000;
    lastX = event.clientX;
    lastMoveAt = now;
    // Arrastrar hacia la izquierda corre el carrusel hacia adelante.
    speed = -dx / dt;
    offset -= dx;
    render();
  };

  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("pointerdown", onPointerDown);
  track.addEventListener("pointermove", onPointerMove);
  track.addEventListener("pointerup", endDrag);
  track.style.cursor = "grab";
  render();
  frame = window.requestAnimationFrame(tick);

  return {
    destroy(): void {
      window.cancelAnimationFrame(frame);
      track.removeEventListener("pointercancel", endDrag);
      track.removeEventListener("pointerdown", onPointerDown);
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", endDrag);
      track.style.cursor = "";
      track.style.transform = "";
    },
  };
}
