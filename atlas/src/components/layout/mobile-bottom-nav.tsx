"use client";

import {
  Activity,
  LayoutDashboard,
  Newspaper,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Brief", href: "/brief", icon: Newspaper },
  { label: "Atlas", href: "/chat", icon: Sparkles, primary: true },
  { label: "Health", href: "/health", icon: Activity },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 items-end gap-1">
        {ITEMS.map((item, index) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const isPrimary = "primary" in item && item.primary;

          if (isPrimary) {
            return (
              <Link
                key={`${item.href}-${index}`}
                href={item.href}
                aria-label="Open Atlas"
                className="-mt-6 flex flex-col items-center gap-1 text-xs font-medium"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[10px]">Atlas</span>
              </Link>
            );
          }

          return (
            <Link
              key={`${item.href}-${index}`}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
