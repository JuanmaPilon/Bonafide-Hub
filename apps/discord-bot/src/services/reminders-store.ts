import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Reminder = {
  id: string;
  guildId: string;
  channelId: string;
  deliveryType?: "channel" | "dm";
  message: string;
  minutesFromCreation: number;
  dueAt: string;
  createdByUserId: string;
  roleId?: string;
  sentAt?: string;
};

type ReminderStore = Record<string, Reminder[]>;

const dataDirPath = path.resolve(process.cwd(), "data");
const remindersFilePath = path.resolve(dataDirPath, "reminders.json");

function createReminderId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function readStore(): Promise<ReminderStore> {
  try {
    const raw = await readFile(remindersFilePath, "utf8");
    const parsed = JSON.parse(raw) as ReminderStore;

    return parsed;
  } catch (error: unknown) {
    const maybeFsError = error as NodeJS.ErrnoException;
    if (maybeFsError.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeStore(store: ReminderStore): Promise<void> {
  await mkdir(dataDirPath, { recursive: true });
  await writeFile(remindersFilePath, JSON.stringify(store, null, 2), "utf8");
}

export async function createReminder(input: {
  guildId: string;
  channelId: string;
  deliveryType?: "channel" | "dm";
  message: string;
  minutesFromCreation: number;
  createdByUserId: string;
  roleId?: string;
}): Promise<Reminder> {
  const store = await readStore();
  const dueAtDate = new Date(Date.now() + input.minutesFromCreation * 60_000);

  const reminder: Reminder = {
    id: createReminderId(),
    guildId: input.guildId,
    channelId: input.channelId,
    deliveryType: input.deliveryType ?? "channel",
    message: input.message,
    minutesFromCreation: input.minutesFromCreation,
    dueAt: dueAtDate.toISOString(),
    createdByUserId: input.createdByUserId,
    roleId: input.roleId,
  };

  const existing = store[input.guildId] ?? [];
  store[input.guildId] = [...existing, reminder];
  await writeStore(store);

  return reminder;
}

export async function listGuildReminders(guildId: string): Promise<Reminder[]> {
  const store = await readStore();
  const reminders = store[guildId] ?? [];

  return reminders.sort(
    (left, right) =>
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
  );
}

export async function cancelReminder(
  guildId: string,
  reminderId: string,
): Promise<boolean> {
  const store = await readStore();
  const existing = store[guildId] ?? [];
  const filtered = existing.filter((entry) => entry.id !== reminderId);

  if (filtered.length === existing.length) {
    return false;
  }

  store[guildId] = filtered;
  await writeStore(store);
  return true;
}

export async function listDueReminders(nowIso: string): Promise<Reminder[]> {
  const store = await readStore();
  const nowMs = new Date(nowIso).getTime();

  const due: Reminder[] = [];
  for (const guildReminders of Object.values(store)) {
    for (const reminder of guildReminders) {
      if (reminder.sentAt) {
        continue;
      }

      const dueMs = new Date(reminder.dueAt).getTime();
      if (dueMs <= nowMs) {
        due.push(reminder);
      }
    }
  }

  return due;
}

export async function markReminderSent(
  guildId: string,
  reminderId: string,
): Promise<boolean> {
  const store = await readStore();
  const existing = store[guildId] ?? [];
  let updated = false;

  const next = existing.map((entry) => {
    if (entry.id !== reminderId || entry.sentAt) {
      return entry;
    }

    updated = true;
    return {
      ...entry,
      sentAt: new Date().toISOString(),
    };
  });

  if (!updated) {
    return false;
  }

  store[guildId] = next;
  await writeStore(store);
  return true;
}
