export type MemoryKind = "fact" | "preference" | "summary";

export type MemoryRecord = {
  id: string;
  organizationId: string;
  userId: string | null;
  conversationId: string | null;
  kind: MemoryKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  /** Cosine distance to the query embedding, when returned from a search. */
  distance?: number;
};
