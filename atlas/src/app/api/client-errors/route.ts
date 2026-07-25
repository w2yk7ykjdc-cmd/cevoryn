import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_REPORT_BYTES = 4_096;

const clientErrorSchema = z.object({
  boundary: z.enum(["route", "global"]),
  name: z.string().max(80).optional(),
  message: z.string().max(500).optional(),
  digest: z.string().max(160).optional(),
  path: z.string().max(300).optional(),
  occurredAt: z.string().datetime().optional(),
});

function isSameOriginBrowserRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function invalidReportResponse(status = 400) {
  return NextResponse.json(
    { error: { code: "INVALID_ERROR_REPORT", message: "Invalid error report" } },
    { status }
  );
}

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) {
    return invalidReportResponse(403);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return invalidReportResponse(415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPORT_BYTES) {
    return invalidReportResponse(413);
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REPORT_BYTES) {
      return invalidReportResponse(413);
    }

    const body: unknown = JSON.parse(rawBody);
    const result = clientErrorSchema.safeParse(body);

    if (!result.success) {
      return invalidReportResponse();
    }

    console.error("[cevoryn] client_error", {
      ...result.data,
      receivedAt: new Date().toISOString(),
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return invalidReportResponse();
  }
}
