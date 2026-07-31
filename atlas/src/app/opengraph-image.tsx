import { ImageResponse } from "next/og";

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
            d="M22 72 L50 28 L78 72"
            fill="none"
            stroke="#60a5fa"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
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
