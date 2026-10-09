interface RelationshipBarsProps {
  characterName: string;
  dimensions: {
    trust: number;
    attraction: number;
    fear: number;
    loyalty: number;
    tension: number;
  };
}

const DIMENSION_LABELS: Array<{ key: keyof RelationshipBarsProps["dimensions"]; label: string }> = [
  { key: "trust", label: "Trust" },
  { key: "attraction", label: "Attraction" },
  { key: "loyalty", label: "Loyalty" },
  { key: "fear", label: "Fear" },
  { key: "tension", label: "Tension" },
];

/** Important relationship/context indicator - never exposes raw internal scores as "the" story truth, just a reader-facing sense of where things stand with this character. */
export function RelationshipBars({ characterName, dimensions }: RelationshipBarsProps) {
  return (
    <div
      className="rounded-lg border border-white/10 bg-[#1c1024]/60 p-3"
      role="group"
      aria-label={`Your relationship with ${characterName}`}
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a08bb0]">
        {characterName}
      </p>
      <div className="space-y-1.5">
        {DIMENSION_LABELS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2 text-xs text-[#c9b8d4]">
            <span className="w-16 shrink-0">{label}</span>
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuenow={dimensions[key]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${label} with ${characterName}`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8a5cb8] to-[#c9a7e0] transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, dimensions[key]))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
