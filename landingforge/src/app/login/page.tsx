"use client";

import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    if (mode === "signup") {
      const confirm = form.get("passwordConfirm") as string;
      if (password !== confirm) {
        setError("Sifreler eslesmiyor");
        setLoading(false);
        return;
      }
    }

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, mode }),
    });

    const data = await res.json();

    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }

    if (data.message) {
      setMessage(data.message);
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">
        {mode === "login" ? "Giris yap" : "Hesap olustur"}
      </h1>

      {message && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-700">{message}</p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          E-posta
          <input name="email" type="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sifre
          <input name="password" type="password" required minLength={6} className="rounded border px-3 py-2" />
        </label>

        {mode === "signup" && (
          <label className="flex flex-col gap-1 text-sm">
            Sifre (tekrar)
            <input name="passwordConfirm" type="password" required minLength={6} className="rounded border px-3 py-2" />
          </label>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Yukleniyor..." : mode === "login" ? "Giris yap" : "Hesap olustur"}
        </button>
      </form>

      <button
        onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
        className="text-sm text-blue-600 hover:underline"
      >
        {mode === "login" ? "Hesabin yok mu? Kayit ol" : "Hesabin var mi? Giris yap"}
      </button>
    </div>
  );
}
