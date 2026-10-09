import type { RaidConsumableKey, RaidLogAnalysis, RaidRole } from "./api";

// Etiquetas de una sola fuente: las usan el análisis en pantalla y los informes.
export const CONSUMABLE_LABEL: Record<RaidConsumableKey, string> = {
  flask: "Flask",
  food: "Comida",
  healthPotions: "Vida",
  healthstones: "Piedra",
  potions: "Pota",
  prepot: "Prepot",
};

export const SIGNUP_STATUS_LABEL: Record<string, string> = {
  bench: "Bench",
  late: "Tarde",
  no: "No va",
  tentative: "Tentativo",
  yes: "Voy",
};

const ROLE_LABEL: Record<RaidRole, string> = {
  dps: "DPS",
  healer: "Heal",
  tank: "Tanque",
};

export type RaidLogReportSection = {
  columns: string[];
  rows: string[][];
  title: string;
};

export type RaidLogReport = {
  meta: Array<[string, string]>;
  sections: RaidLogReportSection[];
  subtitle: string;
  title: string;
};

// Arma el contenido del informe UNA vez: el CSV lo escribe tal cual y el PDF lo
// dibuja como tablas, así los dos dicen lo mismo.
export function buildRaidLogReport(input: {
  analysis: RaidLogAnalysis;
  // Los mismos jugadores que muestra la tabla de DPS en pantalla (sin heal ni
  // tank cuando el log trae los roles).
  players: RaidLogAnalysis["averageDps"];
  subtitle: string;
  title: string;
}): RaidLogReport {
  const { analysis } = input;
  const consumables = analysis.consumables;
  const expected = consumables?.expected ?? consumables?.categories ?? [];
  const reactive = (consumables?.categories ?? []).filter(
    (category) => !expected.includes(category),
  );
  const encounters = analysis.encounters;
  const kills = encounters.filter((encounter) => encounter.kill).length;
  const bosses = new Set(
    encounters.map((encounter) => encounter.boss ?? encounter.name),
  ).size;

  const meta: Array<[string, string]> = [
    ["Fecha", input.subtitle],
    ["Pulls", String(encounters.length)],
    ["Kills", String(kills)],
    ["Wipes", String(encounters.length - kills)],
    ["Bosses", String(bosses)],
  ];
  const attendance = analysis.attendance;
  if (attendance) {
    meta.push([
      "Anotados que vinieron",
      `${attendance.signedPresent}/${attendance.signedTotal}`,
    ]);
  }

  const sections: RaidLogReportSection[] = [
    {
      columns: ["Jugador", "Clase", "Rol", "DPS promedio", "Encuentros"],
      rows: input.players.map((player) => [
        player.name,
        player.class ?? "",
        player.role ? ROLE_LABEL[player.role] : "",
        String(player.averageDps),
        String(player.encounters),
      ]),
      title: "DPS promedio por encuentro",
    },
    {
      columns: ["Jugador", "Muertes"],
      rows: analysis.deathsByPlayer.map((player) => [
        player.name,
        String(player.deaths),
      ]),
      title: "Muertes",
    },
  ];

  if (consumables && expected.length > 0) {
    const rows = consumables.players
      .map((player) => ({
        misses: expected.map(
          (category) => player.pulls - (player.counts[category] ?? 0),
        ),
        player,
      }))
      .filter((entry) => entry.misses.some((value) => value > 0))
      .sort(
        (left, right) =>
          right.misses.reduce((sum, value) => sum + value, 0) -
            left.misses.reduce((sum, value) => sum + value, 0) ||
          left.player.name.localeCompare(right.player.name),
      );
    sections.push({
      columns: [
        "Jugador",
        ...expected.map(
          (category) => `Sin ${CONSUMABLE_LABEL[category].toLowerCase()}`,
        ),
        "Pulls",
      ],
      rows: rows.map(({ misses, player }) => [
        player.name,
        ...misses.map((value) => `${value}/${player.pulls}`),
        String(player.pulls),
      ]),
      title: "Consumibles que se esperan en cada pull (faltó X de Y)",
    });
  }

  if (consumables && reactive.length > 0) {
    const rows = consumables.players
      .map((player) => ({
        player,
        uses: reactive.map((category) => player.counts[category] ?? 0),
      }))
      .filter((entry) => entry.uses.some((value) => value > 0))
      .sort(
        (left, right) =>
          right.uses.reduce((sum, value) => sum + value, 0) -
            left.uses.reduce((sum, value) => sum + value, 0) ||
          left.player.name.localeCompare(right.player.name),
      );
    sections.push({
      columns: [
        "Jugador",
        ...reactive.map(
          (category) => `Usó ${CONSUMABLE_LABEL[category].toLowerCase()}`,
        ),
        "Pulls",
      ],
      rows: rows.map(({ player, uses }) => [
        player.name,
        ...uses.map((value) => `${value}/${player.pulls}`),
        String(player.pulls),
      ]),
      title: "Uso reaccional (piedra y poción de vida)",
    });
  }

  if (attendance) {
    if (attendance.unsignedPresent.length > 0) {
      sections.push({
        columns: ["Jugador", "Pulls", "Estado"],
        rows: attendance.unsignedPresent.map((player) => [
          player.name,
          String(player.pulls),
          player.status
            ? (SIGNUP_STATUS_LABEL[player.status] ?? player.status)
            : "Sin anotarse",
        ]),
        title: "Vinieron sin anotarse",
      });
    }
    const absent = [
      ...attendance.unmatchedSignups.map((signup) => ({
        name: signup.name,
        status: `${SIGNUP_STATUS_LABEL[signup.status] ?? signup.status} · sin PJ`,
      })),
      ...attendance.signedAbsent,
    ];
    if (absent.length > 0) {
      sections.push({
        columns: ["Anotado", "Estado"],
        rows: absent.map((signup) => [
          signup.name,
          SIGNUP_STATUS_LABEL[signup.status] ?? signup.status,
        ]),
        title: "Anotados que no aparecieron",
      });
    }
    if (attendance.likelyPresent.length > 0) {
      sections.push({
        columns: ["En el log", "Se anotó como", "Parecido"],
        rows: attendance.likelyPresent.map((item) => [
          item.logName,
          item.name,
          `${Math.round(item.similarity * 100)}%`,
        ]),
        title: "Parecidos sin confirmar",
      });
    }
  }

  return {
    meta,
    sections,
    subtitle: input.subtitle,
    title: input.title,
  };
}

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Mismo formato que los informes del API: punto y coma (Excel en español) y BOM
// para que Excel abra el archivo en UTF-8.
export function raidLogReportCsv(report: RaidLogReport): string {
  const rows: string[][] = [
    [report.title, report.subtitle],
    ...report.meta,
    [],
  ];
  for (const section of report.sections) {
    rows.push([section.title], section.columns, ...section.rows, []);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function raidLogReportFileName(
  report: RaidLogReport,
  extension: "csv" | "pdf",
): string {
  const slug = `${report.title}-${report.subtitle}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `reporte-${slug || "raid"}.${extension}`;
}

export function downloadTextFile(name: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// La fuente estándar de un PDF (Helvetica) no tiene glifos de emoji: en el
// archivo saldrían como cuadraditos, así que se limpian al escribir.
function pdfText(value: string): string {
  return value.replace(
    /[\u{1F000}-\u{1FAFF}\u{2100}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
    "",
  );
}

// jsPDF se importa recién al usarlo para que la librería no viaje en el bundle
// inicial.
export async function buildRaidLogReportPdf(
  report: RaidLogReport,
): Promise<RaidLogReportPdf> {  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const rowHeight = 6.4;
  const bottomLimit = pageHeight - 16;
  const line = (value: string, width: number): string => {
    const text = pdfText(value);
    if (doc.getTextWidth(text) <= width) {
      return text;
    }
    let trimmed = text;
    while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > width) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
  };

  doc.setFillColor(15, 22, 41);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Reporte de raid", marginX, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    line(`${report.title} · ${report.subtitle}`, contentWidth),
    marginX,
    20,
  );

  doc.setTextColor(45, 55, 75);
  let y = 36;
  const sidebar = 42;
  const columnStart = marginX + sidebar;

  for (const [label, value] of report.meta) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label.toUpperCase(), marginX, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(line(value, contentWidth - sidebar), columnStart, y);
    y += rowHeight;
  }

  for (const section of report.sections) {
    y += 4;
    if (y > bottomLimit - rowHeight * 2) {
      doc.addPage();
      y = 24;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(line(section.title, contentWidth), marginX, y);
    y += rowHeight + 1;

    const weights = section.columns.map((_, index) =>
      index === 0 ? 2 : 1,
    );
    const total = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map((value) => (contentWidth * value) / total);
    const cellX = (index: number): number =>
      marginX + widths.slice(0, index).reduce((sum, value) => sum + value, 0);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    section.columns.forEach((column, index) => {
      doc.text(line(column, widths[index] - 2), cellX(index), y);
    });
    y += rowHeight;

    doc.setFont("helvetica", "normal");
    for (const row of section.rows) {
      if (y > bottomLimit) {
        doc.addPage();
        y = 24;
      }
      row.forEach((cell, index) => {
        doc.text(line(cell, widths[index] - 2), cellX(index), y);
      });
      y += rowHeight;
    }
  }

  return doc;
}

// Lo que necesita el navegador para bajarlo: el tipo lo declara la web así este
// módulo no depende de jsPDF en tiempo de import.
export type RaidLogReportPdf = {
  output: (type: "arraybuffer") => ArrayBuffer;
  save: (name: string) => void;
};

export async function downloadRaidLogReportPdf(
  report: RaidLogReport,
): Promise<void> {
  const doc = await buildRaidLogReportPdf(report);
  doc.save(raidLogReportFileName(report, "pdf"));
}
