"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";

import { Button } from "@Closer/ui/components/button";

import { adminAuthClient } from "../_lib/admin-auth-client";

export function AdminLogoutButton() {
  const router = useRouter();

  async function onLogout() {
    const result = await adminAuthClient.signOut();
    if (!result.error) {
      router.replace("/admin/login" as Route);
      router.refresh();
    }
  }

  return (
    <Button onClick={onLogout} type="button" variant="outline">
      Sign out
    </Button>
  );
}
