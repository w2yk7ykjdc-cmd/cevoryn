import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
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
        <div
          style={{
            alignItems: "center",
            border: "8px solid #60a5fa",
            borderRadius: 36,
            display: "flex",
            fontSize: 92,
            fontWeight: 800,
            height: 132,
            justifyContent: "center",
            width: 132,
          }}
        >
          A
        </div>
      </div>
    ),
    size
  );
}
