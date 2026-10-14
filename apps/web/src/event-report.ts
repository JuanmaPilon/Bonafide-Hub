// Informe de un evento, en un solo lugar.
//
// La ventana del informe (Admin → Eventos) y las dos descargas (CSV y PDF) se
// arman de acá: si la web muestra un dato, la descarga lo tiene. Antes el CSV lo
// generaba el API y el PDF el navegador, cada uno con su propia idea de qué era
// "el informe", así que los dos salían incompletos y distintos de la web.
//
// Es lógica pura (sin React): la ventana lo usa para pintar y las descargas para
// escribir el archivo.

import {
  EVENT_TYPES,
  eventRoleMeta,
  type EventRoleOption,
  type EventRoster,
  type EventSignup,
  type GuildRoster,
  type HubEvent,
  type RaidLogAttendance,
  type RaidLogAttendanceRow,
  type RaidSpec,
} from "./api";
import { formatDateTime24, formatTime24 } from "./datetime";
import { hoursFromMinutes } from "./duration";

// Estado de los que no respondieron: lo manda el API con ese valor porque no es
// un estado de inscripción (los demás son yes/late/bench/tentative/no).
export const UNDECLARED_STATUS = "none";

// Los que no declararon nada, de mayor a menor compromiso.
const DECLARED_GROUPS = [
  { emoji: "✅", label: "Se anotaron para asistir", status: "yes" },
  { emoji: "🪑", label: "Bench", status: "bench" },
  { emoji: "⏰", label: "Avisaron que llegan tarde", status: "late" },
  { emoji: "❌", label: "Avisaron que no van", status: "no" },
] as const;

const UNDECLARED_GROUP = {
  emoji: "❓",
  label: "Sin responder",
  status: UNDECLARED_STATUS,
} as const;

// Estado de una inscripción en palabras (es lo que va al CSV y al PDF).
const STATUS_LABELS: Record<string, string> = {
  bench: "Bench",
  late: "Llega tarde",
  no: "No asiste",
  [UNDECLARED_STATUS]: "Sin responder",
  yes: "Asiste",
};

// Solo "voy" y "tarde" son un compromiso de asistir: son los que se cuentan como
// "anotados que vinieron".
const EXPECTED_STATUSES = new Set(["yes", "late"]);

// Cómo se ve la presencia de una fila. `kind` elige el color en la web; `text` es
// lo que se lee (y lo que va al archivo).
export type EventReportPresence = {
  kind: "absent" | "likely" | "present" | "unknown";
  pulls: number;
  text: string;
};

// Qué se le puede corregir a una fila: el aviso que se muestra, la clase/spec
// que manda (la ficha), lo que decía la inscripción y el rol.
export type EventReportRow = {
  bench: boolean;
  // Clase y spec con las que se anotó (si las escribió): es lo que precarga el
  // panel de la ficha al corregirla desde el informe.
  declaredClass: string;
  declaredRole: string;
  declaredSpec: string;
  // false = es del roster esperado y no se anotó.
  declared: boolean;
  character: string;
  flags: string[];
  fromSignup: string | null;
  presence: EventReportPresence | null;
  primary: { className: string; role?: string; specName: string } | null;
  // Rol que se muestra y si viene de la ficha ("según su ficha: …") en vez de la
  // inscripción.
  roleLabel: string | null;
  roleLabelFromSheet: boolean;
  status: string;
  statusLabel: string;
  userId: string;
  username: string;
};

export type EventReportGroup = {
  emoji: string;
  label: string;
  playedInLog: number;
  rows: EventReportRow[];
  status: string;
};

export type EventReportChip = {
  // Clase del chip en la web: reusa las de los chips de asistencia.
  kind: string;
  text: string;
};

export type EventReportModel = {
  // Chips de la asistencia declarada (👥 anotados, ✅, 🪑, ⏰, ❌).
  declaredChips: EventReportChip[];
  declaredNote: string;
  groups: EventReportGroup[];
  // Chips del cruce con el log (vacío si esa noche no tiene log).
  logChips: EventReportChip[];
  logNotFound: boolean;
  partial: boolean;
  summary: Array<{ label: string; value: string }>;
  type: { emoji: string; label: string };
};

// ---------------------------------------------------------------------------
// Cruce de una fila con la ficha del roster y con el log de esa noche.

