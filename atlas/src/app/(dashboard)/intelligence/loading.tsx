import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function IntelligenceLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8" aria-busy="true">
      <div className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((item) => (
          <Card key={item}>
            <CardContent className="space-y-2 p-4">
              <div className="h-7 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-28 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>

      {[0, 1, 2].map((item) => (
        <Card key={item}>
          <CardHeader className="space-y-2">
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
