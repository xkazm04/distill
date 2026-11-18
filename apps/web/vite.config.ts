/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { guideLibrary } from "../../scripts/guides/library.mjs";

// The App Check DEBUG token is a bypass credential: anyone holding it passes App Check. Vite inlines every VITE_* value
// it sees, so a production build of the hosted web app blanks it explicitly (the web app uses reCAPTCHA Enterprise).
// `npm run check:dist` fails the deploy if the token's value ever appears in apps/web/dist.
// Tests are hermetic: in test mode no .env is read (envDir points at this package, which has none), so a checkout with
// a real Firebase config runs the same code paths as CI and the builders' worktrees. Found 2026-11-17: 8 tests passed in
// worktrees and failed in the main checkout, which has a .env.
// The guide library (guides/README.md) is served as one file of the app, guides/library.json. Draft guides are in it
// only on the dev server with VITE_GUIDE_DRAFTS=1: a build (what is deployed) never carries a draft.
export default defineConfig(({ command, mode }) => {
  const envDir = mode === "test" ? "." : "../..";
  const drafts = command === "serve" && mode !== "test" && loadEnv(mode, envDir, "VITE_").VITE_GUIDE_DRAFTS === "1";
  return {
    plugins: [react(), guideLibrary({ as: "asset", drafts })],
    envDir,
    base: "./",
    define: {
      ...(command === "build" ? { "import.meta.env.VITE_APPCHECK_DEBUG_TOKEN": JSON.stringify("") } : {}),
      "import.meta.env.VITE_GUIDE_DRAFTS": JSON.stringify(drafts ? "1" : ""),
    },
    server: { port: 5181, strictPort: true },
    build: { target: "es2022", sourcemap: false },
    test: { environment: "happy-dom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  };
});
