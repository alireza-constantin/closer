import type { ManifestOptions } from "vite-plugin-pwa";

export const closerManifest: Partial<ManifestOptions> = {
  name: "Closer",
  short_name: "Closer",
  start_url: "/",
  display: "standalone",
  background_color: "#fffaf3",
  theme_color: "#fffaf3",
  icons: [
    {
      src: "/favicon/web-app-manifest-192x192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/favicon/web-app-manifest-512x512.png",
      sizes: "512x512",
      type: "image/png",
    },
  ],
};
