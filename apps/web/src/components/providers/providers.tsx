"use client";

import { Toaster } from "@Closer/ui/components/sonner";

import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
        <Toaster richColors />
      </ThemeProvider>
    </QueryProvider>
  );
}
