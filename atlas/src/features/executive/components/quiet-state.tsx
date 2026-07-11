import { CheckCircle2, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface QuietStateProps {
  message: string;
  resolvedRecently: number;
  memoryCount: number;
}

export function QuietState({
  message,
  resolvedRecently,
  memoryCount,
}: QuietStateProps) {
  return (
    <Card className="border-emerald-200 dark:border-emerald-900/50">
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
          <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="text-lg font-medium">{message}</p>
          <div className="mt-3 flex flex-col items-center gap-1 text-sm text-muted-foreground">
            {resolvedRecently > 0 && (
              <p className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />
                {resolvedRecently} issue{resolvedRecently === 1 ? "" : "s"} resolved this week
              </p>
            )}
            {memoryCount > 0 && (
              <p>{memoryCount} company memories stored</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
