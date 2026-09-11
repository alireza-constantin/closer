"use client";

import { useEffect, useState } from "react";

import { encodeQrSvg } from "@/lib/qr-code";

export default function InviteQrCode({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setSvg(null);
    try {
      const nextSvg = encodeQrSvg(value);
      if (!disposed) setSvg(nextSvg);
    } catch {
      if (!disposed) setSvg(null);
    }

    return () => {
      disposed = true;
    };
  }, [value]);

  if (!svg) {
    return <div aria-label="Preparing QR code" className="closer-qr-placeholder" role="img" />;
  }

  return <div className="closer-qr-image" dangerouslySetInnerHTML={{ __html: svg }} />;
}
