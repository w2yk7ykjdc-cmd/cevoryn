import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function getAppHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").host;
  } catch {
    return undefined;
  }
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  const appHost = getAppHost();

  // Traffic arriving on a customer's own custom domain has no project slug
  // in its URL. Rewrite it to the domain-resolving route instead of the
  // Supabase session flow below - that route runs on the Node.js runtime
  // and can query Postgres directly, which this Edge middleware cannot.
  if (host && host !== appHost && !host.endsWith(".vercel.app") && host !== "localhost") {
    const url = request.nextUrl.clone();
    url.pathname = `/domain-view/${host}${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
