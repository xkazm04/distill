/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  base: "./",
  server: { port: 5181, strictPort: true },
  build: { target: "es2022", sourcemap: false },
  test: { environment: "happy-dom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
