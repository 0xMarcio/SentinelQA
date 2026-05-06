import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: "test"
    }
  },
  resolve: {
    alias: {
      "@sentinelqa/dsl": "/Users/marc/code/SentinelQA/packages/dsl/src/index.ts",
      "@sentinelqa/db": "/Users/marc/code/SentinelQA/packages/db/src/index.ts",
      "@sentinelqa/storage": "/Users/marc/code/SentinelQA/packages/storage/src/index.ts",
      "@sentinelqa/integrations": "/Users/marc/code/SentinelQA/packages/integrations/src/index.ts"
    }
  }
});

