import { Loader2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AuthLoading() {
  const t = await getTranslations("loadingBoundaries.auth");

  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      <div>
        <p className="font-medium">{t("title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
    </div>
  );
}
