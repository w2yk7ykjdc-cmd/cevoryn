"use client";

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
 * payoff (audio narration), not the transaction.
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
        className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 text-[#c9a7e0] underline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
      >
        ✦ Premium
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 underline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
    >
      <span className="sm:hidden">Premium</span>
      <span className="hidden sm:inline">Unlock Premium Voices</span>
    </button>
  );
}
