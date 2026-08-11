import {
  BRAND_MARK_NODE,
  BRAND_MARK_RING_PATH,
  BRAND_MARK_RING_STROKE_WIDTH,
  BRAND_MARK_VIEWBOX,
} from "@/lib/brand-mark";

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** The Cevoryn brand mark alone, no wordmark. Inherits color via currentColor. */
export function LogoMark({ size = 20, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={BRAND_MARK_VIEWBOX}
      className={className}
      aria-hidden="true"
    >
      <path
        d={BRAND_MARK_RING_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={BRAND_MARK_RING_STROKE_WIDTH}
        strokeLinecap="round"
      />
      <circle
        cx={BRAND_MARK_NODE.cx}
        cy={BRAND_MARK_NODE.cy}
        r={BRAND_MARK_NODE.r}
        fill="currentColor"
      />
    </svg>
  );
}
