import { ImageResponse } from "next/og";

import {
  BRAND_MARK_NODE,
  BRAND_MARK_RING_PATH,
  BRAND_MARK_RING_STROKE_WIDTH,
} from "@/lib/brand-mark";

export const alt = "CEVORYN — AI Chief of Staff for small teams";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background:
          "linear-gradient(135deg, #08101f 0%, #0f1b33 55%, #172554 100%)",
        color: "white",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "72px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          textAlign: "center",
        }}
      >
        <svg
          width="96"
          height="96"
          viewBox="0 0 100 100"
          style={{ marginBottom: 38 }}
        >
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
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-3px" }}>
          CEVORYN
        </div>
        <div
          style={{
            color: "#bfdbfe",
            fontSize: 34,
            marginTop: 18,
          }}
        >
          AI Chief of Staff for small teams
        </div>
      </div>
    </div>,
    size
  );
}
