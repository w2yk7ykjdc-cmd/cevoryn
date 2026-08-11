"use client";

import {
  Activity,
  LayoutDashboard,
  Newspaper,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const ITEMS = [
  {
    labelKey: "home",
    href: "/dashboard",
    icon: LayoutDashboard,
    slotClass: "col-start-1",
  },
  {
    labelKey: "brief",
    href: "/brief",
    icon: Newspaper,
    slotClass: "col-start-2",
  },
  {
    // labelKey is unused for the primary item — its label is the
    // untranslated brand name, hardcoded directly in the JSX below.
    labelKey: "chat",
    href: "/chat",
    icon: Sparkles,
    primary: true,
    slotClass: "col-start-3",
  },
  {
    labelKey: "settings",
    href: "/settings",
    icon: Settings,
    slotClass: "col-start-4",
  },
  {
    labelKey: "health",
    href: "/health",
    icon: Activity,
    slotClass: "col-start-5",
  },
] as const;

const PREPARED_CHAT_KEY = "atlas-prepared-chat-href";

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");
  const [preparedChatHref, setPreparedChatHref] = useState("/chat");

  useEffect(() => {
    for (const item of ITEMS) {
      if (item.href !== pathname) router.prefetch(item.href);
    }
  }, [pathname, router]);

  useEffect(() => {
    if (pathname.startsWith("/chat")) return;

    const cached = window.sessionStorage.getItem(PREPARED_CHAT_KEY);
    if (cached) {
      setPreparedChatHref(cached);
      router.prefetch(cached);
      return;
    }

    let cancelled = false;

    void fetch("/api/conversations", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json().catch(() => null);
        const id = payload?.data?.id;
        return typeof id === "string" ? `/chat/${id}` : null;
      })
      .then((href) => {
        if (!href || cancelled) return;
        window.sessionStorage.setItem(PREPARED_CHAT_KEY, href);
        setPreparedChatHref(href);
        router.prefetch(href);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  function consumePreparedChat() {
    window.sessionStorage.removeItem(PREPARED_CHAT_KEY);
    setPreparedChatHref("/chat");
  }

  return (
    <nav
      aria-label="Mobile primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end gap-1">
        {ITEMS.map((item, index) => {
          const href = item.href === "/chat" ? preparedChatHref : item.href;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const isPrimary = "primary" in item && item.primary;

          if (isPrimary) {
            return (
              <Link
                key={`${item.href}-${index}`}
                href={href}
                prefetch
                onClick={consumePreparedChat}
                onTouchStart={() => router.prefetch(href)}
                onPointerEnter={() => router.prefetch(href)}
                aria-label="Open CEVORYN"
                className={cn(
                  "-mt-6 flex flex-col items-center gap-1 text-xs font-medium",
                  item.slotClass
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[10px]">CEVORYN</span>
              </Link>
            );
          }

          return (
            <Link
              key={`${item.href}-${index}`}
              href={href}
              prefetch
              onTouchStart={() => router.prefetch(href)}
              onPointerEnter={() => router.prefetch(href)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium transition-colors",
                item.slotClass,
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
