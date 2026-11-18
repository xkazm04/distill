import { defineConfig } from "vitest/config";

// The form benchmark printer. `--mode update-baseline` (npm run bench:forms:update) is the only way the baseline is
// rewritten. Reads no .env.
export default defineConfig(({ mode }) => ({
  test: {
    environment: "happy-dom",
    include: ["test/bench/forms.bench.ts"],
    env: { BENCH_UPDATE: mode === "update-baseline" ? "1" : "0" },
  },
}));
