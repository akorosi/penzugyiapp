import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` → relatív asset-útvonalak, így a build kimenet bármilyen
// statikus tárhelyről (Flask, később S3 / CloudFront) változtatás nélkül
// kiszolgálható.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
