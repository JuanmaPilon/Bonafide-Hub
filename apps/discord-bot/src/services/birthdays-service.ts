import { Client, Events, Guild, GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { getGuildConfig } from "./guild-config-store.js";

// Cumpleaños: el día que toca, el bot le da a la persona un rol temporal y
// (si hay canal configurado) la saluda. El evento que marca la fecha lo crea y
// repite el API (plantilla "cumple", cada 12 meses), así que acá no hay
// calendario propio: se lee la misma lista de eventos y se mira quién cumple
// hoy.

const remoteApiBaseUrl = env.BOT_CONFIG_API_URL?.trim().replace(/\/+$/, "");
const remoteApiToken = env.BOT_CONFIG_API_TOKEN?.trim();
const remoteTimeoutMs = 5000;
// Una vez por hora alcanza: lo que importa es no saltearse el cambio de día.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// Zona horaria de la celebración. El servidor corre en UTC, así que sin esto
// alguien que cumple el 5 recibiría el rol a las 21:00 del 4.
const BIRTHDAY_TIMEZONE = env.BIRTHDAY_TIMEZONE?.trim() || "America/Argentina/Buenos_Aires";

const BIRTHDAY_ROLE_NAME = "🎂 Cumpleaños";
const BIRTHDAY_ROLE_COLOR = 0xff73fa;

type BirthdayEvent = {
  birthdayUserId?: string;
  id: string;
  startsAt: string;
  title: string;
  type: string;
};

// Última fecha (YYYY-MM-DD) en la que corrió el anuncio, por guild: evita
// repetir el saludo en cada tick del mismo día.
const announced = new Map<string, string>();

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

// Día de hoy en la zona configurada, como YYYY-MM-DD.
function todayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: BIRTHDAY_TIMEZONE,
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function fetchBirthdayEvents(guildId: string): Promise<BirthdayEvent[]> {
  if (!remoteApiBaseUrl || !remoteApiToken) {
    return [];
  }
  try {
    const controller = createTimeoutController(remoteTimeoutMs);
    const response = await fetch(
      `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guildId)}/birthdays`,
      {
        headers: { "x-bot-token": remoteApiToken },
        method: "GET",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { events?: BirthdayEvent[] };
    return Array.isArray(data.events) ? data.events : [];
  } catch (error) {
    console.warn(
      `[cumpleaños] no se pudieron leer las fechas de ${guildId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

// El rol del cumpleaños: se reusa el guardado y, si ya no existe en el guild
// (alguien lo borró a mano), se vuelve a crear.
async function ensureBirthdayRole(
  guild: Guild,
  savedRoleId: string | null | undefined,
): Promise<{ created: boolean; roleId: string | null }> {
  if (savedRoleId) {
    const existing = guild.roles.cache.get(savedRoleId);
    if (existing) {
      return { created: false, roleId: existing.id };
    }
  }
  try {
    const role = await guild.roles.create({
      color: BIRTHDAY_ROLE_COLOR,
      mentionable: false,
      name: BIRTHDAY_ROLE_NAME,
      reason: "Rol temporal de cumpleaños (Bonafide Hub)",
    });
    return { created: true, roleId: role.id };
  } catch (error) {
    // Lo habitual: al bot le falta "Gestionar roles" o su rol quedó por debajo
    // en la jerarquía. Se avisa una vez y el resto del barrido sigue.
    console.error(
      `[cumpleaños] no se pudo crear el rol en ${guild.name}: ${
        error instanceof Error ? error.message : String(error)
      } (revisá el permiso "Gestionar roles" y que el rol del bot esté arriba)`,
    );
    return { created: false, roleId: null };
  }
}

async function runGuildBirthdays(guild: Guild): Promise<void> {
  const config = await getGuildConfig(guild.id).catch(() => null);
  if (!config) {
    return;
  }
  const events = await fetchBirthdayEvents(guild.id);
  const hoy = todayKey(new Date());
  const cumpleHoy = events.filter(
    (event) =>
      event.type === "birthday" &&
      Boolean(event.birthdayUserId) &&
      todayKey(new Date(event.startsAt)) === hoy,
  );

  const idsHoy = new Set(
    cumpleHoy
      .map((event) => event.birthdayUserId)
      .filter((id): id is string => Boolean(id)),
  );

  // Sin rol guardado y sin nadie que cumpla hoy no hay nada que hacer: crearlo
  // antes de saberlo dejaba un rol vacío en guilds que nunca usan cumpleaños.
  // Con un rol guardado sí se sigue: hay que sacárselo a quien quedó con él.
  if (!config.birthdayRoleId && idsHoy.size === 0) {
    return;
  }

  const role = await ensureBirthdayRole(guild, config.birthdayRoleId);
  if (role.created && role.roleId) {
    // Se guarda para no recrearlo en el próximo tick ni al reiniciar.
    await fetch(
      `${remoteApiBaseUrl}/internal/guilds/${encodeURIComponent(guild.id)}/config`,
      {
        body: JSON.stringify({ config: { birthdayRoleId: role.roleId } }),
        headers: {
          "content-type": "application/json",
          "x-bot-token": remoteApiToken ?? "",
        },
        method: "PUT",
      },
    ).catch(() => {});
  }
  if (!role.roleId) {
    return;
  }

  // Poner el rol a quien cumple hoy.
  for (const userId of idsHoy) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      continue;
    }
    if (!member.roles.cache.has(role.roleId)) {
      await addRole(member, role.roleId);
    }
  }

  // Quitarlo a quien lo tenga sin cumplir hoy: sin esto, al año siguiente medio
  // server sigue con el rol puesto.
  // El cache de miembros no viene completo (sólo los que el bot ya vio), así
  // que la lista se pide al gateway antes de revisar.
  if (guild.members.cache.size < guild.memberCount) {
    await guild.members.fetch().catch((error: unknown) => {
      console.warn(
        `[cumpleaños] no se pudo leer la lista de miembros de ${guild.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
  for (const member of guild.members.cache.values()) {
    if (!member.roles.cache.has(role.roleId) || idsHoy.has(member.id)) {
      continue;
    }
    await member.roles
      .remove(role.roleId, "Cumpleaños terminado")
      .catch((error: unknown) => {
        console.warn(
          `[cumpleaños] no se pudo quitar el rol a ${member.user.tag}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  // Saludo: una vez por día y sólo si hay canal.
  if (!config.birthdayChannelId || cumpleHoy.length === 0) {
    return;
  }
  if (announced.get(guild.id) === hoy) {
    return;
  }

  const channel = guild.channels.cache.get(config.birthdayChannelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }
  const nombres = cumpleHoy.map((event) =>
    event.title.replace(/^Cumpleaños de /i, ""),
  );
  const texto =
    nombres.length === 1
      ? `🎂 ¡Feliz cumpleaños, **${nombres[0]}**! Que tengas un gran día.`
      : `🎂 ¡Feliz cumpleaños a ${nombres.map((n) => `**${n}**`).join(", ")}! Que tengan un gran día.`;
  // El día se marca recién con el saludo enviado: marcarlo antes hacía que un
  // envío fallido no se reintentara hasta el día siguiente.
  const sent = await channel.send(texto).then(
    () => true,
    (error: unknown) => {
      console.warn(
        `[cumpleaños] no se pudo saludar en ${guild.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    },
  );
  if (sent) {
    announced.set(guild.id, hoy);
  }
}

async function addRole(member: GuildMember, roleId: string): Promise<void> {
  await member.roles.add(roleId, "Cumpleaños").catch((error: unknown) => {
    console.warn(
      `[cumpleaños] no se pudo dar el rol a ${member.user.tag}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

export function startBirthdayProcessor(client: Client): void {
  const sweep = (): void => {
    for (const guild of client.guilds.cache.values()) {
      void runGuildBirthdays(guild).catch((error: unknown) => {
        console.error(
          `[cumpleaños] barrido falló en ${guild.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  };

  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS);

  client.on(Events.GuildCreate, (guild) => {
    void runGuildBirthdays(guild).catch(() => {});
  });
}
