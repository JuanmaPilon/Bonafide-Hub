import type { EventRoleOption } from "./guild-config-store.js";

// ── Plantillas de juego para el módulo de eventos ───────────────────
// Una plantilla deja el módulo listo para un juego: roles de inscripción,
// nombres de los dos ejes (clase/spec) y el catálogo de clases y specs para
// precargar. Los EMOJIS de cada spec no se precargan (son emojis custom que
// sube el staff); sí se precargan los roles, que tienen un emoji unicode.
//
// Es data pura: agregar un juego nuevo = agregar un objeto a esta lista.

export type EventTemplateSpec = {
  className: string;
  role: string;
  specName: string;
};

export type EventTemplate = {
  classLabel: string;
  description: string;
  key: string;
  label: string;
  roles: EventRoleOption[];
  specEnabled: boolean;
  specLabel: string;
  specs: EventTemplateSpec[];
};

type TemplateClass = {
  name: string;
  specs: Array<[specName: string, role: string]>;
};

// Clases y specs de WoW con su rol de inscripción. Es solo el esqueleto para
// arrancar: cada guild después carga los emojis de las specs que use.
const WOW_CLASSES: TemplateClass[] = [
  {
    name: "Death Knight",
    specs: [
      ["Blood", "tank"],
      ["Frost", "melee"],
      ["Unholy", "melee"],
    ],
  },
  {
    name: "Demon Hunter",
    specs: [
      ["Havoc", "melee"],
      ["Vengeance", "tank"],
    ],
  },
  {
    name: "Druid",
    specs: [
      ["Balance", "ranged"],
      ["Feral", "melee"],
      ["Guardian", "tank"],
      ["Restoration", "healer"],
    ],
  },
  {
    name: "Evoker",
    specs: [
      ["Devastation", "ranged"],
      ["Preservation", "healer"],
      ["Augmentation", "ranged"],
    ],
  },
  {
    name: "Hunter",
    specs: [
      ["Beast Mastery", "ranged"],
      ["Marksmanship", "ranged"],
      ["Survival", "melee"],
    ],
  },
  {
    name: "Mage",
    specs: [
      ["Arcane", "ranged"],
      ["Fire", "ranged"],
      ["Frost", "ranged"],
    ],
  },
  {
    name: "Monk",
    specs: [
      ["Brewmaster", "tank"],
      ["Mistweaver", "healer"],
      ["Windwalker", "melee"],
    ],
  },
  {
    name: "Paladin",
    specs: [
      ["Holy", "healer"],
      ["Protection", "tank"],
      ["Retribution", "melee"],
    ],
  },
  {
    name: "Priest",
    specs: [
      ["Discipline", "healer"],
      ["Holy", "healer"],
      ["Shadow", "ranged"],
    ],
  },
  {
    name: "Rogue",
    specs: [
      ["Assassination", "melee"],
      ["Outlaw", "melee"],
      ["Subtlety", "melee"],
    ],
  },
  {
    name: "Shaman",
    specs: [
      ["Elemental", "ranged"],
      ["Enhancement", "melee"],
      ["Restoration", "healer"],
    ],
  },
  {
    name: "Warlock",
    specs: [
      ["Affliction", "ranged"],
      ["Demonology", "ranged"],
      ["Destruction", "ranged"],
    ],
  },
  {
    name: "Warrior",
    specs: [
      ["Arms", "melee"],
      ["Fury", "melee"],
      ["Protection", "tank"],
    ],
  },
];

function buildSpecs(classes: TemplateClass[]): EventTemplateSpec[] {
  return classes.flatMap((entry) =>
    entry.specs.map(([specName, role]) => ({
      className: entry.name,
      role,
      specName,
    })),
  );
}

function role(key: string, label: string, emoji: string): EventRoleOption {
  return { animated: false, emoji, key, label };
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  {
    classLabel: "Clase",
    description:
      "Tank, Healer, Melee y Range + el catálogo de las 13 clases con sus specs.",
    key: "wow",
    label: "World of Warcraft",
    roles: [
      role("tank", "Tank", "🛡️"),
      role("healer", "Healer", "💚"),
      role("melee", "Melee", "⚔️"),
      role("ranged", "Range", "🏹"),
    ],
    specEnabled: true,
    specLabel: "Spec",
    specs: buildSpecs(WOW_CLASSES),
  },
  {
    classLabel: "Campeón",
    description:
      "Top, Jungle, Mid, ADC y Support, con un solo eje (no se elige spec).",
    key: "lol",
    label: "League of Legends",
    roles: [
      role("top", "Top", "⬆️"),
      role("jungle", "Jungle", "🌲"),
      role("mid", "Mid", "🎯"),
      role("adc", "ADC", "🏹"),
      role("support", "Support", "💚"),
    ],
    specEnabled: false,
    specLabel: "Spec",
    specs: [],
  },
  {
    classLabel: "Clase",
    description:
      "Solo los 4 roles clásicos, sin catálogo de clases (cargalo a mano).",
    key: "generico",
    label: "Genérico (4 roles)",
    roles: [
      role("tank", "Tank", "🛡️"),
      role("healer", "Healer", "💚"),
      role("melee", "Melee", "⚔️"),
      role("ranged", "Range", "🏹"),
    ],
    specEnabled: true,
    specLabel: "Spec",
    specs: [],
  },
];

export function findEventTemplate(
  key: string | undefined,
): EventTemplate | null {
  if (!key) {
    return null;
  }
  return (
    EVENT_TEMPLATES.find(
      (template) => template.key === key.trim().toLowerCase(),
    ) ?? null
  );
}

// Resumen para el listado (sin mandar todo el catálogo de specs al front).
export function summarizeEventTemplate(template: EventTemplate): {
  classLabel: string;
  description: string;
  key: string;
  label: string;
  roles: EventRoleOption[];
  specCount: number;
  specEnabled: boolean;
  specLabel: string;
} {
  return {
    classLabel: template.classLabel,
    description: template.description,
    key: template.key,
    label: template.label,
    roles: template.roles,
    specCount: template.specs.length,
    specEnabled: template.specEnabled,
    specLabel: template.specLabel,
  };
}
