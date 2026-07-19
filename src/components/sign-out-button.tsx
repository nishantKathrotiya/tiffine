"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    await apiPost("/api/auth/signout", {});
    // Full load so the cleared cookie is reflected everywhere at once.
    window.location.assign("/signin");
  }

  return (
    <Button
      variant="ghost"
      size={compact ? "sm" : "md"}
      onClick={handleSignOut}
      isLoading={isSigningOut}
      fullWidth={!compact}
      className={compact ? undefined : "justify-start"}
    >
      <LogOut className="size-4" aria-hidden />
      {compact ? <span className="sr-only">Sign out</span> : "Sign out"}
    </Button>
  );
}
