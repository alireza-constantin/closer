import type { ReactNode } from "react";

export function ActionError({ children }: { children: ReactNode }) {
  return (
    <p className="text-closer-error mt-3 text-center text-[.9rem] leading-relaxed" role="alert">
      {children}
    </p>
  );
}

export function FormServerError({ children }: { children: ReactNode }) {
  return (
    <p className="text-closer-error mt-3 text-[.9rem] leading-relaxed" role="alert">
      {children}
    </p>
  );
}