function buildRow(
  input: {
    game: string;
    memberByUser: Map<string, GuildRoster["members"][number]>;
    presenceByUser: Map<string, RaidLogAttendanceRow>;
    roles: EventRoleOption[];
    specByKey: Map<string, RaidSpec>;
  },
  source: {
    bench?: boolean;
    character?: string;
    declared: boolean;
    role?: string;
    rosterClass?: { className: string; specName: string };
    spec?: string;
    status: string;
    userId: string;
    username: string;
    wowClass?: string;
  },
): EventReportRow {
  const { game, memberByUser, presenceByUser, roles, specByKey } = input;
  const profile = memberByUser.get(source.userId)?.profile ?? null;
  // La ficha es por juego: comparar la de otro juego sería comparar peras con
  // manzanas (una misma persona puede tener ficha de WoW y de LoL).
  const sameGame = (profile?.game ?? "wow") === game;
  const rosterClass = sameGame ? (profile?.className ?? "") : "";
  const rosterSpec = sameGame ? (profile?.specName ?? "") : "";
  const rosterMeta =
    rosterClass && rosterSpec
      ? specByKey.get(`${game}|${rosterClass}|${rosterSpec}`)
      : undefined;
  const signupClass = source.wowClass?.trim() ?? "";
  const signupSpec = source.spec?.trim() ?? "";
  const apiClassName = source.rosterClass?.className?.trim() ?? "";
  const apiSpecName = source.rosterClass?.specName?.trim() ?? "";

  let primary: EventReportRow["primary"] = null;
  if (rosterClass && rosterSpec) {
    primary = {
      className: rosterClass,
      role: rosterMeta?.role,
      specName: rosterSpec,
    };
  } else if (apiClassName && apiSpecName) {
    // El API ya lo resolvió desde la ficha para quien no eligió nada.
    primary = { className: apiClassName, specName: apiSpecName };
  } else if (signupClass && signupSpec) {
    primary = { className: signupClass, specName: signupSpec };
  } else if (signupClass || signupSpec) {
    primary = { className: signupClass || "?", specName: signupSpec || "?" };
  }

  const flags: string[] = [];
  // La ficha puede faltar por completo o existir vacía (quien se sumó al roster
  // y nunca la completó): en los dos casos falta el dato contra el que se cruza.
  // Una ficha de OTRO juego no entra acá: no es que falte, es de otro juego.
  const fichaMissing =
    !profile || (sameGame && !(profile.className && profile.specName));
  if (fichaMissing) {
    flags.push(
      memberByUser.has(source.userId)
        ? "ficha sin clase ni spec"
        : "sin ficha en el roster",
    );
  }
  // Una sola marca para la ficha: con dos ("clase distinta" + "spec distinta")
  // la misma diferencia se leía dos veces.
  if (
    (signupClass && rosterClass && signupClass !== rosterClass) ||
    (signupSpec && rosterSpec && signupSpec !== rosterSpec)
  ) {
    flags.push(`ficha: ${rosterSpec} ${rosterClass}`);
  }
  if (primary?.role && source.role && primary.role !== source.role) {
    flags.push(
      `rol distinto a su ficha (${
        eventRoleMeta(primary.role, roles)?.label ?? primary.role
      })`,
    );
  }

  // Lo que escribió en la inscripción, cuando no es lo mismo que la ficha.
  const fromSignup =
    signupClass && signupSpec && rosterClass
      ? signupClass === rosterClass && signupSpec === rosterSpec
        ? null
        : `${signupSpec} ${signupClass}`
      : null;

  const roleMeta = source.role ? eventRoleMeta(source.role, roles) : undefined;
  const fromSheet = !source.role && Boolean(primary?.role);
  const roleLabel = source.role
    ? (roleMeta?.label ?? source.role)
    : fromSheet
      ? `según su ficha: ${
          eventRoleMeta(primary?.role, roles)?.label ?? primary?.role
        }`
      : null;

  const presenceRow = presenceByUser.get(source.userId) ?? null;
  let presence: EventReportPresence | null = null;
  if (presenceRow) {
    const pulls = presenceRow.pulls;
    if (presenceRow.present) {
      presence = {
        kind: "present",
        pulls,
        text: `Jugó (${pulls} pull${pulls === 1 ? "" : "s"})`,
      };
    } else if (presenceRow.likely) {
      presence = {
        kind: "likely",
        pulls: presenceRow.likely.pulls,
        text: `¿${presenceRow.likely.logName}? (${Math.round(
          presenceRow.likely.similarity * 100,
        )}%)`,
      };
    } else if (!presenceRow.matchable) {
      presence = {
        kind: "unknown",
        pulls: 0,
        text: "Sin personaje para comparar",
      };
    } else {
      presence = { kind: "absent", pulls: 0, text: "No jugó" };
    }
  }

  return {
    bench: Boolean(source.bench),
    character: source.character ?? "",
    declared: source.declared,
    declaredClass: signupClass,
    declaredRole: source.role ?? "",
    declaredSpec: signupSpec,
    flags,
    fromSignup,
    presence,
    primary,
    roleLabel,
    roleLabelFromSheet: fromSheet,
    status: source.status,
    statusLabel: STATUS_LABELS[source.status] ?? source.status,
    userId: source.userId,
    username: source.username,
  };
}

