import { NextResponse } from "next/server";

import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  try {
    const user = await requireUser();
    const membership = await requireMembership(user.id);

    await prisma.googleConnection.deleteMany({
      where: {
        organizationId: membership.organizationId,
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[atlas:google] disconnect failed", error);
    return NextResponse.json(
      { error: "Google connection could not be removed" },
      { status: 500 }
    );
  }
}
