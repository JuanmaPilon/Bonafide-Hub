import {
  Client,
  EmbedBuilder,
  Guild,
  type MessageCreateOptions,
} from "discord.js";
import { env } from "../config/env.js";

// ── Control de asistencia de eventos ────────────────────────────────
// El API decide CUÁNDO toca avisar (evento con rol requerido que ya tiene un
// recordatorio "vencido" y no enviado, o evento completado sin informe). El
// bot consulta ese estado cada ~60s y hace la parte de Discord:
//   - Recordatorios: menciona en el canal del aviso a quienes tienen el rol
//     requerido y todavía no se anotaron (sin inscripción). Al terminar
//     avisa al API qué horas marcó como enviadas.
//   - Informe: al cerrar las inscripciones (o al completarse el evento si no
//     tiene cierre cargado), manda quiénes tenían el rol y no se anotaron al
//     canal configurado y/o por MD.

const REMOTE_BASE = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const REMOTE_TOKEN = env.BOT_CONFIG_API_TOKEN?.trim();
const POLL_INTERVAL_MS = 60 * 1000;

type RemoteSignup = {
  character?: string;
  role?: string;
  spec?: string;
  status: string;
  userId: string;
  username: string;
  wowClass?: string;
};

type RemoteEvent = {
  completedAt?: string;
  createdByUserId?: string;
  createdByUsername?: string;
  id: string;
  publishChannelId?: string;
  reminderHours?: number[];
  reminderSentHours?: number[];
  requiredRoleId?: string;
  signupDeadline?: string;
  signups?: RemoteSignup[];
  startsAt: string;
  status: string;
  title: string;
};

// A dónde va el informe de asistencia (lo configura el panel Admin: bloque
// "Informe de asistencia"): el canal donde se publica y/o las personas que lo
// reciben por MD. El MD al creador del evento se prende con un toggle.
type RemoteReportConfig = {
  channelId?: string;
  dmCreator?: boolean;
  userIds?: string[];
};

type RemoteControl = {
  report: RemoteReportConfig;
  reports: RemoteEvent[];
  reminders: Array<{ dueHours: number[]; event: RemoteEvent }>;
};

let controlTimer: NodeJS.Timeout | null = null;
let isRunningPass = false;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

async function fetchControl(guildId: string): Promise<RemoteControl> {
  if (!REMOTE_BASE || !REMOTE_TOKEN) {
    return { report: {}, reports: [], reminders: [] };
  }
  try {
    const controller = createTimeoutController(8000);
    const response = await fetch(
      `${REMOTE_BASE}/internal/guilds/${encodeURIComponent(guildId)}/events/control`,
      {
        headers: { "x-bot-token": REMOTE_TOKEN },
        method: "GET",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return { report: {}, reports: [], reminders: [] };
    }
    const payload = (await response.json()) as {
      report?: RemoteReportConfig;
      reports?: RemoteEvent[];
      reminders?: Array<{ dueHours: number[]; event: RemoteEvent }>;
    };
    return {
      report: payload.report ?? {},
      reports: payload.reports ?? [],
      reminders: payload.reminders ?? [],
    };
  } catch (error) {
    console.warn(
      `[event-control] No se pudo leer el control de eventos de ${guildId}: ${getErrorMessage(error)}`,
    );
    return { report: {}, reports: [], reminders: [] };
  }
}

async function postAction(
  guildId: string,
  eventId: string,
  action: "reminders-sent" | "report-sent",
  body?: { hours?: number[]; messageIds?: string[] },
): Promise<void> {
  if (!REMOTE_BASE || !REMOTE_TOKEN) {
    return;
  }
  try {
    const controller = createTimeoutController(6000);
    const response = await fetch(
      `${REMOTE_BASE}/internal/guilds/${encodeURIComponent(guildId)}/events/${encodeURIComponent(eventId)}/${action}`,
      {
        body: JSON.stringify(body ?? {}),
        headers: {
          "content-type": "application/json",
          "x-bot-token": REMOTE_TOKEN,
        },
        method: "POST",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      console.warn(
        `[event-control] POST ${action} falló (${response.status}) para evento ${eventId}.`,
      );
    }
  } catch (error) {
    console.warn(
      `[event-control] POST ${action} error para evento ${eventId}: ${getErrorMessage(error)}`,
    );
  }
}

// Miembros de la guild que tienen el rol indicado (con su displayName).
async function fetchMembersWithRole(
  guild: Guild,
  roleId: string,
): Promise<Array<{ displayName: string; id: string }>> {
  try {
    await guild.members.fetch();
  } catch (error) {
    console.warn(
      `[event-control] No se pudieron listar miembros de ${guild.id}: ${getErrorMessage(error)}`,
    );
    return [];
  }
  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return [];
  }
  return role.members.map((member) => ({
    displayName: member.displayName,
    id: member.id,
  }));
}

// Quienes tienen el rol requerido y NO tienen ninguna inscripción.
function computeMissingMembers(
  roleMembers: Array<{ displayName: string; id: string }>,
  signups: RemoteSignup[] | undefined,
): Array<{ displayName: string; id: string }> {
  const signedUserIds = new Set(signups?.map((signup) => signup.userId) ?? []);
  return roleMembers.filter((member) => !signedUserIds.has(member.id));
}

function formatEventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

// Devuelve el id del mensaje enviado (o null si no se pudo). Guardamos el id
// para poder borrar los recordatorios cuando el evento se completa/elimina.
async function sendToChannel(
  guild: Guild,
  channelId: string,
  payload: MessageCreateOptions | string,
): Promise<string | null> {
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !("send" in channel)) {
      return null;
    }
    const message = await channel.send(payload as MessageCreateOptions);
    return message.id ?? null;
  } catch (error) {
    console.warn(
      `[event-control] No se pudo enviar mensaje al canal ${channelId}: ${getErrorMessage(error)}`,
    );
    return null;
  }
}

