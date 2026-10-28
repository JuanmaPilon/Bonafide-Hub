// Catálogo de etiquetas de la guild (Admin → Etiquetas). Antes cada registro
// guardaba sus etiquetas y nada más: para repetir una había que volver a
// escribirla y elegir el color a mano. Ahora hay una lista por guild de la que
// eligen los editores.
//
// El catálogo NO es la fuente de verdad de los registros: cada evento,
// comunicado o ficha sigue guardando su propia copia `{ label, color }`. Eso
// deja cambiar o borrar una etiqueta del catálogo sin reescribir el historial.

import { prisma } from "../db/prisma.js";
import {
  DEFAULT_TAG_COLOR,
  normalizeTags,
  tagsFromRecord,
  type Tag,
} from "./tags.js";

export type GuildTag = Tag & { id: string };

// Mismo tope que el editor y que `normalizeTags`.
const MAX_LABEL_LENGTH = 24;

function normalizeLabel(value: unknown): string {
  return String(value ?? "")
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
}

function toGuildTag(record: {
  color: string;
  id: string;
  label: string;
}): GuildTag {
  return { color: record.color, id: record.id, label: record.label };
}

// El color de una etiqueta nueva pasa por `normalizeTags` para reusar la misma
// validación de hex que el resto del API (y su default).
function normalizeColor(value: unknown): string {
  const [tag] = normalizeTags([{ color: value, label: "x" }]);
  return tag?.color ?? DEFAULT_TAG_COLOR;
}

export async function listGuildTags(guildId: string): Promise<GuildTag[]> {
  const records = await prisma.guildTag.findMany({
    where: { guildId },
    orderBy: { label: "asc" },
  });
  return records.map(toGuildTag);
}

export type TagWriteResult =
  | { ok: true; tag: GuildTag }
  | { ok: false; error: "duplicate" | "empty" };

export async function createGuildTag(input: {
  color?: string;
  guildId: string;
  label: string;
}): Promise<TagWriteResult> {
  const label = normalizeLabel(input.label);
  if (!label) {
    return { ok: false, error: "empty" };
  }

  // El unique de la base es por label exacto; "PvP" y "pvp" son duplicados
  // igual para quien lee el panel, así que se comparan sin mayúsculas.
  const existing = await prisma.guildTag.findMany({
    where: { guildId: input.guildId },
    select: { label: true },
  });
  const normalized = label.toLowerCase();
  if (existing.some((tag) => tag.label.toLowerCase() === normalized)) {
    return { ok: false, error: "duplicate" };
  }

  const record = await prisma.guildTag.create({
    data: {
      color: normalizeColor(input.color),
      guildId: input.guildId,
      label,
    },
  });
  return { ok: true, tag: toGuildTag(record) };
}

export async function updateGuildTag(input: {
  color?: string;
  guildId: string;
  id: string;
  label?: string;
}): Promise<TagWriteResult | null> {
  const current = await prisma.guildTag.findFirst({
    where: { guildId: input.guildId, id: input.id },
  });
  if (!current) {
    return null;
  }

  const label =
    input.label === undefined ? current.label : normalizeLabel(input.label);
  if (!label) {
    return { ok: false, error: "empty" };
  }

  if (label.toLowerCase() !== current.label.toLowerCase()) {
    const others = await prisma.guildTag.findMany({
      where: { guildId: input.guildId, NOT: { id: input.id } },
      select: { label: true },
    });
    if (others.some((tag) => tag.label.toLowerCase() === label.toLowerCase())) {
      return { ok: false, error: "duplicate" };
    }
  }

  const record = await prisma.guildTag.update({
    where: { id: input.id },
    data: {
      ...(input.label !== undefined ? { label } : {}),
      ...(input.color !== undefined
        ? { color: normalizeColor(input.color) }
        : {}),
    },
  });
  return { ok: true, tag: toGuildTag(record) };
}

export async function deleteGuildTag(
  guildId: string,
  id: string,
): Promise<boolean> {
  const result = await prisma.guildTag.deleteMany({ where: { guildId, id } });
  return result.count > 0;
}

// Importa al catálogo las etiquetas que ya están en uso en la guild, para no
// perder lo cargado antes de que existiera esta pantalla. Corre una sola vez:
// si el catálogo ya tiene algo, no hace nada (así borrar una etiqueta a mano no
// se deshace en la próxima visita).
export async function seedGuildTagsFromUsage(
  guildId: string,
): Promise<number> {
  const existing = await prisma.guildTag.count({ where: { guildId } });
  if (existing > 0) {
    return 0;
  }

  const [events, communications, profiles] = await Promise.all([
    prisma.hubEvent.findMany({
      where: { guildId },
      select: { tagColor: true, tagLabel: true, tags: true },
    }),
    prisma.communication.findMany({
      where: { guildId },
      select: { tagColor: true, tagLabel: true, tags: true },
    }),
    prisma.rosterProfile.findMany({
      where: { guildId },
      select: { tags: true },
    }),
  ]);

  const byLabel = new Map<string, Tag>();
  for (const record of [...events, ...communications, ...profiles]) {
    for (const tag of tagsFromRecord(record)) {
      const key = tag.label.toLowerCase();
      if (!byLabel.has(key)) {
        byLabel.set(key, tag);
      }
    }
  }

  if (byLabel.size === 0) {
    return 0;
  }

  const result = await prisma.guildTag.createMany({
    data: [...byLabel.values()].map((tag) => ({
      color: tag.color,
      guildId,
      label: tag.label,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
