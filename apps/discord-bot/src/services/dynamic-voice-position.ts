// Dónde va una sala temporal nueva dentro de la categoría del canal creador.
//
// Va justo DEBAJO del creador y, si ya hay salas pegadas ahí, se apila al final
// de ese bloque: así se leen en el orden en que se crearon.
//
// Sólo cuentan las salas CONTIGUAS al creador. Sumar todas las de la categoría
// asume que están pegadas, y cuando no lo están (salas viejas que quedaron
// arriba del AFK, o canales que alguien arrastró en el medio) la cuenta da de
// más y la sala nueva aparece debajo de canales ajenos en vez de debajo del
// creador.

export type PositionedChannelLike = {
  parentId?: string | null;
  position: number;
};

export type TemporaryRoomLookup = (
  channelId: string,
) => { parentId?: string | null; position?: number } | undefined;

export function temporaryVoicePosition(
  creator: PositionedChannelLike,
  temporaryVoiceChannelIds: readonly string[],
  getChannel: TemporaryRoomLookup,
): number {
  const creatorPosition = Math.max(creator.position, 0);
  const creatorParentId = creator.parentId ?? null;
  const roomPositions: number[] = [];

  for (const channelId of temporaryVoiceChannelIds) {
    const room = getChannel(channelId);
    if (!room || (room.parentId ?? null) !== creatorParentId) {
      continue;
    }
    if (typeof room.position !== "number" || room.position <= creatorPosition) {
      continue;
    }
    roomPositions.push(room.position);
  }

  roomPositions.sort((left, right) => left - right);

  let position = creatorPosition + 1;
  for (const roomPosition of roomPositions) {
    if (roomPosition !== position) {
      break;
    }
    position += 1;
  }

  return position;
}