async function sendDm(
  guild: Guild,
  userId: string | undefined,
  payload: MessageCreateOptions | string,
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  try {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return false;
    }
    await user.send(payload);
    return true;
  } catch (error) {
    console.warn(
      `[event-control] No se pudo mandar DM a <@${userId}>: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

// Envía el/los recordatorio(s) vencidos de un evento y marca las horas como
// enviadas en el API. Si no hay nadie que avisar igual se marca (nada que
// hacer).
async function processReminder(
  guild: Guild,
  item: { dueHours: number[]; event: RemoteEvent },
): Promise<void> {
  const { event } = item;
  const roleId = event.requiredRoleId;
  const channelId = event.publishChannelId;
  if (!roleId || !channelId) {
    return;
  }
  try {
    const roleMembers = await fetchMembersWithRole(guild, roleId);
    const missing = computeMissingMembers(roleMembers, event.signups);
    const reminderMessageIds: string[] = [];

    if (missing.length > 0) {
      const startsMs = new Date(event.startsAt).getTime();
      const mentions = missing.map((member) => `<@${member.id}>`).join(" ");
      // Las menciones van en el CONTENIDO: dentro de un embed no notifican.
      const embed = new EmbedBuilder()
        .setColor(0xffb454)
        .setTitle(`⏰ ${event.title}`.slice(0, 256))
        .setDescription(
          [
            `🗓️ ${formatEventDate(event.startsAt)} · <t:${Math.floor(startsMs / 1000)}:R>`,
            "",
            "**Faltan anotarse:**",
          ].join("\n"),
        )
        .setFooter({ text: "Bonafide Hub · Recordatorio de asistencia" });
      const sentId = await sendToChannel(guild, channelId, {
        allowedMentions: { parse: ["users"] },
        content: mentions.slice(0, 1900),
        embeds: [embed],
      });
      if (!sentId) {
        // Canal inválido: no lo marcamos para no perder el aviso, se reintenta.
        return;
      }
      reminderMessageIds.push(sentId);
    }

    await postAction(guild.id, event.id, "reminders-sent", {
      hours: item.dueHours,
      messageIds: reminderMessageIds,
    });
    console.log(
      `[event-control] Recordatorio enviado (${item.dueHours.join("/")}h) para "${event.title}" — ${missing.length} sin anotar`,
    );
  } catch (error) {
    console.warn(
      `[event-control] Falló el recordatorio de "${event.title}": ${getErrorMessage(error)}`,
    );
  }
}

// Informe al cerrar las inscripciones: quiénes tenían el rol y no se anotaron.
// Destinos (config del panel): el canal elegido, SIN menciones (es un registro,
// no un aviso), y el MD a cada persona de la lista. El MD al creador del evento
// se prende/apaga con un toggle. Si nada llegó, el respaldo sigue siendo el
// canal del aviso.
async function processReport(
  guild: Guild,
  event: RemoteEvent,
  reportConfig: RemoteReportConfig,
): Promise<void> {
  const roleId = event.requiredRoleId;
  if (!roleId) {
    return;
  }
  try {
    const roleMembers = await fetchMembersWithRole(guild, roleId);
    const missing = computeMissingMembers(roleMembers, event.signups);
    const signups = event.signups ?? [];
    const confirmed = signups.filter((s) => s.status === "yes").length;
    const bench = signups.filter((s) => s.status === "bench").length;
    const late = signups.filter((s) => s.status === "late").length;
    const countNo = signups.filter((s) => s.status === "no").length;

    const embed = new EmbedBuilder()
      .setColor(0x6aa8ff)
      .setTitle(`📋 Informe de asistencia — ${event.title}`.slice(0, 256))
      .setDescription(`🗓️ ${formatEventDate(event.startsAt)}`)
      .addFields(
        {
          name: "📊 Anotados",
          value: `✅ ${confirmed} · 🪑 ${bench} · ⏰ ${late} · ❌ ${countNo}`,
        },
        {
          name: `🛡️ No se anotaron (${missing.length} con el rol)`,
          value:
            missing.length > 0
              ? missing
                  .map((m) => `• ${m.displayName}`)
                  .join("\n")
                  .slice(0, 1024)
              : "Nadie: todos con el rol respondieron. 🎉",
        },
      )
      .setFooter({ text: "Bonafide Hub · Informe de asistencia" });

    // Canal elegido en el panel: el informe va pelado, sin menciones (a las
    // personas no se las etiqueta: se les manda el mismo informe por MD).
    let channelDelivered = false;
    if (reportConfig.channelId) {
      channelDelivered =
        (await sendToChannel(guild, reportConfig.channelId, {
          embeds: [embed],
        })) !== null;
      if (!channelDelivered) {
        console.warn(
          `[event-control] Informe de "${event.title}": no se pudo publicar en el canal configurado (${reportConfig.channelId}).`,
        );
      }
    }

    // MD a cada persona de la lista.
    let peopleDelivered = 0;
    for (const userId of reportConfig.userIds ?? []) {
      if (await sendDm(guild, userId, { embeds: [embed] })) {
        peopleDelivered += 1;
      }
    }

    // MD al creador: activado por defecto (es lo que hacía siempre).
    const canDm =
      reportConfig.dmCreator !== false && Boolean(event.createdByUserId);
    const delivered = canDm
      ? await sendDm(guild, event.createdByUserId, { embeds: [embed] })
      : false;

    // Respaldo: el canal del aviso, solo si el informe no llegó a ningún lado.
    let fallbackDelivered = false;
    if (
      !channelDelivered &&
      !delivered &&
      peopleDelivered === 0 &&
      event.publishChannelId
    ) {
      fallbackDelivered =
        (await sendToChannel(guild, event.publishChannelId, {
          embeds: [embed],
        })) !== null;
    }

    if (channelDelivered || delivered || peopleDelivered > 0 || fallbackDelivered) {
      await postAction(guild.id, event.id, "report-sent");
      console.log(
        `[event-control] Informe enviado de "${event.title}" — ${missing.length} sin anotar (canal=${channelDelivered ? "sí" : "no"}, dm=${delivered ? "sí" : "no"}, personas=${peopleDelivered})`,
      );
      return;
    }

    if (
      !reportConfig.channelId &&
      !canDm &&
      (reportConfig.userIds ?? []).length === 0 &&
      !event.publishChannelId
    ) {
      // Sin ningún destino posible: se descarta para no reintentar en cada
      // tick.
      await postAction(guild.id, event.id, "report-sent");
      console.warn(
        `[event-control] Informe de "${event.title}" sin destinatario configurado, se descarta.`,
      );
      return;
    }

    console.warn(
      `[event-control] Informe de "${event.title}" no entregado: se reintentará.`,
    );
  } catch (error) {
    console.warn(
      `[event-control] Falló el informe de "${event.title}": ${getErrorMessage(error)}`,
    );
  }
}

async function runControlPass(client: Client): Promise<void> {
  if (isRunningPass) {
    return;
  }
  if (!REMOTE_BASE || !REMOTE_TOKEN) {
    return;
  }
  isRunningPass = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      const control = await fetchControl(guild.id);
      for (const item of control.reminders) {
        await processReminder(guild, item);
      }
      for (const event of control.reports) {
        await processReport(guild, event, control.report);
      }
    }
  } finally {
    isRunningPass = false;
  }
}

export function startEventControlScheduler(client: Client): void {
  if (controlTimer) {
    return;
  }
  controlTimer = setInterval(() => {
    void runControlPass(client);
  }, POLL_INTERVAL_MS);
  void runControlPass(client);
}
