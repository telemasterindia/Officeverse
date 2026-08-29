import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // DB-touching integration tests are opt-in and require a live MySQL.
    exclude: ["**/node_modules/**", "src/**/*.itest.ts"],
  },
});
