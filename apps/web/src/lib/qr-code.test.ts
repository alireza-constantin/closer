import { describe, expect, test } from "bun:test";

import { encodeQrSvg } from "./qr-code";

describe("invite QR encoding", () => {
  test("encodes the full opaque join URL in a mobile-sized QR SVG", () => {
    const url = "https://closer.example/rejoin/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    const svg = encodeQrSvg(url);

    expect(svg).toContain('viewBox="0 0 49 49"');
    expect(svg).toContain("shape-rendering=\"crispEdges\"");
    expect(svg.match(/M/g)?.length ?? 0).toBeGreaterThan(100);
  });

  test("rejects payloads that exceed the bounded invite profile", () => {
    expect(() => encodeQrSvg("https://closer.example/join/" + "x".repeat(100))).toThrow("QR_PAYLOAD_TOO_LONG");
  });
});
