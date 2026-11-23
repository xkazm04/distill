import { defineConfig } from "playwright/test";

// The extension end to end in a real Chromium. Run with `npm run e2e -w @distill/extension` (see README.md here).
// One worker: each test launches its own browser with the extension loaded, and they share one demo server.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "out/test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The HTML report (e2e/out/report/index.html) shows a failed picture test's expected, actual and diff side by side.
  reporter: [["list"], ["html", { outputFolder: "out/report", open: "never" }]],
});
