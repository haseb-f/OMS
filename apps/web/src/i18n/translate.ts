import type { Messages } from "./messages";

type DotPath<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : DotPath<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid "nav.dashboard"-style key across the message dictionary — a typo is a type error. */
export type MessageKey = DotPath<Messages>;

export function translate(
  dictionary: Messages,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      dictionary,
    );
  const text = typeof value === "string" ? value : key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match,
  );
}
