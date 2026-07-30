import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { email, password, mode } = await request.json();

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "E-posta ve sifre gerekli" }, { status: 400 });
  }

  const supabase = await createClient();

  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      console.error("[api/auth signup] Supabase error:", error);
      return NextResponse.json({ error: error.message });
    }

    if (!data.session) {
      return NextResponse.json({ message: "Hesap olusturuldu, giris yap" });
    }

    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("[api/auth login] Supabase error:", error);
    return NextResponse.json({ error: error.message });
  }

  return NextResponse.json({ ok: true });
}
