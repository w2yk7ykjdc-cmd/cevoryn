"use client";

import {
  Activity,
  BarChart3,
  BrainCircuit,
  Building2,
  LayoutDashboard,
  MessageCircle,
  MessageSquare,
  Newspaper,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLanguage } from "@/components/language-provider";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { MembershipContext } from "@/types";

interface SidebarProps {
  membership: MembershipContext;
}

const NAV_ITEMS = [
  { labelKey: "home", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "brief", href: "/brief", icon: Newspaper },
  { labelKey: "intelligence", href: "/intelligence", icon: BrainCircuit },
  { labelKey: "health", href: "/health", icon: Activity },
  { labelKey: "chat", href: "/chat", icon: MessageSquare },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3, adminOnly: true },
  { labelKey: "team", href: "/team", icon: Users },
  { labelKey: "settings", href: "/settings", icon: Settings },
  { labelKey: "feedback", href: "/feedback", icon: MessageCircle },
] as const;

export function Sidebar({ membership }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const canViewAnalytics =
    membership.role === "OWNER" || membership.role === "ADMIN";

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {membership.organizationName}
          </span>
          <Badge variant="secondary" className="mt-0.5 w-fit text-[10px]">
            {membership.role}
          </Badge>
        </div>
      </div>

      <Separator />

      <nav
        className="flex-1 space-y-1 px-3 py-4"
        aria-label={t("mainNavigation")}
      >
        {NAV_ITEMS.filter(
          (item) => !("adminOnly" in item && item.adminOnly) || canViewAnalytics
        ).map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t px-3 py-3">
        <LanguageSelector />
        <ThemeToggle />
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <Link className="hover:text-foreground" href="/privacy">
            {t("privacy")}
          </Link>
          <Link className="hover:text-foreground" href="/terms">
            {t("terms")}
          </Link>
        </div>
        <p className="px-1 text-xs text-muted-foreground">Atlas RC3</p>
      </div>
    </aside>
  );
}
