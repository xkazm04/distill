/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Side panel (React) and the background worker are one multi-entry build. The content script is a second build
// (vite.content.config.ts) because a content script must be a single classic script with no imports.
export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { sidepanel: "sidepanel.html", background: "src/background.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  test: { environment: "happy-dom", include: ["src/**/*.test.ts"] },
});
