import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        // A committed, account-neutral config rather than the gitignored real
        // one: tests use simulated bindings and need no real values, so this
        // keeps `npm test` working on a fresh clone with no setup.
        configPath: "./wrangler.test.jsonc",
      },
    }),
  ],
  test: {
    include: ["test/**/*.spec.ts"],
  },
});
