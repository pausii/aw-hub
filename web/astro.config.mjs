// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// ID unik per build: ditanam ke kode (__BUILD_ID__), ditulis ke dist/version.json, dan dipakai sebagai nama cache
// service worker. Dashboard membandingkannya untuk menampilkan "versi baru tersedia".
const BUILD_ID = process.env.AW_HUB_BUILD_ID || new Date().toISOString().replace(/\D/g, "").slice(0, 14);

/** Setelah build: tulis version.json dan isi placeholder __BUILD_ID__ di sw.js.
 * @type {import("astro").AstroIntegration} */
const buildId = {
  name: "aw-hub-build-id",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const out = fileURLToPath(dir);
      await writeFile(`${out}/version.json`, JSON.stringify({ build: BUILD_ID }) + "\n");
      const sw = `${out}/sw.js`;
      await writeFile(sw, (await readFile(sw, "utf8")).replaceAll("__BUILD_ID__", BUILD_ID));
    },
  },
};

// Situs statis: FastAPI menyajikan dist/ (index.html, login.html, offline.html, _astro/*).
export default defineConfig({
  output: "static",
  build: { format: "file", inlineStylesheets: "never" },
  integrations: [buildId],
  vite: {
    plugins: [tailwindcss()],
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
    // mode dev: teruskan API ke FastAPI lokal (uvicorn --port 8765). changeOrigin: false menjaga header Host
    // tetap localhost:4321, sehingga cek Origin (anti-CSRF) di server tidak menolak request dari dev server.
    server: { proxy: { "/api": { target: "http://localhost:8765", changeOrigin: false } } },
  },
});
