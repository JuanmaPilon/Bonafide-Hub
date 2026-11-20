import { readFileSync } from "node:fs";

// Railway factura la memoria del contenedor, que incluye la caché de archivos
// del kernel. Esa caché sólo se libera al reiniciar (dentro del contenedor
// `memory.reclaim` es de sólo lectura), así que crece hasta que el contenedor
// se recicla. Salir con código 1 hace que Railway levante uno nuevo: el
// servicio tiene `restartPolicyType: ON_FAILURE`.
//
// No es un leak: el proceso del bot usa ~126 MB de `Rss` mientras el
// contenedor llegó a facturar 396 MB, casi todo `file`.

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
// Sin este piso, un umbral mal puesto dejaría el bot en un bucle de reinicios:
// el proceso recién arrancado se mataría a sí mismo antes de que nadie lo note.
const MIN_UPTIME_MS = 20 * 60 * 1000;

const CGROUP_PATHS = [
  "/sys/fs/cgroup/memory.current",
  "/sys/fs/cgroup/memory/memory.usage_in_bytes",
];

function cgroupBytes(): number | null {
  for (const path of CGROUP_PATHS) {
    try {
      const value = Number(readFileSync(path, "utf8").trim());
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    } catch {
      // Sin cgroup legible (desarrollo local) no hay nada que vigilar.
    }
  }
  return null;
}

// Decisión pura, para poder probarla sin cgroup ni timers.
export function shouldRestart(input: {
  limitMb: number;
  usedBytes: number | null;
  uptimeMs: number;
}): boolean {
  const limitBytes = input.limitMb * 1024 * 1024;
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    return false;
  }
  // Arrancando: el tope no se evalúa todavía para no entrar en un bucle.
  if (input.uptimeMs < MIN_UPTIME_MS) {
    return false;
  }
  return input.usedBytes !== null && input.usedBytes >= limitBytes;
}

export function startMemoryGuard(input: {
  // Con 0 o sin valor el guardia queda apagado.
  limitMb: number;
  name: string;
  shutdown?: () => Promise<unknown>;
}): void {
  if (!Number.isFinite(input.limitMb) || input.limitMb <= 0) {
    return;
  }

  let fired = false;
  setInterval(() => {
    if (fired) {
      return;
    }
    const used = cgroupBytes();
    if (
      !shouldRestart({
        limitMb: input.limitMb,
        uptimeMs: process.uptime() * 1000,
        usedBytes: used,
      })
    ) {
      return;
    }
    fired = true;
    const usedMb = Math.round((used ?? 0) / 1024 / 1024);
    console.log(
      `[mem-guard] ${input.name}: ${usedMb} MB sobre el tope de ${input.limitMb} MB, se reinicia para liberar la caché`,
    );
    void (async () => {
      try {
        await input.shutdown?.();
      } catch {
        // Si el cierre limpio falla, se sale igual: el reinicio es el objetivo.
      }
      process.exit(1);
    })();
  }, CHECK_INTERVAL_MS).unref();
}
