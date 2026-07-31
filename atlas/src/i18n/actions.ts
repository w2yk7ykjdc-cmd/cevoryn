"use server";

import { cookies } from "next/headers";

import { LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/request";

export async function setLocale(locale: Locale): Promise<void> {
  if (!LOCALES.includes(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
