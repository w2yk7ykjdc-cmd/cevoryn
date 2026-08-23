import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRoleAtLeast } from "@/lib/rbac";

export const runtime = "nodejs";

interface AuthUserRow {
  id: string;
  email: string;
  created_at: Date;
  email_confirmed_at: Date | null;
  last_sign_in_at: Date | null;
  provider: string | null;
  providers: unknown;
}

interface MemberRow {
  member_id: string;
  role: string;
  organization_id: string;
  organization_name: string;
  member_created_at: Date;
}

interface GoogleConnectionRow {
  google_email: string;
}

/**
 * TEMPORARY diagnostic endpoint - resolves which Supabase Auth account (and
 * which CEVORYN workspace/role) a given email is tied to, without needing
 * Supabase dashboard access. Supabase's own `auth.users` table lives in the
 * same Postgres database as our `public` schema tables, just a different
 * schema - this only works if the connection role behind DATABASE_URL has
 * read access to `auth`, which is Supabase's default grant but is not
 * independently confirmed here.
 *
 * Deliberately selects a narrow, non-sensitive column list from auth.users
 * (id, email, timestamps, provider metadata) - never encrypted_password,
 * confirmation_token, recovery_token, or any other credential/token column.
 *
 * DELETE this route once the lookup this was built for is done - see the
 * PR description for the removal checklist.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const membership = await getMembership(user.id);
  if (!membership || !isRoleAtLeast(membership.role, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const email = new URL(request.url).searchParams
    .get("email")
    ?.trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "Missing required ?email= query parameter." },
      { status: 400 }
    );
  }

  try {
    const authUsers = await prisma.$queryRaw<AuthUserRow[]>`
      SELECT
        "id",
        "email",
        "created_at",
        "email_confirmed_at",
        "last_sign_in_at",
        "raw_app_meta_data"->>'provider' AS "provider",
        "raw_app_meta_data"->'providers' AS "providers"
      FROM "auth"."users"
      WHERE lower("email") = ${email}
    `;

    const authUser = authUsers[0] ?? null;
    if (!authUser) {
      return NextResponse.json({
        data: { email, authUser: null, member: null, googleConnection: null },
      });
    }

    const [members, googleConnections] = await Promise.all([
      prisma.$queryRaw<MemberRow[]>`
        SELECT
          m."id" AS "member_id",
          m."role",
          m."organization_id",
          o."name" AS "organization_name",
          m."created_at" AS "member_created_at"
        FROM "members" m
        JOIN "organizations" o ON o."id" = m."organization_id"
        WHERE m."user_id" = ${authUser.id}
      `,
      prisma.$queryRaw<GoogleConnectionRow[]>`
        SELECT "google_email"
        FROM "google_connections"
        WHERE "user_id" = ${authUser.id}
      `,
    ]);

    return NextResponse.json({
      data: {
        email,
        authUser,
        members,
        // "Google connection" here means CEVORYN's own Calendar/Gmail
        // integration (google_connections table) - a separate concept
        // from "provider"/"providers" above, which is whether this
        // Supabase Auth identity itself was created via Google Sign-In.
        googleConnections,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Lookup failed.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
