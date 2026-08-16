import path from "node:path";
import { defineConfig } from "vitest/config";

// import.meta.dirname requires Node >= 20.11 (provided by @types/node).
export default defineConfig({
  resolve: {
    alias: {
      "#src": path.resolve(import.meta.dirname, "src"),
      "#test": path.resolve(import.meta.dirname, "test"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
