"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@Closer/ui/components/button";
import { cn } from "@Closer/ui/lib/utils";

function BackLinkStatus({ label }: { label: string }) {
  const { pending } = useLinkStatus();

  return (
    <>
      <ArrowLeft aria-hidden="true" className={pending ? "animate-pulse" : undefined} data-icon="inline-start" />
      <span className={label === "Back" || pending ? undefined : "sr-only"}>{pending ? "Opening…" : label}</span>
    </>
  );
}

export function CloserBackLink({ href, label = "Back" }: { href: string; label?: string }) {
  return (
    <Link
      aria-label={label === "Back" ? undefined : label}
      className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "w-fit px-2")}
      href={href as never}
    >
      <BackLinkStatus label={label} />
    </Link>
  );
}

export function CloserModeCard({
  href,
  kind,
  icon,
  title,
  description,
  className,
  prefetch,
}: {
  href: string;
  kind: "together" | "private";
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
  prefetch?: boolean;
}) {
  return (
    <Link
      className={cn(
        "group grid min-h-[88px] grid-cols-[58px_1fr_auto] items-center gap-[13px] rounded-3xl px-4 py-3.5 text-closer-navy no-underline shadow-closer-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_29px_rgba(27,33,78,0.11)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-closer-navy focus-visible:ring-offset-2 focus-visible:ring-offset-closer-cream",
        kind === "together" ? "bg-closer-peach" : "bg-closer-lavender-soft",
        className,
      )}
      href={href as never}
      prefetch={prefetch}
    >
      <span className="grid size-14 place-items-center rounded-[1.25rem] bg-white/60 [&_svg]:size-7">{icon}</span>
      <span className="min-w-0"><strong className="block text-[1.05rem] font-extrabold tracking-[-.025em]">{title}</strong><small className="mt-0.5 block max-w-[22ch] text-[.82rem] leading-tight text-closer-navy/75">{description}</small></span>
      <ChevronRight aria-hidden="true" className="size-5 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}
