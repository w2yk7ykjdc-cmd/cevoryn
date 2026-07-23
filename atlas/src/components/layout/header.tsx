"use client";

import { LogOut, Menu, User } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions/auth";
import type { MembershipContext } from "@/types";

import { ThemeToggle } from "./theme-toggle";

interface HeaderProps {
  membership: MembershipContext;
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
  userEmail,
  onMobileMenuToggle,
}: HeaderProps) {
  const [isPending, startTransition] = useTransition();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setIsUserMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleSignOut() {
    setIsUserMenuOpen(false);
    startTransition(async () => {
      await signOutAction();
    });
  }

  return (
    <header className="relative z-40 flex h-14 items-center justify-between border-b bg-card px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMobileMenuToggle}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="hidden lg:block" />

      <div className="flex items-center gap-1">
        <ThemeToggle />

        <div ref={userMenuRef} className="relative">
          <Button
            type="button"
            variant="ghost"
            className="relative h-9 w-9 rounded-full"
            aria-label="User menu"
            aria-haspopup="menu"
            aria-expanded={isUserMenuOpen}
            onClick={() => setIsUserMenuOpen((open) => !open)}
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs">
                {getInitials(membership.displayName)}
              </AvatarFallback>
            </Avatar>
          </Button>

          {isUserMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium leading-none">
                  {membership.displayName}
                </p>
                <p className="mt-1 text-xs leading-none text-muted-foreground">
                  {userEmail}
                </p>
              </div>

              <div className="my-1 h-px bg-muted" />

              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-not-allowed items-center rounded-sm px-2 py-1.5 text-left text-sm opacity-50"
                disabled
              >
                <User className="mr-2 h-4 w-4" />
                Profile
              </button>

              <div className="my-1 h-px bg-muted" />

              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={handleSignOut}
                disabled={isPending}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {isPending ? "Signing out..." : "Sign out"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
