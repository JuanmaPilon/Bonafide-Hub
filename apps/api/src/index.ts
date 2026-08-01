import { buildApp } from "./app.js";
import { env } from "./config/env.js";

async function main(): Promise<void> {
  const app = buildApp();

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
