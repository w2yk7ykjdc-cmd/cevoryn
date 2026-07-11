"use client";

import { Loader2, MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function NewChatRedirect() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    setIsCreating(true);
    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to create conversation");
        return;
      }
      const json = await res.json();
      router.push(`/chat/${json.data.id}`);
    } catch (_error) {
      toast.error("Something went wrong");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Button onClick={handleCreate} disabled={isCreating}>
      {isCreating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageSquarePlus className="h-4 w-4" />
      )}
      Start a conversation
    </Button>
  );
}
