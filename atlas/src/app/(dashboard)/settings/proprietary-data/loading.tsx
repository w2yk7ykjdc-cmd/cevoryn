import { Card, CardContent } from "@/components/ui/card";

export default function ProprietaryDataLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2 p-3">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
