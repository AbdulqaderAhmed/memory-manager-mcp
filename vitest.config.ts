import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    // Each test file mutates process.env (AGENT_MEMORY_HOME) and spawns git
    // processes, so run every file in its own forked process for isolation.
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
