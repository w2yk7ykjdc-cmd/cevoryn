"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { reseedRomanceContentAction } from "../actions/reseed-content";

export function ReseedButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const result = await reseedRomanceContentAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Reloaded "${result.data.universeName}" (${result.data.beatCount} beats).`
      );
      router.refresh();
    } catch {
      toast.error("Something went wrong reloading content.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={isPending}>
      {isPending && <Loader2 className="animate-spin" />}
      Reload story content
    </Button>
  );
}
