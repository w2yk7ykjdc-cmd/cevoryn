import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/session";
import { getContact } from "@/server/contacts/service";
import { listCompanies } from "@/server/companies/service";
import { ContactDetail } from "@/app/(dashboard)/dashboard/contacts/[id]/contact-detail";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organization } = await requirePermission({ contact: ["read"] });

  const [contact, { companies }] = await Promise.all([
    getContact(organization.id, id),
    listCompanies({ organizationId: organization.id, limit: 200 }),
  ]);

  if (!contact) {
    notFound();
  }

  return (
    <ContactDetail
      contact={contact}
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
