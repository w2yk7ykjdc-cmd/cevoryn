import { Loader2, MessageSquare } from "lucide-react";

export default function ChatLoading() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="h-7 w-7 text-muted-foreground" />
        <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin rounded-full bg-background p-0.5 text-muted-foreground" />
      </div>

      <div>
        <p className="font-medium">Opening conversation</p>
        <p className="mt-1 text-sm text-muted-foreground">
          CEVORYN is loading your messages and workspace context.
        </p>
      </div>
    </div>
  );
}
