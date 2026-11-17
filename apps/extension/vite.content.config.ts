import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: { entry: "src/content.ts", name: "DistillContent", formats: ["iife"], fileName: () => "content.js" },
  },
});
