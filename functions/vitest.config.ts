import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.dirname(fileURLToPath(import.meta.url)),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
