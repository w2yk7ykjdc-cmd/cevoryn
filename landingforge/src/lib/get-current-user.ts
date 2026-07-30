import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser || !authUser.email) return null;

  try {
    return await prisma.user.upsert({
      where: { supabaseId: authUser.id },
      update: { email: authUser.email },
      create: {
        supabaseId: authUser.id,
        email: authUser.email,
      },
    });
  } catch (e) {
    // A row with this email already exists under a different (likely
    // deleted/recreated) Supabase auth id - relink it instead of crashing.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return prisma.user.update({
        where: { email: authUser.email },
        data: { supabaseId: authUser.id },
      });
    }
    throw e;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
