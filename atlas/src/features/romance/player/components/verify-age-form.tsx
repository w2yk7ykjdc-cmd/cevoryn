"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { verifyAdultAction } from "../actions/verify-age";

export function VerifyAgeForm() {
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    try {
      const result = await verifyAdultAction({ confirmedAdult: confirmed });
      if (!result.success) {
        toast.error(result.error);
      }
    } catch {
      // Server action redirect throws NEXT_REDIRECT - expected on success.
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md border-white/10 bg-[#1c1024]/80 text-[#f1e9f4]">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">Before you enter</CardTitle>
        <CardDescription className="text-[#c9b8d4]">
          This story contains mature themes, peril, and adult romantic content.
          It is intended for adults only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="flex items-start gap-3 text-sm text-[#e4d9ea]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent accent-[#c9a7e0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
              aria-describedby="age-confirm-description"
            />
            <span id="age-confirm-description">
              I confirm that I am 18 years of age or older.
            </span>
          </label>

          <Button
            type="submit"
            disabled={!confirmed || isPending}
            className="w-full bg-[#5c3a73] text-white hover:bg-[#6d4788]"
          >
            {isPending && <Loader2 className="animate-spin" />}
            Enter the story
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
