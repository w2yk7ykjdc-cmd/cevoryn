import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const AUTHORIZED_EMAIL = "kiyakkemal34@gmail.com";

async function repairAtlasOrganizations() {
  "use server";

  const user = await requireUser();
  if (user.email.toLowerCase() !== AUTHORIZED_EMAIL) {
    throw new Error("Not authorized");
  }

  await prisma.$transaction(async (tx) => {
    const currentAtlas = await tx.organization.findFirst({
      where: {
        name: "Atlas",
        members: {
          some: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
      include: {
        members: true,
        _count: {
          select: {
            invites: true,
            conversations: true,
            usageRecords: true,
            memories: true,
            insights: true,
            pulseSnapshots: true,
            briefs: true,
            preparedActions: true,
            decisions: true,
            outcomeEvaluations: true,
            learningPatterns: true,
          },
        },
      },
    });

    const atlasDemo = await tx.organization.findFirst({
      where: { name: "Atlas Demo" },
      include: { members: true },
    });

    if (!currentAtlas || !atlasDemo) {
      throw new Error("Required organizations were not found");
    }

    const currentAtlasHasBusinessData = Object.values(currentAtlas._count).some(
      (count) => count > 0
    );

    if (currentAtlas.members.length !== 1 || currentAtlasHasBusinessData) {
      throw new Error(
        "Safety check failed: the current Atlas organization is not empty"
      );
    }

    const currentMember = currentAtlas.members[0];
    if (!currentMember || currentMember.userId !== user.id) {
      throw new Error("Safety check failed: unexpected Atlas owner");
    }

    await tx.member.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: atlasDemo.id,
        },
      },
      update: {
        role: "OWNER",
        displayName: currentMember.displayName,
        avatarUrl: currentMember.avatarUrl,
      },
      create: {
        userId: user.id,
        organizationId: atlasDemo.id,
        role: "OWNER",
        displayName: currentMember.displayName,
        avatarUrl: currentMember.avatarUrl,
      },
    });

    await tx.organization.delete({
      where: { id: currentAtlas.id },
    });

    await tx.organization.update({
      where: { id: atlasDemo.id },
      data: {
        name: "Atlas",
        slug: "atlas",
      },
    });
  });

  redirect("/team");
}

export default async function RepairAtlasPage() {
  const user = await requireUser();

  if (user.email.toLowerCase() !== AUTHORIZED_EMAIL) {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">One-time repair</p>
        <h1 className="text-3xl font-bold tracking-tight">Merge Atlas organizations</h1>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          This keeps the existing Atlas Demo data, adds this account as OWNER,
          removes the empty duplicate Atlas organization, and renames Atlas Demo
          to Atlas. The operation stops automatically if the duplicate Atlas
          contains any business data.
        </p>

        <form action={repairAtlasOrganizations} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground"
          >
            Repair and merge now
          </button>
        </form>
      </div>
    </div>
  );
}
