import type { Locale } from "@/i18n/locales";
import type { MessageKey } from "@/i18n/translate";
import type { FinancialReportLine } from "./types";

/** Engine-defined structural rows (sections, totals, cash-flow blocks) carry
 *  a fixed id and are always translated from the dictionary, never from the
 *  API's own label pair. */
export const SECTION_LABELS: Record<string, MessageKey> = {
  assets: "reports.finance.fields.assets",
  "assets:total": "reports.finance.fields.totalAssets",
  liabilities: "reports.finance.fields.liabilities",
  "liabilities:total": "reports.finance.fields.totalLiabilities",
  equity: "reports.finance.fields.equity",
  "equity:total": "reports.finance.fields.totalEquity",
  "liabilities-equity": "reports.finance.fields.totalLiabilitiesAndEquity",
  "current-earnings": "reports.finance.fields.currentEarnings",
  revenue: "reports.finance.fields.revenue",
  "revenue:total": "reports.finance.fields.totalRevenue",
  expense: "reports.finance.fields.expense",
  "expense:total": "reports.finance.fields.totalExpense",
  "net-income": "reports.finance.fields.netIncome",
  "cf-opening": "reports.finance.cashFlowSections.openingCash",
  "cf-operating": "reports.finance.cashFlowSections.operating",
  "cf-operating:total": "reports.finance.cashFlowSections.operatingNet",
  "cf-investing": "reports.finance.cashFlowSections.investing",
  "cf-investing:total": "reports.finance.cashFlowSections.investingNet",
  "cf-financing": "reports.finance.cashFlowSections.financing",
  "cf-financing:total": "reports.finance.cashFlowSections.financingNet",
  "cf-other": "reports.finance.cashFlowSections.other",
  "cf-other:total": "reports.finance.cashFlowSections.otherNet",
  "cf-net": "reports.finance.cashFlowSections.netChange",
  "cf-closing": "reports.finance.cashFlowSections.closingCash",
};

/**
 * The ONE place a report line's display text is resolved — the on-screen
 * table, the print layout and the Excel/CSV export all call this, so the
 * same line reads identically in every output for the active language.
 */
export function resolveFinancialLineLabel(
  line: Pick<FinancialReportLine, "id" | "label" | "labelEn" | "values">,
  locale: Locale,
  t: (key: MessageKey) => string,
): string {
  const net = line.values.balance ?? line.values.closing ?? 0;
  const translated =
    line.id === "net-income"
      ? net < 0
        ? "reports.finance.fields.netLoss"
        : "reports.finance.fields.netProfit"
      : SECTION_LABELS[line.id];
  if (translated) return t(translated);
  // Cash-flow activity rows ("cf:SECTION:SOURCE_TYPE") carry a journal
  // source type, not prose — use its localized name when one exists.
  if (line.id.startsWith("cf:")) {
    const key = `accounting.journalEntries.sourceTypes.${line.id.split(":")[2]}` as MessageKey;
    const text = t(key);
    if (text !== key) return text;
  }
  return locale === "ar" ? line.label : (line.labelEn ?? line.label);
}
