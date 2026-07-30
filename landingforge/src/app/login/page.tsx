"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const supabase = createClient();
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
    }
    window.location.href = "/dashboard";
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{mode === "login" ? "Giris yap" : "Hesap olustur"}</h1>
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded border px-3 py-2" />
        <input type="password" placeholder="Sifre (min 6 karakter)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="rounded border px-3 py-2" />
        <button type="submit" disabled={loading} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Yukleniyor..." : mode === "login" ? "Giris yap" : "Hesap olustur"}
        </button>
      </form>
      <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} className="text-sm text-blue-600 hover:underline">
        {mode === "login" ? "Hesabin yok mu? Kayit ol" : "Hesabin var mi? Giris yap"}
      </button>
    </div>
  );
}
