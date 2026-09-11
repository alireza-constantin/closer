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
    return <div aria-label="Preparing QR code" className="block size-[min(224px,62vw)] rounded-lg bg-[repeating-linear-gradient(45deg,#f2f0f5_0_8px,#e9e6ed_8px_16px)]" role="img" />;
  }

  return <div className="block size-[min(224px,62vw)] [&_svg]:block [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
