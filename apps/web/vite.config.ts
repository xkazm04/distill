/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The App Check DEBUG token is a bypass credential: anyone holding it passes App Check. Vite inlines every VITE_* value
// it sees, so a production build of the hosted web app blanks it explicitly (the web app uses reCAPTCHA Enterprise).
// `npm run check:dist` fails the deploy if the token's value ever appears in apps/web/dist.
// Tests are hermetic: in test mode no .env is read (envDir points at this package, which has none), so a checkout with
// a real Firebase config runs the same code paths as CI and the builders' worktrees. Found 2026-11-17: 8 tests passed in
// worktrees and failed in the main checkout, which has a .env.
export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  envDir: mode === "test" ? "." : "../..",
  base: "./",
  define: command === "build" ? { "import.meta.env.VITE_APPCHECK_DEBUG_TOKEN": JSON.stringify("") } : {},
  server: { port: 5181, strictPort: true },
  build: { target: "es2022", sourcemap: false },
  test: { environment: "happy-dom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
}));
