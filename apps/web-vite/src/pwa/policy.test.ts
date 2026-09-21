import { describe, expect, test } from "bun:test";

import { pwaCachePolicy } from "@/pwa/cache-policy";
import { closerManifest } from "@/pwa/manifest";

describe("PWA shell policy", () => {
  test("starts at the app root and references the reused install icons", () => {
    expect(closerManifest.start_url).toBe("/");
    expect(closerManifest.icons?.map((icon) => icon.src)).toEqual([
      "/favicon/web-app-manifest-192x192.png",
      "/favicon/web-app-manifest-512x512.png",
    ]);
  });

  test("pre-caches only static assets and keeps API and event paths off the app-shell fallback", () => {
    expect(pwaCachePolicy.globPatterns).toEqual(["**/*.{html,js,css,ico,png,svg,woff2}"]);

    const [navigationAllowlist] = pwaCachePolicy.navigateFallbackAllowlist;
    expect(navigationAllowlist?.test("/")).toBe(true);
    expect(navigationAllowlist?.test("/pair/space-123")).toBe(true);
    expect(navigationAllowlist?.test("/api/v1/me")).toBe(false);
    expect(navigationAllowlist?.test("/events")).toBe(false);
  });
});
