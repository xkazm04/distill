import { defineConfig } from "vitest/config";

// The PDF form benchmark printer. `--mode update-baseline` (npm run bench:forms:update) is the only way its baseline is
// rewritten. Reads no .env.
export default defineConfig(({ mode }) => ({
  envDir: ".",
  test: {
    environment: "node",
    include: ["test/bench/pdf-forms.bench.ts"],
    env: { BENCH_UPDATE: mode === "update-baseline" ? "1" : "0" },
  },
}));
