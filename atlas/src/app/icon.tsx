import { ImageResponse } from "next/og";

import {
  BRAND_MARK_NODE,
  BRAND_MARK_RING_PATH,
  BRAND_MARK_RING_STROKE_WIDTH,
} from "@/lib/brand-mark";

export const size = {
  width: 32,
  height: 32,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#0f1729",
        borderRadius: 8,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 100 100">
        <path
          d={BRAND_MARK_RING_PATH}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={BRAND_MARK_RING_STROKE_WIDTH}
          strokeLinecap="round"
        />
        <circle
          cx={BRAND_MARK_NODE.cx}
          cy={BRAND_MARK_NODE.cy}
          r={BRAND_MARK_NODE.r}
          fill="#60a5fa"
        />
      </svg>
    </div>,
    size
  );
}
