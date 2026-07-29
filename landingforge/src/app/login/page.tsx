import { login, signup } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">LandingForge&apos;a giris yap</h1>

      {message && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-700">{message}</p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <form className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          E-posta
          <input
            name="email"
            type="email"
            required
            className="rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sifre
          <input
            name="password"
            type="password"
            required
            minLength={6}
            className="rounded border px-3 py-2"
          />
        </label>

        <button
          formAction={login}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Giris yap
        </button>
        <button
          formAction={signup}
          className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Hesap olustur
        </button>
      </form>
    </div>
  );
}
