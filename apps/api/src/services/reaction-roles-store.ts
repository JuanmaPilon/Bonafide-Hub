import { prisma } from "../db/prisma.js";

export type ReactionRolePair = {
  emoji: string;
  roleId: string;
};

export async function createReactionRoleJob(input: {
  action: "create" | "delete";
  channelId?: string;
  description?: string;
  guildId: string;
  messageId?: string;
  mode?: string;
  rules?: ReactionRolePair[];
  title?: string;
}): Promise<{ jobId: string }> {
  const job = await prisma.reactionRolePanelJob.create({
    data: {
      action: input.action,
      channelId: input.channelId,
      description: input.description,
      guildId: input.guildId,
      messageId: input.messageId,
      mode: input.mode ?? "multiple",
      rules: input.rules ?? [],
      status: "pending",
    },
  });

  return { jobId: job.id };
}

export type PendingReactionRoleJob = {
  action: string;
  channelId: string | null;
  description: string | null;
  guildId: string;
  id: string;
  messageId: string | null;
  mode: string;
  rules: ReactionRolePair[];
  title: string | null;
};

export async function listPendingReactionRoleJobs(
  guildId: string,
): Promise<PendingReactionRoleJob[]> {
  const jobs = await prisma.reactionRolePanelJob.findMany({
    where: { guildId, status: "pending" },
    orderBy: [{ createdAt: "asc" }],
  });

  return jobs.map((job) => ({
    action: job.action,
    channelId: job.channelId,
    description: job.description,
    guildId: job.guildId,
    id: job.id,
    messageId: job.messageId,
    mode: job.mode,
    rules: (Array.isArray(job.rules) ? job.rules : []) as ReactionRolePair[],
    title: job.title,
  }));
}

export async function completeReactionRoleJob(
  guildId: string,
  jobId: string,
  input: { error?: string; messageId?: string },
): Promise<void> {
  await prisma.reactionRolePanelJob.update({
    where: { id: jobId },
    data: {
      error: input.error,
      messageId: input.messageId,
      status: input.error ? "failed" : "done",
    },
  });
}

export type ReactionRolePanel = {
  channelId: string | null;
  messageId: string;
  mode: string;
  rules: Array<{ emojiKey: string; roleId: string }>;
};

export async function listReactionRolePanels(
  guildId: string,
): Promise<ReactionRolePanel[]> {
  const rules = await prisma.reactionRoleRule.findMany({
    where: { guildId },
    orderBy: [{ messageId: "asc" }, { emojiKey: "asc" }],
  });

  const grouped = new Map<string, ReactionRolePanel>();

  for (const rule of rules) {
    const key = `${rule.messageId}:${rule.channelId ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.rules.push({ emojiKey: rule.emojiKey, roleId: rule.roleId });
    } else {
      grouped.set(key, {
        channelId: rule.channelId,
        messageId: rule.messageId,
        mode: rule.mode ?? "multiple",
        rules: [{ emojiKey: rule.emojiKey, roleId: rule.roleId }],
      });
    }
  }

  return Array.from(grouped.values());
}
