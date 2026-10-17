import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `vite build` writes the app to dist/, which @xray/server serves.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Monaco, the code viewer, is a chunk of its own, of nearly 3 MB, loaded
    // from 127.0.0.1 only once a Recovered Solution is shown.
    chunkSizeWarningLimit: 4096,
  },
});
