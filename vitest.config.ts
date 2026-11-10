import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "server/test/**/*.test.ts", "apps/field/test/**/*.test.ts"],
    environment: "node",
  },
});
