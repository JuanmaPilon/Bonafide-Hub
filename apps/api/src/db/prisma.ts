import { PrismaClient } from "@prisma/client";

declare global {
  var __bonafideApiPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__bonafideApiPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__bonafideApiPrisma__ = prisma;
}
