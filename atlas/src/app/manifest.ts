import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas — AI Chief of Staff",
    short_name: "Atlas",
    description: "AI Chief of Staff for small teams",
    start_url: "/",
    display: "standalone",
    background_color: "#08101f",
    theme_color: "#0f1729",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
