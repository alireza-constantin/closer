import type { ReactNode } from "react";

export function ActionError({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-center text-[.9rem] leading-relaxed text-closer-error" role="alert">{children}</p>;
}

export function FormServerError({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[.9rem] leading-relaxed text-closer-error" role="alert">{children}</p>;
}
