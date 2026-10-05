// Universo de gente a la que le corresponde responder un evento: los que tienen
// el rol mínimo del evento y los que tienen el rol de Bench del roster.
//
// El bench es parte del roster (por eso cuenta en el "N/M" y recibe el aviso),
// pero viaja marcado: no es core y el informe lo lista aparte. Quien tiene los
// dos roles cuenta como core.
//
// Función pura: la usan el listado de eventos, el detalle del roster y el
// contador que se manda a Discord.

export type RosterMember = { bench: boolean; userId: string; username: string };

type DiscordMemberLike = {
  nick?: string | null;
  roles?: string[];
  user?:
    | {
        bot?: boolean;
        global_name?: string | null;
        id?: string;
        username?: string | null;
      }
    | null;
};

export function expectedRoster(
  members: DiscordMemberLike[],
  event: {
    requiredRoleId?: string;
    signups?: Array<{ userId?: string }>;
  },
  benchRoleId?: string,
): {
  bench: RosterMember[];
  expectedCount: number;
  missing: RosterMember[];
} | null {
  const roleId = event.requiredRoleId?.trim();
  if (!roleId) {
    return null;
  }
  const benchRole = benchRoleId?.trim();

  const answered = new Set(
    (event.signups ?? [])
      .map((signup) => signup.userId)
      .filter((userId): userId is string => Boolean(userId)),
  );
  const core: RosterMember[] = [];
  const bench: RosterMember[] = [];
  for (const member of members) {
    const user = member.user;
    if (!user?.id || user.bot === true) {
      continue;
    }
    const roles = member.roles ?? [];
    const isCore = roles.includes(roleId);
    const isBench = !isCore && Boolean(benchRole) && roles.includes(benchRole!);
    if (!isCore && !isBench) {
      continue;
    }
    const entry: RosterMember = {
      bench: isBench,
      userId: user.id,
      username: member.nick ?? user.global_name ?? user.username ?? user.id,
    };
    if (isBench) {
      bench.push(entry);
    } else {
      core.push(entry);
    }
  }
  const expected = [...core, ...bench].sort((left, right) =>
    left.username.localeCompare(right.username),
  );

  return {
    bench,
    expectedCount: expected.length,
    missing: expected.filter((member) => !answered.has(member.userId)),
  };
}