export function buildEventReport(input: {
  attendance: RaidLogAttendance | null;
  event: HubEvent;
  game: string;
  gameLabel: string;
  roster: GuildRoster | null;
  rosterExpected: EventRoster | null;
  roles: EventRoleOption[];
  specs: RaidSpec[];
}): EventReportModel {
  const { attendance, event, game, gameLabel, roles, roster, rosterExpected, specs } =
    input;
  const type =
    EVENT_TYPES.find((entry) => entry.key === event.type) ?? EVENT_TYPES[0];

  const catalogSpecs = roster?.specs?.length ? roster.specs : specs;
  const catalogRoles = roster?.roles?.length ? roster.roles : roles;
  const specByKey = new Map(
    catalogSpecs.map((spec) => [
      `${spec.game}|${spec.className}|${spec.specName}`,
      spec,
    ]),
  );
  const memberByUser = new Map(
    (roster?.members ?? []).map((member) => [member.userId, member]),
  );
  const presenceByUser = new Map(
    (attendance?.byUser ?? []).map((row) => [row.userId, row]),
  );

  const rowInput = {
    game,
    memberByUser,
    presenceByUser,
    roles: catalogRoles,
    specByKey,
  };

  const signups = event.signups ?? [];
  const declaredRows = signups.map((signup: EventSignup) =>
    buildRow(rowInput, { ...signup, declared: true }),
  );
  // Los del roster esperado que no respondieron: no tienen inscripción, así que
  // la fila se arma con su ficha y con lo que el API pudo cruzar por su
  // personaje.
  const undeclaredRows = (rosterExpected?.missing ?? []).map((member) =>
    buildRow(rowInput, {
      bench: member.bench,
      declared: false,
      status: UNDECLARED_STATUS,
      userId: member.userId,
      username: member.username,
    }),
  );

  const playedIn = (rows: EventReportRow[]): number =>
    rows.filter((row) => row.presence?.kind === "present").length;

  const groups: EventReportGroup[] = DECLARED_GROUPS.map(
    ({ emoji, label, status }) => {
      const groupRows = declaredRows.filter((row) => row.status === status);
      return {
        emoji,
        label,
        playedInLog: playedIn(groupRows),
        rows: groupRows,
        status,
      };
    },
  ).filter((group) => group.rows.length > 0);

  if (undeclaredRows.length > 0) {
    groups.push({
      emoji: UNDECLARED_GROUP.emoji,
      label: UNDECLARED_GROUP.label,
      playedInLog: playedIn(undeclaredRows),
      rows: undeclaredRows,
      status: UNDECLARED_GROUP.status,
    });
  }

  // Convocatoria del roster (los que tenían que responder y no lo hicieron).
  const expectedCount = rosterExpected?.expectedCount;
  const convocatoria = rosterExpected
    ? `${rosterExpected.confirmedCount} de ${expectedCount} del roster${
        (rosterExpected.missing ?? []).length > 0
          ? ` · ${rosterExpected.missing.length} sin responder`
          : ""
      }`
    : "—";

  const endAt = event.durationMinutes
    ? new Date(
        new Date(event.startsAt).getTime() + event.durationMinutes * 60_000,
      )
    : null;

  // Resumen del cruce con el log: se cuenta por persona y por estado, así el
  // número que se lee es el que después se puede verificar fila por fila.
  const declaredCounts = (status: string): number =>
    declaredRows.filter((row) => row.status === status).length;
  const expectedRows = declaredRows.filter((row) =>
    EXPECTED_STATUSES.has(row.status),
  );
  const logChips: EventReportChip[] = [];
  if (attendance) {
    const came = expectedRows.filter(
      (row) => row.presence?.kind === "present",
    ).length;
    const missed = expectedRows.filter(
      (row) => row.presence?.kind === "absent",
    ).length;
    const benchPlayed = declaredRows.filter(
      (row) => row.status === "bench" && row.presence?.kind === "present",
    ).length;
    const saidNoAndPlayed = declaredRows.filter(
      (row) => row.status === "no" && row.presence?.kind === "present",
    ).length;
    const toConfirm = declaredRows.filter(
      (row) => row.presence?.kind === "likely",
    ).length;
    const unsigned = (attendance.unsignedPresent ?? []).filter(
      (row) => !row.status,
    ).length;

    logChips.push({
      kind: "yes",
      text: `✔ ${came} de ${expectedRows.length} vinieron`,
    });
    if (missed > 0) {
      logChips.push({ kind: "no", text: `✘ ${missed} no vinieron` });
    }
    if (benchPlayed > 0) {
      logChips.push({
        kind: "bench",
        text: `🪑 ${benchPlayed} de bench jugaron`,
      });
    }
    if (saidNoAndPlayed > 0) {
      logChips.push({
        kind: "warn",
        text: `⚠️ ${saidNoAndPlayed} dijeron que no y jugaron`,
      });
    }
    if (toConfirm > 0) {
      logChips.push({
        kind: "tentative",
        text: `❔ ${toConfirm} a confirmar`,
      });
    }
    if (unsigned > 0) {
      logChips.push({
        kind: "",
        text: `➕ ${unsigned} jugaron sin anotarse`,
      });
    }
  }

  const yes = declaredCounts("yes");
  const declaredChips: EventReportChip[] = [
    { kind: "total", text: `👥 ${signups.length} anotados` },
    { kind: "yes", text: `✅ ${yes}` },
    { kind: "bench", text: `🪑 ${declaredCounts("bench")}` },
    { kind: "late", text: `⏰ ${declaredCounts("late")}` },
    { kind: "no", text: `❌ ${declaredCounts("no")}` },
  ];

  return {
    declaredChips,
    declaredNote: `${yes} de ${signups.length} se anotaron como “asisto”`,
    groups,
    logChips,
    logNotFound: !attendance,
    partial: Boolean(attendance?.partial),
    summary: [
      { label: "Fecha", value: formatDateTime24(event.startsAt) },
      {
        label: "Horario",
        value: `${formatTime24(event.startsAt)}${
          endAt ? ` → ${formatTime24(endAt)}` : ""
        }${
          event.durationMinutes
            ? ` (${hoursFromMinutes(event.durationMinutes)} hs)`
            : ""
        }`,
      },
      { label: "Juego", value: `${gameLabel} · ${type.label}` },
      { label: "Convocatoria", value: convocatoria },
    ],
    type: { emoji: type.emoji, label: type.label },
  };
}

