import { prisma } from "../db/prisma.js";

// Plantillas de rol guardadas por la guild (Admin → Roles → Plantillas).
// Los datos apuntan a crear un rol en Discord: nombre, color hex, hoist,
// mentionable y el bitfield de permisos como texto (igual que Discord).

export type RoleTemplate = {
  color: string;
  // Segundo color del degradado (null = color plano).
  colorSecondary: string | null;
  createdAt: Date;
  hoist: boolean;
  id: string;
  label: string;
  mentionable: boolean;
  permissions: string;
};

export const MAX_ROLE_TEMPLATES = 30;

// Color hex (#rrggbb) o null si no es válido.
export function normalizeRoleColor(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  const match = /^#?([0-9a-f]{6})$/.exec(raw);
  return match ? `#${match[1]}` : null;
}

// Bitfield de permisos: solo dígitos (Discord lo manda como string). Acepta
// número por comodidad y lo pasa a texto.
export function normalizePermissions(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.max(Math.trunc(value), 0));
  }
  const raw = String(value ?? "").trim();
  return /^\d{1,20}$/.test(raw) ? raw : null;
}

export type RoleTemplateInput = {
  color: string;
  colorSecondary: string | null;
  hoist: boolean;
  label: string;
  mentionable: boolean;
  permissions: string;
};

// Sanea lo que manda el panel. Devuelve null si falta algo obligatorio.
export function normalizeRoleTemplateInput(
  value: unknown,
): RoleTemplateInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const label = String(raw.label ?? "")
    .trim()
    .slice(0, 60);
  const color = normalizeRoleColor(raw.color);
  const permissions = normalizePermissions(raw.permissions ?? "0");
  if (!label || !color || permissions === null) {
    return null;
  }
  return {
    color,
    colorSecondary: raw.colorSecondary
      ? normalizeRoleColor(raw.colorSecondary)
      : null,
    hoist: raw.hoist === true,
    label,
    mentionable: raw.mentionable === true,
    permissions,
  };
}

export async function listRoleTemplates(
  guildId: string,
): Promise<RoleTemplate[]> {
  return prisma.roleTemplate.findMany({
    orderBy: { label: "asc" },
    where: { guildId },
  });
}

// Guarda una plantilla con ese nombre (si ya existe, la actualiza: es lo que
// espera el botón "Guardar como plantilla" cuando repetís el mismo nombre).
export async function saveRoleTemplate(
  guildId: string,
  input: RoleTemplateInput,
): Promise<RoleTemplate> {
  return prisma.roleTemplate.upsert({
    create: { guildId, ...input },
    update: {
      color: input.color,
      colorSecondary: input.colorSecondary,
      hoist: input.hoist,
      mentionable: input.mentionable,
      permissions: input.permissions,
    },
    where: { guildId_label: { guildId, label: input.label } },
  });
}

export async function deleteRoleTemplate(
  guildId: string,
  templateId: string,
): Promise<boolean> {
  const result = await prisma.roleTemplate.deleteMany({
    where: { guildId, id: templateId },
  });
  return result.count > 0;
}
