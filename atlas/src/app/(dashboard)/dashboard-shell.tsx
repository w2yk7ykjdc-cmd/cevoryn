"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import type { MembershipContext } from "@/types";

interface DashboardShellProps {
  membership: MembershipContext;
  userEmail: string;
  children: ReactNode;
}

export function DashboardShell({
  membership,
  userEmail,
  children,
}: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar membership={membership} />
      </div>

      {/* Mobile sidebar */}
      <MobileNav
        membership={membership}
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          membership={membership}
          userEmail={userEmail}
          onMobileMenuToggle={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