// ---------------------------------------------------------------------------
// Descargas: el CSV y el PDF se escriben del mismo modelo que pinta la ventana.

// Separador `;` y BOM: es lo que hace que Excel lo abra en columnas y en UTF-8
// (acentos y emojis incluidos).
function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_COLUMNS = [
  "Anotado",
  "Personaje",
  "Estado",
  "Clase y spec",
  "Inscripción",
  "Rol",
  "En el log",
  "A revisar",
];

function rowCells(row: EventReportRow, attendanceAsked: boolean): string[] {
  const declaredClass = row.declaredClass
      ? `${row.declaredSpec} ${row.declaredClass}`
      : "";
  return [
      // El bench se marca en el nombre, como en el resto de la app (no se anotó,
      // pero tiene que estar listo por si hace falta).
      `${row.username}${!row.declared && row.bench ? " (bench)" : ""}`,
      row.character,
      row.statusLabel,
      row.primary
        ? `${row.primary.specName} ${row.primary.className}`
        : "Sin clase ni spec",
      row.fromSignup ? declaredClass : "",
      row.roleLabel ?? "",
      row.presence?.text ?? (attendanceAsked ? "Sin datos" : ""),
      row.flags.join(" · "),
  ];
}

export function eventReportCsv(model: EventReportModel, title: string): string {
  const rows: string[][] = [["Informe de asistencia", title]];
  for (const item of model.summary) {
      rows.push([item.label, item.value]);
  }
  rows.push([]);
  rows.push(["Asistencia declarada", model.declaredChips.map((chip) => chip.text).join("  ")]);
  rows.push(["", model.declaredNote]);
  rows.push([
      "En el log",
      model.logNotFound
        ? "No hay un log de raid guardado de esa noche."
        : model.logChips.map((chip) => chip.text).join("  "),
  ]);

  for (const group of model.groups) {
      rows.push([]);
      rows.push([
        `${group.label} (${group.rows.length})`,
        model.logNotFound ? "" : `${group.playedInLog} en el log`,
      ]);
      rows.push(CSV_COLUMNS);
      for (const row of group.rows) {
        rows.push(rowCells(row, !model.logNotFound));
      }
  }

  return `\uFEFF${rows
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n")}\r\n`;
}

