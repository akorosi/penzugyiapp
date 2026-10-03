import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Az /api hívások proxy célja fejlesztéskor: alapból a helyi Flask, de a
// felhős telepítés is megadható (VITE_API_PROXY=https://xxxx.cloudfront.net).
const apiProxy = process.env.VITE_API_PROXY ?? "http://localhost:5000";

// `base: "./"` → relatív asset-útvonalak, így a build kimenet bármilyen
// statikus tárhelyről (Flask, később S3 / CloudFront) változtatás nélkül
// kiszolgálható.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiProxy, changeOrigin: true, secure: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
