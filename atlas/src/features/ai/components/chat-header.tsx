"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  Loader2,
  PanelLeftOpen,
  Pencil,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { resolveTitleSubmission } from "../lib/editable-title";

interface ChatHeaderProps {
  title: string;
  onToggleSidebar: () => void;
  onRename: (title: string) => Promise<boolean>;
  onArchive: () => Promise<void>;
  isMutating: boolean;
}

export function ChatHeader({
  title,
  onToggleSidebar,
  onRename,
  onArchive,
  isMutating,
}: ChatHeaderProps) {
  const t = useTranslations("chat");
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  async function saveTitle() {
    const submission = resolveTitleSubmission(draftTitle, title);
    if (!submission.shouldSubmit) {
      setDraftTitle(title);
      setIsEditing(false);
      return;
    }

    const saved = await onRename(submission.nextTitle);
    if (saved) setIsEditing(false);
  }

  function cancelEditing() {
    setDraftTitle(title);
    setIsEditing(false);
  }

  return (
    <div className="flex h-12 items-center gap-2 border-b px-3">
      <Link href="/dashboard" className="lg:hidden">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">{t("backToDashboard")}</span>
        </Button>
      </Link>

      <Button
        variant="ghost"
        size="icon"
        className="hidden h-8 w-8 lg:flex"
        onClick={onToggleSidebar}
      >
        <PanelLeftOpen className="h-4 w-4" />
        <span className="sr-only">{t("toggleConversations")}</span>
      </Button>

      {isEditing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveTitle();
              if (event.key === "Escape") cancelEditing();
            }}
            className="h-8"
            maxLength={120}
            autoFocus
            disabled={isMutating}
            aria-label={t("conversationTitleLabel")}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => void saveTitle()}
            disabled={isMutating}
          >
            {isMutating ? (
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
            onClick={cancelEditing}
            disabled={isMutating}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("cancelEditing")}</span>
          </Button>
        </div>
      ) : (
        <>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setIsEditing(true)}
            disabled={isMutating}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">{t("renameConversation")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => void onArchive()}
            disabled={isMutating}
          >
            {isMutating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            <span className="sr-only">{t("archiveConversation")}</span>
          </Button>
        </>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 lg:hidden"
        onClick={onToggleSidebar}
      >
        <PanelLeftOpen className="h-4 w-4" />
        <span className="sr-only">{t("conversations")}</span>
      </Button>
    </div>
  );
}
