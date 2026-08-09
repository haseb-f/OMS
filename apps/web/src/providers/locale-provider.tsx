"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Direction as RadixDirection } from "radix-ui";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { defaultLocale, localeDirection, type Locale } from "@/i18n/locales";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";

interface LocaleContextValue {
  locale: Locale;
  direction: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Arabic is the primary language and loads by default — direction is
 * DERIVED from locale, never set independently, so RTL is never just a
 * cosmetic flip: switching locale changes both the rendered text and the
 * layout direction together, as one property.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useLocalStorage<Locale>(STORAGE_KEYS.locale, defaultLocale);
  const direction = localeDirection[locale];

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = locale;
  }, [direction, locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      direction,
      setLocale,
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(messages[locale], key, params),
    }),
    [locale, direction, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>
      <RadixDirection.Provider dir={direction}>{children}</RadixDirection.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
