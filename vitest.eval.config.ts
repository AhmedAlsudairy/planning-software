import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// The retrieval evaluation needs a database and issues real searches against the promoted upload,
// so it is kept out of `npm run verify`. Its *.eval.ts suffix does not match the default test glob;
// this config is what picks it up, via `npm run eval-search`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.eval.ts"],
    testTimeout: 1_800_000,
  },
});
