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

/**
 * Header-level billing control for the Romance shell. In-world framing
 * only (Product Bible's UX principles: never "subscription"/"billing" as
 * raw system vocabulary) - "Unlock Premium Voices" names the actual
 * payoff (audio narration), not the transaction. A real filled pill
 * button, not a plain underlined text link - this is the product's one
 * monetization CTA and needs to read as one, especially on mobile where
 * it's the first thing a non-Premium player can act on.
 */
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

  if (isPremium) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#c9a7e0]/40 bg-[#c9a7e0]/10 px-2.5 py-1 text-xs font-medium text-[#e4cdf2] transition hover:bg-[#c9a7e0]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0] disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="h-3 w-3" aria-hidden="true" />
        )}
        Premium
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-[#8a5cb8] to-[#5c3a73] px-2.5 py-1 text-xs font-medium text-white shadow-sm shadow-black/30 transition hover:from-[#9a6cc8] hover:to-[#6d4788] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0] disabled:opacity-60"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <Sparkles className="h-3 w-3" aria-hidden="true" />
      )}
      <span className="sm:hidden">Premium</span>
      <span className="hidden sm:inline">Unlock Premium Voices</span>
    </button>
  );
}
