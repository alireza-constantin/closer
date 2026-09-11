"use client";

import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth-client";

export default function AnonymousSession({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const hasStarted = useRef(false);

  useEffect(() => {
    if (session || isPending || hasStarted.current) return;
    hasStarted.current = true;
    void authClient.signIn.anonymous();
  }, [isPending, session]);

  if (!session) {
    return <p className="text-sm text-muted-foreground">Preparing your private guest session…</p>;
  }

  return <>{children}</>;
}
