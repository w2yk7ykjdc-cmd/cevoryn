// These are public by design (the anon key is safe to expose; Supabase's
// Row Level Security is the actual access boundary), so hardcoded fallbacks
// here are not a secret leak. Guards against a missing/mistyped Vercel env var
// silently breaking every Supabase call with no visible error.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qacgbuqcmceocpeskhfe.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_Jmx7uVh3VTxXTfqwSYPTDw_rU_h2Xvj";
