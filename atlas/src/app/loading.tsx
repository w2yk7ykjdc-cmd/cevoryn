import { Loader2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function GlobalLoading() {
  const t = await getTranslations("loadingBoundaries");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("root")}</p>
    </div>
  );
}
