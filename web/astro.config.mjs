// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Situs statis: FastAPI menyajikan dist/ (index.html, login.html, offline.html, _astro/*).
export default defineConfig({
  output: "static",
  build: { format: "file", inlineStylesheets: "never" },
  vite: {
    plugins: [tailwindcss()],
    // mode dev: teruskan API ke FastAPI lokal (uvicorn --port 8765). changeOrigin: false menjaga header Host
    // tetap localhost:4321, sehingga cek Origin (anti-CSRF) di server tidak menolak request dari dev server.
    server: { proxy: { "/api": { target: "http://localhost:8765", changeOrigin: false } } },
  },
});
