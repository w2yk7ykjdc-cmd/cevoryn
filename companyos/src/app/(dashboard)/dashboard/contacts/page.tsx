import Link from "next/link";
import { requirePermission } from "@/server/auth/session";
import { listContacts } from "@/server/contacts/service";
import { listCompanies } from "@/server/companies/service";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreateContactDialog } from "@/app/(dashboard)/dashboard/contacts/create-contact-dialog";

export default async function ContactsPage() {
  const { organization } = await requirePermission({ contact: ["read"] });
  const [{ contacts }, { companies }] = await Promise.all([
    listContacts({ organizationId: organization.id }),
    listCompanies({ organizationId: organization.id, limit: 200 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">{contacts.length} total.</p>
        </div>
        <CreateContactDialog companies={companies.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No contacts yet.
                  </TableCell>
                </TableRow>
              )}
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/contacts/${contact.id}`}
                      className="hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contact.company ? (
                      <Link href={`/dashboard/companies/${contact.company.id}`} className="hover:underline">
                        {contact.company.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.email ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.map((t) => (
                        <Badge key={t.tag.id} variant="secondary">
                          {t.tag.name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
