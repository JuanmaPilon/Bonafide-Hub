import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required"),
  DISCORD_REDIRECT_URI: z
    .string()
    .url("DISCORD_REDIRECT_URI must be a valid URL"),
  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 chars"),
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection URL"),
  BOT_API_TOKEN: z.string().min(16).optional(),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  COOKIE_SAME_SITE: z.enum(["Lax", "Strict", "None"]).default("Lax"),
  FRONTEND_APP_URL: z
    .string()
    .url("FRONTEND_APP_URL must be a valid URL")
    .default("http://localhost:5173"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${details}`);
}

export const env = parsed.data;
