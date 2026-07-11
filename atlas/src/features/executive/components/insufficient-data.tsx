import { Database, MessageSquare } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface InsufficientDataProps {
  reasons: string[];
}

export function InsufficientData({ reasons }: InsufficientDataProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Database className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="text-lg font-medium">
            Atlas needs more context
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Before Atlas can identify reliable priorities, it needs to learn about your business.
          </p>
        </div>

        {reasons.length > 0 && (
          <div className="w-full max-w-sm text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              What would help
            </p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link href="/chat">
          <Button className="mt-2">
            <MessageSquare className="h-4 w-4" />
            Start a conversation
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
