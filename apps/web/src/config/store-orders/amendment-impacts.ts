import type { MessageKey } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";
import { uiLanguagePart } from "@/services/api-client";
import type { AmendmentImpact, AmendmentPreview } from "@/services/order-amendments-service";

/**
 * Round 5 Spec 1A — the amendment preview as the dialog shows it: blocking
 * impacts (destructive, with the required prior step), acknowledgements
 * (one checkbox each; all must be checked) and informational lines. Pure
 * and unit-tested; the dialog only renders it.
 */
export interface ImpactViewItem {
  code: string;
  text: string;
}

export interface ImpactView {
  blocking: ImpactViewItem[];
  acknowledgements: Array<ImpactViewItem & { checked: boolean }>;
  info: ImpactViewItem[];
  /** Codes still to acknowledge. */
  missing: string[];
  canCommit: boolean;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Codes whose server message is already the precise, bilingual explanation. */
const SERVER_TEXT_CODES = new Set(["AGENT_PRICING_INVALID"]);

/** Localized impact text: `orderAmendments.impact.<CODE>` with the impact params, else the server text. */
export function impactText(impact: AmendmentImpact, t: Translate, locale: Locale): string {
  const serverText = uiLanguagePart(impact.message, locale) ?? impact.message;
  if (SERVER_TEXT_CODES.has(impact.code)) return serverText;
  const key = `orderAmendments.impact.${impact.code}` as MessageKey;
  const params = Object.fromEntries(
    Object.entries(impact.params ?? {}).map(([name, value]) => [name, value ?? "—"]),
  ) as Record<string, string | number>;
  const text = t(key, params);
  return text === key ? serverText : text;
}

export function buildImpactView(
  preview: Pick<AmendmentPreview, "impacts" | "canCommit">,
  acknowledged: ReadonlySet<string>,
  t: Translate,
  locale: Locale,
): ImpactView {
  const seen = new Set<string>();
  const blocking: ImpactViewItem[] = [];
  const acknowledgements: ImpactView["acknowledgements"] = [];
  const info: ImpactViewItem[] = [];
  for (const impact of preview.impacts) {
    const item = { code: impact.code, text: impactText(impact, t, locale) };
    if (impact.severity === "BLOCKING") blocking.push(item);
    else if (impact.severity === "ACKNOWLEDGE") {
      if (seen.has(impact.code)) continue;
      seen.add(impact.code);
      acknowledgements.push({ ...item, checked: acknowledged.has(impact.code) });
    } else info.push(item);
  }
  const missing = acknowledgements.filter((a) => !a.checked).map((a) => a.code);
  return {
    blocking,
    acknowledgements,
    info,
    missing,
    canCommit: preview.canCommit && blocking.length === 0 && missing.length === 0,
  };
}
