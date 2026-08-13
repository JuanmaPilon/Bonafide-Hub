import { prisma } from "../db/prisma.js";

export type ReactionRolePair = {
  emoji: string;
  roleId: string;
};

export async function createReactionRoleJob(input: {
  action: "create" | "delete" | "update";
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

export async function upsertReactionRolePanel(
  guildId: string,
  messageId: string,
  panel: {
    channelId?: string;
    description?: string;
    mode?: string;
    title?: string;
  },
): Promise<void> {
  await prisma.reactionRolePanel.upsert({
    where: { guildId_messageId: { guildId, messageId } },
    update: {
      channelId: panel.channelId,
      description: panel.description,
      mode: panel.mode ?? "multiple",
      title: panel.title,
    },
    create: {
      channelId: panel.channelId,
      description: panel.description,
      guildId,
      messageId,
      mode: panel.mode ?? "multiple",
      title: panel.title,
    },
  });
}

export async function deleteReactionRolePanel(
  guildId: string,
  messageId: string,
): Promise<void> {
  await prisma.reactionRolePanel.deleteMany({
    where: { guildId, messageId },
  });
}

export async function completeReactionRoleJob(
  guildId: string,
  jobId: string,
  input: {
    error?: string;
    messageId?: string;
    panel?: {
      channelId?: string;
      description?: string;
      mode?: string;
      title?: string;
    };
  },
): Promise<void> {
  const job = await prisma.reactionRolePanelJob.findUnique({
    where: { id: jobId },
  });

  if (job && job.action === "delete" && job.messageId) {
    await deleteReactionRolePanel(guildId, job.messageId);
  }

  if (input.panel && input.messageId) {
    await upsertReactionRolePanel(guildId, input.messageId, input.panel);
  }

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
  description?: string;
  messageId: string;
  mode: string;
  rules: Array<{ emojiKey: string; roleId: string }>;
  title?: string;
};

export async function listReactionRolePanels(
  guildId: string,
): Promise<ReactionRolePanel[]> {
  const [rules, panels] = await Promise.all([
    prisma.reactionRoleRule.findMany({
      where: { guildId },
      orderBy: [{ messageId: "asc" }, { emojiKey: "asc" }],
    }),
    prisma.reactionRolePanel.findMany({ where: { guildId } }),
  ]);

  const panelByMessage = new Map<string, ReactionRolePanel>();

  for (const panel of panels) {
    panelByMessage.set(panel.messageId, {
      channelId: panel.channelId,
      description: panel.description ?? undefined,
      messageId: panel.messageId,
      mode: panel.mode,
      rules: [],
      title: panel.title ?? undefined,
    });
  }

  for (const rule of rules) {
    const existing = panelByMessage.get(rule.messageId);
    if (existing) {
      existing.rules.push({ emojiKey: rule.emojiKey, roleId: rule.roleId });
    } else {
      panelByMessage.set(rule.messageId, {
        channelId: rule.channelId,
        messageId: rule.messageId,
        mode: rule.mode ?? "multiple",
        rules: [{ emojiKey: rule.emojiKey, roleId: rule.roleId }],
      });
    }
  }

  return Array.from(panelByMessage.values());
}
