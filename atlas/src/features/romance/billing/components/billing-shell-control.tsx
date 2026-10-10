"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface BillingResponse {
  url?: string;
  error?: string;
}

async function startFlow(path: string): Promise<BillingResponse> {
  const response = await fetch(path, { method: "POST" });
  return (await response.json()) as BillingResponse;
}

export function BillingShellControl({ isPremium }: { isPremium: boolean }) {
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);
    try {
      const result = await startFlow(
        isPremium ? "/api/romance/billing/portal" : "/api/romance/billing/checkout"
      );
      if (!result.url) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      window.location.href = result.url;
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  const label = isPremium ? "Premium" : "Unlock Premium";
  const compactLabel = isPremium ? "Premium" : "Upgrade";
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2.5 py-2 text-[0.7rem] font-semibold text-white shadow-[0_5px_16px_rgba(185,54,89,0.18)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd4968] disabled:opacity-60 sm:gap-1.5 sm:px-4 sm:text-xs ${isPremium ? "bg-[#8f5367] hover:bg-[#794456]" : "bg-gradient-to-r from-[#d75f7b] to-[#ad2e53] hover:from-[#c84e6b] hover:to-[#982647]"}`}
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
      <span className="sm:hidden">{isPending ? "Wait" : compactLabel}</span>
      <span className="hidden sm:inline">{isPending ? "Opening…" : label}</span>
    </button>
  );
}
