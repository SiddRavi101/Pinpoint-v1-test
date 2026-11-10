import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the bundle works inside the native wrapper.
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: { port: 5173 },
});
