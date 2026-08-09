import en from "./messages/en";
import ar from "./messages/ar";
import type { Locale } from "./locales";

/** Widens literal string leaves (from each dictionary's `as const`) to `string`, so any locale's own translated text satisfies the shape. */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

/** `ar` must satisfy the same key shape as `en` — a missing key is a type error, not a silent fallback. */
const typedAr: Messages = ar;

export const messages: Record<Locale, Messages> = { en, ar: typedAr };
