import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";

export type ReactionRolePair = {
  emoji: string;
  roleId: string;
};

export type ReactionRoleRuleData = {
  emoji: string;
  roleId: string;
};

// Los borradores no tienen mensaje real en Discord; usamos un id sintético
// que solo sirve de clave hasta publicar (messageId se reemplaza por el real).
function syntheticDraftMessageId(): string {
  return `draft_${randomUUID()}`;
}

function parseRules(value: unknown): ReactionRoleRuleData[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      emoji: String((item as { emoji?: unknown })?.emoji ?? ""),
      roleId: String((item as { roleId?: unknown })?.roleId ?? ""),
    }))
    .filter((rule) => rule.emoji && rule.roleId);
}

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

export async function createReactionRoleTemplate(input: {
  channelId?: string;
  description?: string;
  guildId: string;
  mode?: string;
  rules: ReactionRoleRuleData[];
  title?: string;
}): Promise<ReactionRolePanel> {
  const record = await prisma.reactionRolePanel.create({
    data: {
      channelId: input.channelId ?? null,
      description: input.description || null,
      guildId: input.guildId,
      messageId: syntheticDraftMessageId(),
      mode: input.mode ?? "multiple",
      rules: input.rules,
      status: "draft",
      title: input.title || null,
    },
  });
  return toReactionRolePanel(record);
}

export async function updateReactionRoleTemplate(input: {
  channelId?: string;
  description?: string;
  guildId: string;
  messageId: string;
  mode?: string;
  rules: ReactionRoleRuleData[];
  title?: string;
}): Promise<ReactionRolePanel | null> {
  try {
    const record = await prisma.reactionRolePanel.update({
      where: {
        guildId_messageId: {
          guildId: input.guildId,
          messageId: input.messageId,
        },
      },
      data: {
        channelId: input.channelId ?? null,
        description: input.description || null,
        mode: input.mode ?? "multiple",
        rules: input.rules,
        title: input.title || null,
      },
    });
    return toReactionRolePanel(record);
  } catch {
    return null;
  }
}

export async function getReactionRolePanel(
  guildId: string,
  messageId: string,
): Promise<ReactionRolePanel | null> {
  const record = await prisma.reactionRolePanel.findUnique({
    where: { guildId_messageId: { guildId, messageId } },
  });
  return record ? toReactionRolePanel(record) : null;
}

// Al completar un job de publicación, el panel pasa de borrador a publicado
// y su messageId sintético se reemplaza por el del mensaje real en Discord.
export async function markReactionRoleTemplatePublished(input: {
  channelId: string;
  description?: string;
  guildId: string;
  messageId: string;
  mode?: string;
  realMessageId: string;
  rules: ReactionRoleRuleData[];
  title?: string;
}): Promise<void> {
  await prisma.reactionRolePanel.updateMany({
    where: { guildId: input.guildId, messageId: input.messageId },
    data: {
      channelId: input.channelId,
      description: input.description || null,
      messageId: input.realMessageId,
      mode: input.mode ?? "multiple",
      rules: input.rules,
      status: "published",
      title: input.title || null,
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

export async function deleteReactionRoleJob(
  guildId: string,
  jobId: string,
): Promise<void> {
  await prisma.reactionRolePanelJob.deleteMany({
    where: { guildId, id: jobId },
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

  if (job && input.panel && input.messageId) {
    // El job.messageId es la clave del panel (sintética si era borrador).
    await markReactionRoleTemplatePublished({
      channelId: input.panel.channelId ?? job.channelId ?? "",
      description: input.panel.description,
      guildId,
      messageId: job.messageId ?? "",
      mode: input.panel.mode ?? job.mode,
      realMessageId: input.messageId,
      rules: (Array.isArray(job.rules) ? job.rules : []) as ReactionRoleRuleData[],
      title: input.panel.title,
    });
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
  createdAt: Date;
  description?: string;
  messageId: string;
  mode: string;
  rules: ReactionRoleRuleData[];
  status: "draft" | "published";
  title?: string;
  updatedAt: Date;
};

function toReactionRolePanel(record: {
  channelId: string | null;
  createdAt: Date;
  description: string | null;
  messageId: string;
  mode: string;
  rules: unknown;
  status: string;
  title: string | null;
  updatedAt: Date;
}): ReactionRolePanel {
  return {
    channelId: record.channelId,
    createdAt: record.createdAt,
    description: record.description ?? undefined,
    messageId: record.messageId,
    mode: record.mode,
    rules: parseRules(record.rules),
    status: (record.status === "draft" ? "draft" : "published") as
      | "draft"
      | "published",
    title: record.title ?? undefined,
    updatedAt: record.updatedAt,
  };
}

export async function listReactionRolePanels(
  guildId: string,
): Promise<ReactionRolePanel[]> {
  const [rules, panels] = await Promise.all([
    prisma.reactionRoleRule.findMany({ where: { guildId } }),
    prisma.reactionRolePanel.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Reglas por mensaje publicado (migración: paneles viejos sin rules JSON).
  const rulesByMessage = new Map<
    string,
    Array<{ emojiKey: string; roleId: string }>
  >();
  for (const rule of rules) {
    const list = rulesByMessage.get(rule.messageId) ?? [];
    list.push({ emojiKey: rule.emojiKey, roleId: rule.roleId });
    rulesByMessage.set(rule.messageId, list);
  }

  return panels.map((panel) => {
    const panelData = toReactionRolePanel(panel);
    if (panelData.rules.length === 0 && panel.messageId) {
      panelData.rules = (rulesByMessage.get(panel.messageId) ?? []).map(
        (rule) => ({
          emoji: rule.emojiKey,
          roleId: rule.roleId,
        }),
      );
    }
    return panelData;
  });
}

export type ReactionRoleJobSummary = {
  action: string;
  channelId: string | null;
  createdAt: string;
  error: string | null;
  id: string;
  messageId: string | null;
  mode: string;
  status: string;
  title: string | null;
};

export async function listRecentReactionRoleJobs(
  guildId: string,
  limit = 30,
): Promise<ReactionRoleJobSummary[]> {
  const jobs = await prisma.reactionRolePanelJob.findMany({
    where: { guildId },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });

  return jobs.map((job) => ({
    action: job.action,
    channelId: job.channelId,
    createdAt: job.createdAt.toISOString(),
    error: job.error,
    id: job.id,
    messageId: job.messageId,
    mode: job.mode,
    status: job.status,
    title: job.title,
  }));
}
