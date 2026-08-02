import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getAppHost } from "@/lib/canonical-origin";

// Reached on custom domains too (proxy.ts leaves /robots.txt unrewritten),
// so the sitemap link must point back at whichever host served this
// request rather than always the platform's own domain.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host")?.split(":")[0] ?? getAppHost() ?? "";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/login", "/api"],
      },
    ],
    sitemap: `https://${host}/sitemap.xml`,
  };
}
