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
  key: string;
  label: string;
  // Plantilla de ENCUESTA: además del aviso, el evento se publica como
  // encuesta nativa de Discord (una respuesta por rol, con ✅/❌).
  poll?: boolean;
  roles: EventRoleOption[];
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
    key: "wow",
    label: "World of Warcraft",
    roles: [
      role("tank", "Tank", "🛡️"),
      role("healer", "Healer", "💚"),
      role("melee", "Melee", "⚔️"),
      role("ranged", "Range", "🏹"),
    ],
    specs: buildSpecs(WOW_CLASSES),
  },
  {
    key: "lol",
    label: "League of Legends",
    roles: [
      role("top", "Top", "⬆️"),
      role("jungle", "Jungle", "🌲"),
      role("mid", "Mid", "🎯"),
      role("adc", "ADC", "🏹"),
      role("support", "Support", "💚"),
    ],
    specs: [],
  },
  {
    key: "encuesta",
    label: "Encuesta (SI / NO)",
    poll: true,
    roles: [role("si", "SI", "✅"), role("no", "NO", "❌")],
    specs: [],
  },
];

// Catálogo de clases/specs tal como está en el código. Sin `game` devuelve el
// de todos los juegos, cada fila con su juego.
export function listTemplateSpecs(
  game?: string | null,
): Array<EventTemplateSpec & { game: string }> {
  const key = game?.trim().toLowerCase();
  const templates = key
    ? EVENT_TEMPLATES.filter((template) => template.key === key)
    : EVENT_TEMPLATES;
  return templates.flatMap((template) =>
    template.specs.map((spec) => ({ ...spec, game: template.key })),
  );
}

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
  key: string;
  label: string;
  poll: boolean;
  roles: EventRoleOption[];
} {
  return {
    key: template.key,
    label: template.label,
    poll: template.poll === true,
    roles: template.roles,
  };
}
