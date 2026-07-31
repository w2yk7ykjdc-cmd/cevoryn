import Link from "next/link";
import { requirePermission } from "@/server/auth/session";
import { listCompanies } from "@/server/companies/service";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateCompanyDialog } from "@/app/(dashboard)/dashboard/companies/create-company-dialog";

export default async function CompaniesPage() {
  const { organization } = await requirePermission({ company: ["read"] });
  const { companies } = await listCompanies({ organizationId: organization.id });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Organizations you sell to. {companies.length} total.
          </p>
        </div>
        <CreateCompanyDialog />
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Website</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead className="text-right">Leads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No companies yet. Create one to get started.
                  </TableCell>
                </TableRow>
              )}
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/companies/${company.id}`}
                      className="hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {company.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{company.industry ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{company.website ?? "—"}</TableCell>
                  <TableCell className="text-right">{company._count.contacts}</TableCell>
                  <TableCell className="text-right">{company._count.leads}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
