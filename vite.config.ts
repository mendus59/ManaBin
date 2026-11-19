import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Relative base so the built site works at https://<user>.github.io/<repo>/ or any other path.
export default defineConfig({
  base: "./",
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true },
});
