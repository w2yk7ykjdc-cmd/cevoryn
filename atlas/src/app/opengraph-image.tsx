import { ImageResponse } from "next/og";

export const alt = "CEVORYN — AI Chief of Staff for small teams";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #08101f 0%, #0f1b33 55%, #172554 100%)",
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
          <div
            style={{
              alignItems: "center",
              border: "3px solid #60a5fa",
              borderRadius: "24px",
              display: "flex",
              fontSize: 52,
              fontWeight: 700,
              height: 112,
              justifyContent: "center",
              marginBottom: 38,
              width: 112,
            }}
          >
            C
          </div>
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
      </div>
    ),
    size
  );
}
