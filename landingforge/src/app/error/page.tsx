export default function ErrorPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold">Bir seyler ters gitti</h1>
      <p className="text-sm text-gray-500">
        Dogrulama baglantisi gecersiz ya da suresi dolmus olabilir.
      </p>
    </div>
  );
}
