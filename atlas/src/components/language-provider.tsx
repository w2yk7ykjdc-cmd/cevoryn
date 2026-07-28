"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type Language = "en" | "tr";

const STORAGE_KEY = "atlas-language";

const messages = {
  en: {
    language: "Language",
    english: "English",
    turkish: "Turkish",
    home: "Home",
    brief: "Brief",
    intelligence: "Intelligence",
    health: "Health",
    chat: "Chat",
    analytics: "Analytics",
    team: "Team",
    settings: "Settings",
    billing: "Billing",
    feedback: "Feedback",
    privacy: "Privacy",
    terms: "Terms",
    refunds: "Refunds",
    darkMode: "Dark mode",
    lightMode: "Light mode",
    switchToDark: "Switch to dark mode",
    switchToLight: "Switch to light mode",
    mainNavigation: "Main navigation",
  },
  tr: {
    language: "Dil",
    english: "İngilizce",
    turkish: "Türkçe",
    home: "Ana Sayfa",
    brief: "Özet",
    intelligence: "İçgörüler",
    health: "Durum",
    chat: "Sohbet",
    analytics: "Analizler",
    team: "Ekip",
    settings: "Ayarlar",
    billing: "Faturalandırma",
    feedback: "Geri Bildirim",
    privacy: "Gizlilik",
    terms: "Koşullar",
    refunds: "İade Politikası",
    darkMode: "Karanlık mod",
    lightMode: "Aydınlık mod",
    switchToDark: "Karanlık moda geç",
    switchToLight: "Aydınlık moda geç",
    mainNavigation: "Ana menü",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const initialLanguage: Language = saved === "tr" ? "tr" : "en";
    setLanguageState(initialLanguage);
    document.documentElement.lang = initialLanguage;
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    document.documentElement.lang = nextLanguage;
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback(
    (key: MessageKey) => messages[language][key],
    [language]
  );

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
