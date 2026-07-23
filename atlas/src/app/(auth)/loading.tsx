import { Loader2 } from "lucide-react";

export default function AuthLoading() {
  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      <div>
        <p className="font-medium">Loading Atlas</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Preparing your secure sign-in experience.
        </p>
      </div>
    </div>
  );
}
