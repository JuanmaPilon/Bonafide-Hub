import type { CSSProperties } from "react";

// ── Colores de roles de Discord ─────────────────────────────────────
// El perfil, el ranking, el editor de XP y el panel Admin pintan roles: la
// lógica vive acá para que un rol se vea igual en todos lados.

export type RoleColorInput = {
  color?: number;
  secondaryColor?: number;
};

function rgbFromHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

// El mismo color con transparencia: fondo tenido de un chip. Se calcula acá (y
// no con color-mix en CSS) para que se vea igual en cualquier navegador.
export function tintHex(hex: string, alpha: number): string {
  const [r, g, b] = rgbFromHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Un rol puede venir sin color (0), con un color pleno o con DOS colores: los
// degradados de Discord llegan en `colors` y el legacy `color` solo trae el
// principal (y en algunos roles viene en 0).
export function roleColorHex(value: number | undefined): string | null {
  if (!value) {
    return null;
  }
  return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}

// ¿El color es tan claro que sobre el fondo claro no se leería (blanco,
// amarillo pálido)? El JS solo marca el caso; el tema lo resuelve el CSS
// (.role-chip--pale). El umbral es alto a propósito: los colores vivos (el
// verde de Rank 5, el dorado de Gold) se dejan tal cual.
function isPaleRoleColor(hex: string): boolean {
  const [r, g, b] = rgbFromHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 190;
}

// El caso simétrico: un color casi negro (los grises de Discord, ej. Unrank)
// desaparece sobre el fondo oscuro del tema dark.
function isDarkRoleColor(hex: string): boolean {
  const [r, g, b] = rgbFromHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
}

export function roleChipClass(role: RoleColorInput): string {
  const primary = roleColorHex(role.color);
  if (!primary) {
    return "role-chip";
  }
  const secondary = roleColorHex(role.secondaryColor);
  return [
    "role-chip",
    "role-chip--colored",
    secondary && secondary !== primary ? "role-chip--gradient" : null,
    isPaleRoleColor(primary) ? "role-chip--pale" : null,
    isDarkRoleColor(primary) ? "role-chip--dark" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function roleChipStyle(role: RoleColorInput): CSSProperties | undefined {
  const primary = roleColorHex(role.color);
  if (!primary) {
    return undefined;
  }
  const secondaryRaw = roleColorHex(role.secondaryColor);
  const secondary =
    secondaryRaw && secondaryRaw !== primary ? secondaryRaw : null;
  return {
    "--role-border": tintHex(primary, 0.5),
    "--role-color": primary,
    "--role-color-2": secondary ?? primary,
    "--role-tint": tintHex(primary, 0.16),
    "--role-tint-2": tintHex(secondary ?? primary, 0.16),
  } as CSSProperties;
}

// Estilo del NOMBRE de un miembro según el color de su rango: un color pleno
// con brillo, o un DEGRADADO si el rango tiene segundo color (el mismo efecto
// que los roles con degradado de Discord). Se aplica al elemento que contiene el
// texto, así el caso degradado puede recortarlo con background-clip (el relleno
// transparente se hereda a los hijos).
export function roleNameStyle(
  color: string | undefined,
  secondary: string | undefined,
  glow = true,
): CSSProperties | undefined {
  if (!color) {
    return undefined;
  }
  if (secondary && secondary !== color) {
    return {
      backgroundClip: "text",
      backgroundImage: `linear-gradient(90deg, ${color}, ${secondary})`,
      color: "transparent",
      // Con el relleno transparente, text-shadow no se ve: el brillo va con
      // drop-shadow, que sigue la forma del degradado.
      filter: glow
        ? `drop-shadow(0 0 3px ${tintHex(color, 0.7)}) drop-shadow(0 0 9px ${tintHex(color, 0.35)})`
        : undefined,
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
    };
  }
  return glow
    ? { color, textShadow: `0 0 6px ${color}, 0 0 14px ${color}66` }
    : { color };
}
