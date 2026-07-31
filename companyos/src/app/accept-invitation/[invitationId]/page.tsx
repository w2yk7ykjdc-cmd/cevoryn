import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { AcceptInvitationCard } from "@/app/accept-invitation/[invitationId]/accept-invitation-card";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/login?redirect=/accept-invitation/${invitationId}`);
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <AcceptInvitationCard invitationId={invitationId} />
    </div>
  );
}
