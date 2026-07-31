import { ArrowLeft, MessageSquareOff } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export default async function ChatNotFound() {
  const t = await getTranslations("chat");

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <MessageSquareOff className="h-7 w-7 text-muted-foreground" />
      </div>

      <h1 className="mt-5 text-xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {t("notFoundDescription")}
      </p>

      <Button asChild className="mt-6">
        <Link href="/chat">
          <ArrowLeft className="h-4 w-4" />
          {t("backToChat")}
        </Link>
      </Button>
    </div>
  );
}
