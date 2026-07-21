"use client";

import {
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/types";

import {
  deleteConversationAction,
  renameConversationAction,
} from "../actions/conversations";
import { useConversations } from "../hooks/use-conversations";

interface ChatSidebarProps {
  activeId?: string;
  onNavigate?: () => void;
}

export function ChatSidebar({ activeId, onNavigate }: ChatSidebarProps) {
  const router = useRouter();
  const { conversations, invalidate } = useConversations();
  const [isCreating, setIsCreating] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleNewConversation() {
    if (isCreating) return;

    setIsCreating(true);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.error?.message ?? "Failed to create conversation";
        toast.error(message);
        return;
      }

      const payload = await response.json();
      const conversationId = payload?.data?.id;

      if (typeof conversationId !== "string" || !conversationId) {
        toast.error("Conversation was created without a valid ID");
        return;
      }

      invalidate();
      onNavigate?.();
      router.replace(`/chat/${conversationId}`);
      router.refresh();
    } catch (error) {
      console.error("Create conversation error:", error);
      toast.error("Something went wrong while creating the conversation");
    } finally {
      setIsCreating(false);
    }
  }

  function handleSelect(id: string) {
    router.push(`/chat/${id}`);
    onNavigate?.();
  }

  function handleRename(conversation: ConversationSummary) {
    const newTitle = prompt("Rename conversation:", conversation.title);
    if (!newTitle?.trim()) return;

    startTransition(async () => {
      const result = await renameConversationAction({
        id: conversation.id,
        title: newTitle.trim(),
      });
      if (result.success) {
        invalidate();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;

    startTransition(async () => {
      const result = await deleteConversationAction({ id });
      if (result.success) {
        invalidate();
        if (activeId === id) {
          router.replace("/chat");
          router.refresh();
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          onClick={handleNewConversation}
          variant="outline"
          className="w-full justify-start gap-2"
          disabled={isPending || isCreating}
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-4 w-4" />
          )}
          {isCreating ? "Creating..." : "New conversation"}
        </Button>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Conversations">
        {conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No conversations yet
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeId}
                onSelect={() => handleSelect(conv.id)}
                onRename={() => handleRename(conv)}
                onDelete={() => handleDelete(conv.id)}
              />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className="group relative">
      <button
        onClick={onSelect}
        className={cn(
          "w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        {conversation.title}
      </button>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-0 transition-opacity hover:bg-accent",
              "group-hover:opacity-100",
              menuOpen && "opacity-100"
            )}
            aria-label="Conversation options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
