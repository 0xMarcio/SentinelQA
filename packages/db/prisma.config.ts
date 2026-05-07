import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

loadEnv({ path: resolve(process.cwd(), "../../.env.example") });
loadEnv({ path: resolve(process.cwd(), "../../.env"), override: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL")
  }
});
