import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Installer UI bundles into src-tauri/target/... on tauri build.
// Keep base relative so it works inside Tauri's custom protocol.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
});