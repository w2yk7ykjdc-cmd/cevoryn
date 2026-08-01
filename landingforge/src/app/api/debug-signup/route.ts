import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.signUp({
      email: "debug@landingforge.com",
      password: "Debug123456",
    });

    return NextResponse.json({
      urlPrefix: url.substring(0, 30),
      keyPrefix: key.substring(0, 20),
      data: {
        user: data?.user ? { id: data.user.id, email: data.user.email } : null,
        session: data?.session ? "exists" : null,
      },
      error: error ? { message: error.message, status: error.status, name: error.name } : null,
    });
  } catch (e) {
    return NextResponse.json({
      urlPrefix: url.substring(0, 30),
      keyPrefix: key.substring(0, 20),
      caught: e instanceof Error ? e.message : String(e),
    });
  }
}
