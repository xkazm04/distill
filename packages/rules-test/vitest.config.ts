import { defineConfig } from "vitest/config";

// Runs only inside `firebase emulators:exec` (root `npm run test:rules`), which sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 20_000, hookTimeout: 60_000, fileParallelism: false },
});
