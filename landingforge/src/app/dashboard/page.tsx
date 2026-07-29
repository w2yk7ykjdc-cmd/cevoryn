import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-gray-500">Giris yapan: {user?.email}</p>

      <form>
        <button
          formAction={signOut}
          className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Cikis yap
        </button>
      </form>
    </div>
  );
}
