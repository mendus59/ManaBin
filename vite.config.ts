import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = (name: string) => dirname(require.resolve(`${name}/package.json`));
const version = (name: string) => JSON.parse(readFileSync(join(pkg(name), "package.json"), "utf8")).version as string;

/**
 * The text reader (Tesseract) is served with the site rather than from a CDN, so scanning works
 * offline once it's cached. Files go under ocr/<versions>/ so a new version gets new URLs.
 */
const OCR_DIR = `ocr/${version("tesseract.js")}-${version("tesseract.js-core")}`;
const OCR_FILES: Record<string, () => string> = {
  "worker.min.js": () => join(pkg("tesseract.js"), "dist/worker.min.js"),
  "tesseract-core-lstm.wasm.js": () => join(pkg("tesseract.js-core"), "tesseract-core-lstm.wasm.js"),
  "tesseract-core-simd-lstm.wasm.js": () => join(pkg("tesseract.js-core"), "tesseract-core-simd-lstm.wasm.js"),
  "tesseract-core-relaxedsimd-lstm.wasm.js": () => join(pkg("tesseract.js-core"), "tesseract-core-relaxedsimd-lstm.wasm.js"),
  "eng.traineddata.gz": () => join(pkg("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"),
};

function ocrFiles(): Plugin {
  return {
    name: "manabin-ocr-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/ocr\/[^/]+\/([^/?]+)/);
        const file = m && OCR_FILES[m[1]]?.();
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(OCR_FILES)) {
        this.emitFile({ type: "asset", fileName: `${OCR_DIR}/${name}`, source: readFileSync(file()) });
      }
      // The service worker, stamped with this build so a new deploy replaces the old app files.
      const sw = readFileSync("src/sw.js", "utf8").replace("__BUILD__", Date.now().toString(36)).replace("__OCR__", OCR_DIR);
      this.emitFile({ type: "asset", fileName: "sw.js", source: sw });
    },
  };
}

// Relative base so the built site works at https://<user>.github.io/<repo>/ or any other path.
export default defineConfig({
  base: "./",
  plugins: [preact(), ocrFiles()],
  define: { __OCR_DIR__: JSON.stringify(OCR_DIR) },
  build: { outDir: "dist", emptyOutDir: true },
});
