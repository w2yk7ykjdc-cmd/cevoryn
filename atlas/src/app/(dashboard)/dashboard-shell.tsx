"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Header } from "@/components/layout/header";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { cn } from "@/lib/utils";
import type { MembershipContext, OrganizationMembershipOption } from "@/types";

interface DashboardShellProps {
  membership: MembershipContext;
  memberships: OrganizationMembershipOption[];
  userEmail: string;
  children: ReactNode;
}

export function DashboardShell({
  membership,
  memberships,
  userEmail,
  children,
}: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateKeyboardState = () => {
      const coveredHeight =
        window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboardOpen(coveredHeight > 120);
    };

    updateKeyboardState();
    viewport.addEventListener("resize", updateKeyboardState);
    viewport.addEventListener("scroll", updateKeyboardState);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardState);
      viewport.removeEventListener("scroll", updateKeyboardState);
    };
  }, []);

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden">
      <div className="hidden lg:flex">
        <Sidebar membership={membership} />
      </div>

      <MobileNav
        membership={membership}
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Header
          membership={membership}
          memberships={memberships}
          userEmail={userEmail}
          onMobileMenuToggle={() => setMobileNavOpen(true)}
        />
        <main
          className={cn(
            "min-h-0 flex-1 overflow-y-auto p-4 lg:p-6",
            keyboardOpen ? "pb-4" : "pb-28"
          )}
        >
          {children}
        </main>
      </div>

      {!keyboardOpen && <MobileBottomNav />}
    </div>
  );
}
