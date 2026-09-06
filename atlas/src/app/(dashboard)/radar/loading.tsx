import { Card, CardContent } from "@/components/ui/card";

export default function RadarLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-16 w-full animate-pulse rounded-lg bg-muted/60" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
