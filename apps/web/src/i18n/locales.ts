export const locales = ["ar", "en"] as const;

export type Locale = (typeof locales)[number];

/** Arabic is the primary language — English is a future secondary language only. */
export const defaultLocale: Locale = "ar";

export const localeDirection: Record<Locale, "ltr" | "rtl"> = {
  ar: "rtl",
  en: "ltr",
};

export const localeLabel: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
};
