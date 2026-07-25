import { NextResponse } from "next/server";
import { z } from "zod";

const clientErrorSchema = z.object({
  boundary: z.enum(["route", "global"]),
  name: z.string().max(80).optional(),
  message: z.string().max(500).optional(),
  digest: z.string().max(160).optional(),
  path: z.string().max(300).optional(),
  occurredAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const result = clientErrorSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: { code: "INVALID_ERROR_REPORT", message: "Invalid error report" } },
        { status: 400 }
      );
    }

    console.error("[cevoryn] client_error", {
      ...result.data,
      receivedAt: new Date().toISOString(),
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_ERROR_REPORT", message: "Invalid error report" } },
      { status: 400 }
    );
  }
}
