import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function toPlain(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value as unknown as Record<string, unknown>),
    };
  }
  return value;
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const urlPrefix = url ? url.slice(0, 20) : null;
    const keyPrefix = key ? key.slice(0, 20) : null;

    if (!url || !key) {
      return NextResponse.json({
        urlPrefix,
        keyPrefix,
        error: "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing",
      });
    }

    const supabase = createClient(url, key);

    const { data, error } = await supabase.auth.signUp({
      email: "debug@landingforge.com",
      password: "Debug123456",
    });

    return NextResponse.json({
      urlPrefix,
      keyPrefix,
      data: toPlain(data),
      error: toPlain(error),
    });
  } catch (e) {
    return NextResponse.json({
      threw: true,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
