import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { closerManifest } from "./src/pwa/manifest.ts";
import { pwaCachePolicy } from "./src/pwa/cache-policy.ts";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon/favicon.svg", "favicon/apple-touch-icon.png"],
      manifest: closerManifest,
      workbox: pwaCachePolicy,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
});
