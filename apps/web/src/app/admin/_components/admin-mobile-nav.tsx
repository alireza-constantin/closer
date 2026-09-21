"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@Closer/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@Closer/ui/components/drawer";
import { Menu } from "lucide-react";

import { CloserWordmark } from "@/components/closer/page-shell";

import { AdminLogoutButton } from "./admin-logout-button";
import { AdminNavIcon, adminNavItems, type AdminSection } from "./admin-nav";

export function AdminMobileNav({
  activeSection,
  userName,
  userEmail,
}: {
  activeSection: AdminSection;
  userName?: string | null;
  userEmail: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen} swipeDirection="right">
      <DrawerTrigger
        render={
          <Button aria-label="Open Admin navigation" size="icon" type="button" variant="outline">
            <Menu aria-hidden="true" />
          </Button>
        }
      />
      <DrawerContent className="bg-closer-cream text-closer-navy [--drawer-content-width:min(22rem,calc(100vw-1rem))]">
        <DrawerHeader className="border-closer-navy/10 border-b p-5 text-left">
          <DrawerTitle className="text-closer-navy flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="bg-closer-coral-soft grid size-10 place-items-center rounded-2xl"
            >
              <span className="text-closer-coral text-lg" aria-hidden="true">
                ♥
              </span>
            </span>
            <span>
              <CloserWordmark />
              <span className="text-closer-muted -mt-1 block text-xs font-semibold">Admin</span>
            </span>
          </DrawerTitle>
          <DrawerDescription className="text-closer-muted mt-3 text-left text-sm">
            Curated questions. Deeper conversations.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <nav aria-label="Admin" className="flex flex-col gap-1">
            {adminNavItems.map(({ href, label, section, icon }) => {
              const active = activeSection === section;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`focus-visible:ring-closer-navy flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold focus-visible:ring-2 focus-visible:outline-none ${active ? "bg-closer-coral-soft text-closer-navy" : "text-closer-navy/75 hover:bg-white/70"}`}
                  href={href}
                  key={section}
                  onClick={() => setOpen(false)}
                >
                  <AdminNavIcon icon={icon} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <DrawerFooter className="border-closer-navy/10 border-t p-4">
          <div className="flex min-w-0 items-center gap-3">
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
          <AdminLogoutButton />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
