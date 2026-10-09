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

const DIMENSION_LABELS: Array<{
  key: keyof RelationshipBarsProps["dimensions"];
  label: string;
}> = [
  { key: "trust", label: "Trust" },
  { key: "attraction", label: "Attraction" },
  { key: "loyalty", label: "Loyalty" },
  { key: "fear", label: "Fear" },
  { key: "tension", label: "Tension" },
];

/** Important relationship/context indicator - never exposes raw internal scores as "the" story truth, just a reader-facing sense of where things stand with this character. */
export function RelationshipBars({
  characterName,
  dimensions,
}: RelationshipBarsProps) {
  return (
    <div role="group" aria-label={`Your relationship with ${characterName}`}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a34e79]">
        {characterName}
      </p>
      <div className="space-y-1.5">
        {DIMENSION_LABELS.map(({ key, label }) => (
          <div
            key={key}
            className="flex items-center gap-2 text-xs text-[#806d7d]"
          >
            <span className="w-16 shrink-0">{label}</span>
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f0e5eb]"
              role="progressbar"
              aria-valuenow={dimensions[key]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${label} with ${characterName}`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#d8a3bc] to-[#963f70] transition-[width] duration-500"
                style={{
                  width: `${Math.max(0, Math.min(100, dimensions[key]))}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
