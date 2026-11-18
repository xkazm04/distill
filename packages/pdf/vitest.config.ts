import { defineConfig } from "vitest/config";

// Node, not a DOM: the PDF code reads and writes bytes, and pdf.js runs its legacy build here. Hermetic: envDir is this
// package, which has no .env, so a checkout with a real Firebase config runs exactly what a worktree runs.
export default defineConfig({
  envDir: ".",
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
