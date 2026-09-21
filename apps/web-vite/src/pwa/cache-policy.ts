export const pwaCachePolicy = {
  globPatterns: ["**/*.{html,js,css,ico,png,svg,woff2}"],
  navigateFallbackAllowlist: [/^\/(?!api(?:\/|$)|events(?:\/|$)).*/],
};
