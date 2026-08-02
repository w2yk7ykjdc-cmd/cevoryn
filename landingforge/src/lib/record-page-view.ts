import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// Analytics is a side effect of serving the page, not a precondition for
// it - a transient DB error here must never turn into a 500 for a real
// visitor of a customer's published page.
export async function recordPageView(pageId: string, locale: string) {
  try {
    const h = await headers();
    const referrer = h.get("referer");

    await prisma.pageView.create({
      data: { pageId, locale, referrer },
    });
  } catch (e) {
    console.error("[recordPageView] failed to record page view", e);
  }
}
