import { defineConfig } from "vite";
import { defineOf, outDirOf, variantOf } from "./vite.config";

// The content script, built into the same folder as the side panel for the chosen variant (see vite.config.ts).
export default defineConfig(({ mode }) => {
  const variant = variantOf(mode);
  return {
    envDir: mode === "e2e" ? "." : "../..", // the e2e build reads no .env, so it is the same in every checkout
    define: defineOf(variant),
    build: {
      target: "es2022",
      outDir: mode === "e2e" ? "dist-e2e" : outDirOf(variant),
      emptyOutDir: false,
      sourcemap: false,
      lib: { entry: "src/content.ts", name: "DistillContent", formats: ["iife"], fileName: () => "content.js" },
    },
  };
});