export function eventReportFileName(title: string, extension: string): string {  const slug = title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  return `informe-${slug || "evento"}.${extension}`;
}

// Nombre del juego como se muestra en la app (`WoW`), con el código en
// mayúsculas de respaldo. Vive acá para que la ventana del informe y el archivo
// que se descarga no puedan escribir dos cosas distintas en la misma fila.
export function eventGameLabel(
  games: Array<{ key: string; label: string }>,
  game: string | undefined,
): string {
  return (
    games.find((entry) => entry.key === game)?.label ??
    (game ?? "").toUpperCase()
  );
}

// La fuente estándar de un PDF (Helvetica) no tiene glifos de emoji: en el
// archivo saldrían como cuadraditos, así que se limpian antes de escribirlo.
export function pdfPlainText(value: string): string {
  return value
      .replace(
        /[\u{1F000}-\u{1FAFF}\u{2100}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
}

// Colores del informe (los mismos de la app, en notación de jsPDF).
const PDF_INK = [31, 41, 55] as const;
const PDF_MUTED = [110, 122, 145] as const;
const PDF_LINE = [214, 222, 235] as const;
const PDF_HEAD = [15, 22, 41] as const;

// Arma el PDF del informe. Se devuelve como Blob (y no con `doc.save()`) porque
// jsPDF dispara la descarga desde un <a> que nunca agrega al documento: en
// Firefox eso no baja nada, sin error ni aviso. Con el Blob la descarga la hace
// `downloadBlob`, el mismo camino que usa el CSV.
export async function eventReportPdf(
  model: EventReportModel,
  title: string,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const rowHeight = 6.4;
  const bottomLimit = pageHeight - 16;
  let y = 0;

  const columns = [
      { label: "Anotado", width: 46 },
      { label: "Clase y spec", width: 46 },
      { label: "Rol", width: 28 },
      { label: "En el log", width: 30 },
      { label: "A revisar", width: 32 },
  ];
  const fixedWidth = columns.reduce((sum, column) => sum + column.width, 0);
  columns[columns.length - 1].width += contentWidth - fixedWidth;

  // Recorta el texto al ancho de la celda (con puntos suspensivos) para que no
  // se monte sobre la columna de al lado.
  const fit = (value: string, width: number): string => {
      if (doc.getTextWidth(value) <= width) {
        return value;
      }
      let trimmed = value;
      while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > width) {
        trimmed = trimmed.slice(0, -1);
      }
      return `${trimmed}…`;
  };

  const drawTitle = (): void => {
      doc.setFillColor(PDF_HEAD[0], PDF_HEAD[1], PDF_HEAD[2]);
      doc.rect(0, 0, pageWidth, 24, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Informe de asistencia", marginX, 11);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.text(fit(pdfPlainText(title), contentWidth), marginX, 18);
      y = 32;
  };

  const drawTableHead = (): void => {
      doc.setFillColor(226, 232, 240);
      doc.rect(marginX, y - 4.6, contentWidth, rowHeight, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
      let x = marginX;
      for (const column of columns) {
        doc.text(fit(column.label, column.width - 4), x + 2, y);
        x += column.width;
      }
      doc.setFont("helvetica", "normal");
      y += rowHeight;
  };

  const newPage = (): void => {
      doc.addPage();
      drawTitle();
  };

  // Asegura que queden `needed` mm libres: si no, salta de hoja.
  const ensure = (needed: number): void => {
      if (y + needed > bottomLimit) {
        newPage();
      }
  };

  drawTitle();

  // Resumen de la noche, en dos columnas para que no quede una lista larga.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const summaryColumnWidth = contentWidth / 2;
  model.summary.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = marginX + column * summaryColumnWidth;
      const baseline = y + row * 9;
      doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text(pdfPlainText(item.label).toUpperCase(), x, baseline);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
      doc.text(fit(pdfPlainText(item.value), summaryColumnWidth - 6), x, baseline + 4);
  });
  y += Math.ceil(model.summary.length / 2) * 9 + 3;

  // Asistencia declarada y cruce con el log, una línea cada uno.
  const drawLine = (label: string, value: string): void => {
      const wrapped = doc.splitTextToSize(
        pdfPlainText(value),
        contentWidth - 30,
      ) as string[];
      ensure(wrapped.length * 4.6 + 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
      doc.text(pdfPlainText(label).toUpperCase(), marginX, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
      let lineY = y;
      for (const line of wrapped) {
        doc.text(line, marginX + 30, lineY);
        lineY += 4.6;
      }
      y = Math.max(y, lineY) + 2;
  };

  drawLine(
      "Asistencia",
      `${model.declaredChips.map((chip) => chip.text).join("  ")} · ${model.declaredNote}`,
  );
  drawLine(
      "En el log",
      model.logNotFound
        ? "No hay un log de raid guardado de esa noche, así que no se puede cruzar quién vino."
        : `${model.logChips.map((chip) => chip.text).join("  ")}${
            model.partial
              ? " · Sin presencia por pull: puede faltar algún healer sin daño."
              : ""
          }`,
  );
  y += 4;

  if (model.groups.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
      doc.text("Sin inscripciones.", marginX, y);
  }

  for (const group of model.groups) {
      ensure(rowHeight * 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
      doc.text(
        pdfPlainText(
          `${group.label} (${group.rows.length})${
            model.logNotFound ? "" : ` · ${group.playedInLog} en el log`
          }`,
        ),
        marginX,
        y,
      );
      y += 5;
      drawTableHead();

      doc.setFontSize(8.5);
      doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
      group.rows.forEach((row, index) => {
        const cells = rowCells(row, !model.logNotFound);
        // La celda de "Clase y spec" lleva la línea de la inscripción: la fila
        // ocupa dos renglones cuando hay diferencia con la ficha.
        const specText = pdfPlainText(cells[3]);
        const diffText = cells[4] ? `inscripción: ${pdfPlainText(cells[4])}` : "";
        const height = diffText ? rowHeight + 4.2 : rowHeight;
        if (y + height > bottomLimit) {
          newPage();
          drawTableHead();
          doc.setFontSize(8.5);
          doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
        }
        if (index % 2 === 1) {
          doc.setFillColor(243, 245, 249);
          doc.rect(marginX, y - 4.6, contentWidth, height, "F");
        }
        let x = marginX;
        doc.text(fit(pdfPlainText(cells[0]), columns[0].width - 4), x + 2, y);
        x += columns[0].width;
        doc.text(fit(specText, columns[1].width - 4), x + 2, y);
        if (diffText) {
          doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
          doc.setFontSize(7.5);
          doc.text(
            fit(diffText, columns[1].width - 4),
            x + 2,
            y + 4,
          );
          doc.setFontSize(8.5);
          doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
        }
        x += columns[1].width;
        doc.text(fit(pdfPlainText(cells[5]), columns[2].width - 4), x + 2, y);
        x += columns[2].width;
        doc.text(fit(pdfPlainText(cells[6]), columns[3].width - 4), x + 2, y);
        x += columns[3].width;
        const flags = cells[7] ? pdfPlainText(cells[7]) : "OK";
        if (!cells[7]) {
          doc.setTextColor(34, 125, 60);
        }
        doc.text(fit(flags, columns[4].width - 4), x + 2, y);
        doc.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
        y += height;
      });
      y += 4;
  }

  // Recuadro del pie con la marca y el paginado (se recorre al final porque
  // recién ahí se sabe cuántas hojas tiene el informe).
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
      doc.setLineWidth(0.2);
      doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
      doc.text("Bonafide", marginX, pageHeight - 8);
      doc.text(
        `Página ${page} de ${pageCount}`,
        pageWidth - marginX,
        pageHeight - 8,
        { align: "right" },
      );
  }

  return doc.output("blob");
}
