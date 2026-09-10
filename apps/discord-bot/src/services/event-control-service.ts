import { Client, Guild } from "discord.js";
import { env } from "../config/env.js";

// ── Control de asistencia de eventos ────────────────────────────────
// El API decide CUÁNDO toca avisar (evento con rol requerido que ya tiene un
// recordatorio "vencido" y no enviado, o evento completado sin informe). El
// bot consulta ese estado cada ~60s y hace la parte de Discord:
//   - Recordatorios: menciona en el canal del aviso a quienes tienen el rol
//     requerido y todavía no se anotaron (sin inscripción). Al terminar
//     avisa al API qué horas marcó como enviadas.
//   - Informe: al completarse el evento, manda por DM al creador quiénes
//     tenían el rol y no se anotaron (con fallback al canal del aviso).

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

type RemoteControl = {
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
    return { reports: [], reminders: [] };
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
      return { reports: [], reminders: [] };
    }
    const payload = (await response.json()) as {
      reports?: RemoteEvent[];
      reminders?: Array<{ dueHours: number[]; event: RemoteEvent }>;
    };
    return {
      reports: payload.reports ?? [],
      reminders: payload.reminders ?? [],
    };
  } catch (error) {
    console.warn(
      `[event-control] No se pudo leer el control de eventos de ${guildId}: ${getErrorMessage(error)}`,
    );
    return { reports: [], reminders: [] };
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
  const formatter = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  });
  return formatter.format(date);
}

// "faltan 23 h", "falta 1 h", "faltan 45 min".
function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) {
    return minutes <= 1 ? "menos de 1 min" : `faltan ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 48) {
    const parts = [`faltan ${hours} h`];
    if (restMinutes >= 5) {
      parts.push(`${restMinutes} min`);
    }
    return parts.join(" ");
  }
  const days = Math.floor(hours / 24);
  return `faltan ${days} día${days === 1 ? "" : "s"}`;
}

// Devuelve el id del mensaje enviado (o null si no se pudo). Guardamos el id
// para poder borrar los recordatorios cuando el evento se completa/elimina.
async function sendToChannel(
  guild: Guild,
  channelId: string,
  content: string,
): Promise<string | null> {
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !("send" in channel)) {
      return null;
    }
    const message = await channel.send(content);
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
  content: string,
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  try {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return false;
    }
    await user.send(content);
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
      const content = [
        `⏰ **${event.title}** — ${formatRemaining(startsMs - Date.now())}`,
        `🗓️ ${formatEventDate(event.startsAt)}`,
        "**Estas personas faltan anotarse:**",
        missing.map((member) => `<@${member.id}>`).join(" "),
      ].join("\n");
      const sentId = await sendToChannel(guild, channelId, content);
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

// Informe al completar: DM al creador con quienes tenían el rol y no se
// anotaron. Si el DM no llega (DMs cerrados), cae al canal del aviso.
async function processReport(guild: Guild, event: RemoteEvent): Promise<void> {
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

    const lines = [
      `📋 **Informe de asistencia — ${event.title}**`,
      `🗓️ ${formatEventDate(event.startsAt)}`,
      "",
      `Anotados: ✅ ${confirmed} · 🪑 ${bench} · ⏰ ${late} · ❌ ${countNo}`,
      `No se anotaron (${missing.length} con el rol):`,
      missing.length > 0
        ? missing.map((m) => `• ${m.displayName}`).join("\n")
        : "• Nadie: todos con el rol respondieron. 🎉",
    ].join("\n");

    const delivered = await sendDm(guild, event.createdByUserId, lines);
    let channelDelivered = false;
    if (!delivered && event.publishChannelId) {
      channelDelivered =
        (await sendToChannel(guild, event.publishChannelId, lines)) !== null;
    }

    if (delivered || channelDelivered) {
      await postAction(guild.id, event.id, "report-sent");
      console.log(
        `[event-control] Informe enviado de "${event.title}" — ${missing.length} sin anotar (dm=${delivered ? "sí" : "no"})`,
      );
    } else if (!event.createdByUserId && !event.publishChannelId) {
      // Sin destinatario posible (ni creador ni canal): lo marcamos para no
      // reintentar en cada tick.
      await postAction(guild.id, event.id, "report-sent");
      console.warn(
        `[event-control] Informe de "${event.title}" sin destinatario (sin creador ni canal), se descarta.`,
      );
    } else {
      console.warn(
        `[event-control] Informe de "${event.title}" no entregado (DM bloqueado y sin canal de respaldo): se reintentará.`,
      );
    }
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
        await processReport(guild, event);
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
