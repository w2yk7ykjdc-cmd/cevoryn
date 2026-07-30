import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function recordPageView(pageId: string, locale: string) {
  const h = await headers();
  const referrer = h.get("referer");

  await prisma.pageView.create({
    data: { pageId, locale, referrer },
  });
}
