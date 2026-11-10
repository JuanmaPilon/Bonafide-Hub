import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

export { Prisma };

declare global {
  var __bonafideApiPrisma__: PrismaClient | undefined;
}

// Prisma arma el pool con `núcleos físicos × 2 + 1`, y en un contenedor ve los
// núcleos del host, no los asignados: puede abrir 30+ conexiones. Cada una
// ocupa memoria acá y crea un proceso backend en Postgres, que también se
// factura. Con 5 alcanza para un servidor de una guild.
const CONNECTION_LIMIT = 5;
const POOL_TIMEOUT_SECONDS = 20;

function withPoolLimits(url: string): string {
  try {
    const parsed = new URL(url);
    // Si la URL ya trae los parámetros, se respetan: permite probar otro valor
    // desde las variables de entorno sin tocar código.
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", String(CONNECTION_LIMIT));
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", String(POOL_TIMEOUT_SECONDS));
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export const prisma =
  globalThis.__bonafideApiPrisma__ ??
  new PrismaClient({
    datasources: { db: { url: withPoolLimits(env.DATABASE_URL) } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__bonafideApiPrisma__ = prisma;
}
