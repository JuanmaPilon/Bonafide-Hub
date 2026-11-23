import type { ChatInputCommandInteraction, Guild } from "discord.js";

// La música la lleva un bot externo (Jockie). Con `MUSIC_DISABLED` los comandos
// de audio siguen registrados —si desaparecieran, Discord contestaría "comando
// desconocido" y no habría forma de explicar qué usar— pero responden con una
// redirección en vez de reproducir nada.

const JOCKIE_HINT = /jockie/i;

// Si Jockie está en el servidor se lo etiqueta (queda como enlace a su perfil);
// si no, se lo nombra en texto. No se puede asumir que esté: el bot se invita
// aparte.
export function jockieMention(guild: Guild | null): string {
  const jockie = guild?.members.cache.find(
    (member) => member.user.bot && JOCKIE_HINT.test(member.user.username),
  );
  return jockie ? `<@${jockie.id}>` : "**Jockie**";
}

export function musicDisabledMessage(guild: Guild | null): string {
  return `🎵 La música ahora va por ${jockieMention(guild)}: usá su \`/play\`.`;
}

// Ephemeral: el aviso es para quien escribió el comando, no para el canal.
export async function replyMusicDisabled(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction
    .reply({
      content: musicDisabledMessage(interaction.guild),
      ephemeral: true,
    })
    .catch(() => undefined);
}
