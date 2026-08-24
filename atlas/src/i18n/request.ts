import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

// English-only for the current (global/sales) release: the app always
// resolves to DEFAULT_LOCALE regardless of any stored NEXT_LOCALE cookie,
// so a returning user who previously switched to Turkish doesn't see it
// again. LOCALES/messages/tr.json are kept intact - re-enable the
// cookie-based branch below to bring back a second active language.
function resolveLocale(_value: string | undefined): Locale {
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
