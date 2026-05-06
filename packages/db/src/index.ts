import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

loadEnv({ path: resolve(process.cwd(), "../../.env.example") });
loadEnv({ path: resolve(process.cwd(), "../../.env"), override: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "true" ? ["query", "info", "warn", "error"] : ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "./generated/prisma/client.js";
export * from "./tokens.js";
