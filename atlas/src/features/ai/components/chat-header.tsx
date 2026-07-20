"use client";

import { ArrowLeft, PanelLeftOpen } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface ChatHeaderProps {
  title: string;
  onToggleSidebar: () => void;
}

export function ChatHeader({ title, onToggleSidebar }: ChatHeaderProps) {
  return (
    <div className="flex h-12 items-center gap-2 border-b px-3">
      {/* Mobile: back to dashboard */}
      <Link href="/dashboard" className="lg:hidden">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back to dashboard</span>
        </Button>
      </Link>

      {/* Desktop: toggle conversation panel */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden h-8 w-8 lg:flex"
        onClick={onToggleSidebar}
      >
        <PanelLeftOpen className="h-4 w-4" />
        <span className="sr-only">Toggle conversations</span>
      </Button>

      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>

      {/* Mobile: conversation list trigger */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 lg:hidden"
        onClick={onToggleSidebar}
      >
        <PanelLeftOpen className="h-4 w-4" />
        <span className="sr-only">Conversations</span>
      </Button>
    </div>
  );
}
