"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type {
  MembershipContext,
  OrganizationMembershipOption,
} from "@/types";

import { OrganizationSwitcher } from "./organization-switcher";
import { ThemeToggle } from "./theme-toggle";

interface HeaderProps {
  membership: MembershipContext;
  memberships: OrganizationMembershipOption[];
  userEmail: string;
  onMobileMenuToggle: () => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Header({
  membership,
  memberships,
  onMobileMenuToggle,
}: HeaderProps) {
  return (
    <header className="relative z-[100] isolate flex h-14 shrink-0 items-center justify-between overflow-visible border-b bg-card px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="relative z-[110] lg:hidden"
        onClick={onMobileMenuToggle}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="min-w-0 flex-1 px-2 lg:flex-none lg:px-0">
        <OrganizationSwitcher
          activeOrganizationId={membership.organizationId}
          memberships={memberships}
        />
      </div>

      <div className="relative z-[110] flex items-center gap-2 pr-1">
        <Link
          href="/profile"
          aria-label="Open profile"
          className="pointer-events-auto relative z-[130] inline-flex h-11 min-w-11 touch-manipulation select-none items-center justify-center rounded-full border border-border bg-background px-3 text-sm font-semibold shadow-sm active:scale-95"
        >
          {getInitials(membership.displayName)}
        </Link>

        <ThemeToggle />
      </div>
    </header>
  );
}
