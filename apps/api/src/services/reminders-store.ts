import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Reminder = {
  channelId: string;
  createdByUserId: string;
  dueAt: string;
  guildId: string;
  id: string;
  message: string;
  minutesFromCreation: number;
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
    return JSON.parse(raw) as ReminderStore;
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
  channelId: string;
  createdByUserId: string;
  guildId: string;
  message: string;
  minutesFromCreation: number;
  roleId?: string;
}): Promise<Reminder> {
  const store = await readStore();
  const dueAtDate = new Date(Date.now() + input.minutesFromCreation * 60_000);

  const reminder: Reminder = {
    channelId: input.channelId,
    createdByUserId: input.createdByUserId,
    dueAt: dueAtDate.toISOString(),
    guildId: input.guildId,
    id: createReminderId(),
    message: input.message,
    minutesFromCreation: input.minutesFromCreation,
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
  const next = existing.filter((entry) => entry.id !== reminderId);

  if (next.length === existing.length) {
    return false;
  }

  store[guildId] = next;
  await writeStore(store);
  return true;
}
