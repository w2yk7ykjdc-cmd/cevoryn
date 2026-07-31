import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-20">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  );
}
