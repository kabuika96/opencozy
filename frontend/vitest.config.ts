import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["dist/**", "node_modules/**"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
