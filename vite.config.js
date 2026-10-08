import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works from any static host path (GitHub Pages, itch.io, a local file server).
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "./",
  build: { outDir: "dist", sourcemap: false },
});
