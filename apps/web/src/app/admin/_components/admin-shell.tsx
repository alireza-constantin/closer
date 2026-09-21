import Link from "next/link";
import type { ReactNode } from "react";

import { CloserWordmark } from "@/components/closer/page-shell";

import { AdminLogoutButton } from "./admin-logout-button";
import { AdminMobileNav } from "./admin-mobile-nav";
import { AdminNavIcon, adminNavItems, type AdminSection } from "./admin-nav";

export function AdminShell({
  activeSection,
  children,
  userName,
  userEmail,
}: {
  activeSection: AdminSection;
  children: ReactNode;
  userName?: string | null;
  userEmail: string;
}) {
  return (
    <div className="bg-closer-cream text-closer-navy min-h-svh min-w-0 lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <a
        className="focus:bg-closer-navy focus-visible:ring-closer-coral sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:px-4 focus:py-3 focus:text-white focus-visible:ring-2 focus-visible:outline-none"
        href="#admin-main"
      >
        Skip to main content
      </a>
      <aside className="border-closer-navy/10 hidden flex-col border-b bg-white/65 px-4 py-4 lg:flex lg:min-h-svh lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="flex flex-col gap-3 lg:items-stretch">
          <div className="flex items-center gap-2.5 px-2 lg:px-3">
            <span
              aria-hidden="true"
              className="bg-closer-coral-soft grid size-10 place-items-center rounded-2xl"
            >
              <span className="text-closer-coral text-lg" aria-hidden="true">
                ♥
              </span>
            </span>
            <div>
              <CloserWordmark />
              <p className="text-closer-muted -mt-1 text-xs font-semibold">Admin</p>
            </div>
          </div>
          <p className="text-closer-muted hidden px-3 pt-4 text-xs leading-relaxed lg:block">
            Curated questions. Deeper conversations.
          </p>
          <nav
            aria-label="Admin"
            className="flex items-center gap-1 lg:mt-7 lg:flex-col lg:items-stretch"
          >
            {adminNavItems.map(({ href, label, section, icon }) => {
              const active = activeSection === section;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`focus-visible:ring-closer-navy flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none ${active ? "bg-closer-coral-soft text-closer-navy" : "text-closer-navy/75 hover:bg-closer-cream"}`}
                  href={href}
                  key={section}
                >
                  <AdminNavIcon icon={icon} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-closer-navy/10 mt-auto hidden border-t pt-4 lg:block">
          <div className="flex items-center gap-3 px-2">
            <span
              aria-hidden="true"
              className="bg-closer-blue text-closer-navy grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold"
            >
              {(userName?.trim()[0] || userEmail[0] || "A").toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold">{userName?.trim() || "Admin"}</p>
              <p className="text-closer-muted truncate text-xs">{userEmail}</p>
            </div>
          </div>
          <div className="mt-3 px-2">
            <AdminLogoutButton />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-closer-navy/10 flex min-h-[58px] items-center justify-between gap-3 border-b bg-white/40 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lg:hidden">
              <AdminMobileNav
                activeSection={activeSection}
                userEmail={userEmail}
                userName={userName}
              />
            </div>
            <p className="text-closer-muted min-w-0 text-xs font-semibold">
              Closer Admin · Editorial workspace
            </p>
          </div>
          <p className="text-closer-coral hidden text-right text-xs font-extrabold sm:block">
            Better conversations, every day <span aria-hidden="true">♥</span>
          </p>
        </header>
        <main
          className="mx-auto max-w-[1600px] min-w-0 px-4 py-5 sm:px-6 md:py-7 lg:px-8 lg:py-8"
          id="admin-main"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
