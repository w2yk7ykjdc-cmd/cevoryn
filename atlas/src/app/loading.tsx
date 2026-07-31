import { Loader2 } from "lucide-react";

export default function GlobalLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading CEVORYN...</p>
    </div>
  );
}
