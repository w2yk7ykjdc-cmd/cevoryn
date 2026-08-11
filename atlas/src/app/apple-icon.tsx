import { ImageResponse } from "next/og";

import {
  BRAND_MARK_NODE,
  BRAND_MARK_RING_PATH,
  BRAND_MARK_RING_STROKE_WIDTH,
} from "@/lib/brand-mark";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(145deg, #08101f 0%, #172554 100%)",
        color: "#ffffff",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <svg width="120" height="120" viewBox="0 0 100 100">
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
