import Link from "next/link";
import { requireActiveOrganization } from "@/server/auth/session";
import { UserMenu } from "@/app/(dashboard)/user-menu";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/companies", label: "Companies" },
  { href: "/dashboard/contacts", label: "Contacts" },
  { href: "/dashboard/leads", label: "Leads" },
  { href: "/dashboard/chat", label: "AI Assistant" },
  { href: "/dashboard/members", label: "Members" },
  { href: "/dashboard/audit-log", label: "Audit Log" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, organization, member } = await requireActiveOrganization();

  return (
    <div className="flex min-h-svh w-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/20 p-4 sm:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="text-lg font-semibold">CompanyOS</span>
        </div>
        <div className="mb-4 rounded-md border bg-card px-3 py-2">
          <p className="truncate text-sm font-medium">{organization.name}</p>
          <Badge variant="secondary" className="mt-1 capitalize">
            {member.role}
          </Badge>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <Link
            href="/organizations"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Switch workspace
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm font-medium sm:hidden">{organization.name}</span>
          <div />
          <UserMenu name={session.user.name} email={session.user.email} image={session.user.image} />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
