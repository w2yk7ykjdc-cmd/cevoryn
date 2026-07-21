"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { handleUnauthorized } from "@/lib/client-auth";
import type { ConversationSummary } from "@/types";

async function fetchConversations(): Promise<ConversationSummary[]> {
  const response = await fetch("/api/conversations");
  if (handleUnauthorized(response)) return [];
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "Failed to load conversations");
  }
  const json = await response.json();
  return json.data;
}

export function useConversations() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }, [queryClient]);

  return {
    conversations: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    invalidate,
  };
}
