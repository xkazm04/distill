import { defineConfig } from "playwright/test";

// The caption on REAL sites (live/README.md). Opt-in: `npm run e2e:live -w @distill/extension`. Needs the network, takes
// minutes, and a site can change under it, so it is never part of `npm run check` or `npm run e2e`.
export default defineConfig({
  testDir: "live",
  testMatch: "*.live.ts",
  // The per-feature probes (live/probes/, round 1 of docs/caption.md) add minutes; they run only when asked:
  // E2E_PROBES=1 npm run e2e:live (all of them), or name one: npx playwright test -c e2e/playwright.live.config.ts probes/find
  testIgnore: process.env.E2E_PROBES || process.argv.some((a) => a.includes("probes")) ? [] : ["probes/**"],
  outputDir: "out/live/test-results",
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
