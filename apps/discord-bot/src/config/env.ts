import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z
    .string()
    .min(1, "DISCORD_BOT_TOKEN is required")
    .optional(),
  DISCORD_APPLICATION_ID: z
    .string()
    .regex(/^\d+$/, "DISCORD_APPLICATION_ID must be numeric")
    .optional(),
  DISCORD_GUILD_ID: z
    .string()
    .regex(/^\d+$/, "DISCORD_GUILD_ID must be numeric")
    .optional(),
  BOT_DISABLED: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${details}`);
}

const disableFlag = parsed.data.BOT_DISABLED?.trim().toLowerCase();
const isBotDisabled =
  disableFlag === "true" ||
  disableFlag === "1" ||
  disableFlag === "yes" ||
  disableFlag === "on";

if (!isBotDisabled && !parsed.data.DISCORD_BOT_TOKEN) {
  throw new Error(
    "Invalid environment variables: DISCORD_BOT_TOKEN is required unless BOT_DISABLED=true",
  );
}

export const env = {
  ...parsed.data,
  BOT_DISABLED: isBotDisabled,
};
