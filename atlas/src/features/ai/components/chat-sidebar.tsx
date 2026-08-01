"use client";

import {
  Check,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  const t = useTranslations("chat");
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
          payload?.error?.message ?? t("conversationCreateFailed");
        toast.error(message);
        return;
      }

      const payload = await response.json();
      const conversationId = payload?.data?.id;

      if (typeof conversationId !== "string" || !conversationId) {
        toast.error(t("conversationInvalidId"));
        return;
      }

      invalidate();
      onNavigate?.();
      router.replace(`/chat/${conversationId}`);
      router.refresh();
    } catch (error) {
      console.error("Create conversation error:", error);
      toast.error(t("conversationCreateError"));
    } finally {
      setIsCreating(false);
    }
  }

  function handleSelect(id: string) {
    router.push(`/chat/${id}`);
    onNavigate?.();
  }

  async function handleRename(
    conversation: ConversationSummary,
    newTitle: string
  ): Promise<boolean> {
    const result = await renameConversationAction({
      id: conversation.id,
      title: newTitle,
    });

    if (result.success) {
      invalidate();
      return true;
    }

    toast.error(result.error);
    return false;
  }

  function handleDelete(id: string) {
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
          {isCreating ? t("creating") : t("newConversation")}
        </Button>
      </div>

      <Separator />

      <nav
        className="flex-1 overflow-y-auto p-2"
        aria-label={t("conversations")}
      >
        {conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("noConversations")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeId}
                isMutating={isPending}
                onSelect={() => handleSelect(conv.id)}
                onRename={(newTitle) => handleRename(conv, newTitle)}
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
  isMutating,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useTranslations("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function startRenaming() {
    setDraftTitle(conversation.title);
    setIsRenaming(true);
  }

  function cancelRenaming() {
    setDraftTitle(conversation.title);
    setIsRenaming(false);
  }

  async function saveRename() {
    const nextTitle = draftTitle.trim();
    if (!nextTitle || nextTitle === conversation.title) {
      setDraftTitle(conversation.title);
      setIsRenaming(false);
      return;
    }

    setIsSaving(true);
    const saved = await onRename(nextTitle);
    setIsSaving(false);
    if (saved) setIsRenaming(false);
  }

  if (isRenaming) {
    return (
      <li className="flex items-center gap-1 px-1 py-0.5">
        <Input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveRename();
            if (event.key === "Escape") cancelRenaming();
          }}
          className="h-8"
          maxLength={120}
          autoFocus
          disabled={isSaving}
          aria-label={t("conversationTitleLabel")}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void saveRename()}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          <span className="sr-only">{t("saveTitle")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={cancelRenaming}
          disabled={isSaving}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{t("cancelEditing")}</span>
        </Button>
      </li>
    );
  }

  if (confirmingDelete) {
    return (
      <li className="space-y-2 rounded-lg border p-2">
        <p className="text-xs text-muted-foreground">{t("deleteConfirm")}</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={onDelete}
            disabled={isMutating}
          >
            {isMutating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("delete")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmingDelete(false)}
            disabled={isMutating}
          >
            {t("cancelEditing")}
          </Button>
        </div>
      </li>
    );
  }

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
            aria-label={t("conversationOptions")}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={startRenaming}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setConfirmingDelete(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
