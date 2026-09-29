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
  "current-earnings": "reports.finance.statementLines.currentYearEarnings",
  "prior-unclosed-earnings": "reports.finance.statementLines.priorUnclosedEarnings",
  "bs-assets-non-current": "reports.finance.statementLines.nonCurrentAssets",
  "bs-assets-non-current:total": "reports.finance.statementLines.nonCurrentAssetsTotal",
  "bs-assets-current": "reports.finance.statementLines.currentAssets",
  "bs-assets-current:total": "reports.finance.statementLines.currentAssetsTotal",
  "bs-assets-unclassified": "reports.finance.statementLines.unclassifiedAssets",
  "bs-assets-unclassified:total": "reports.finance.statementLines.unclassifiedAssetsTotal",
  "bs-liabilities-non-current": "reports.finance.statementLines.nonCurrentLiabilities",
  "bs-liabilities-non-current:total": "reports.finance.statementLines.nonCurrentLiabilitiesTotal",
  "bs-liabilities-current": "reports.finance.statementLines.currentLiabilities",
  "bs-liabilities-current:total": "reports.finance.statementLines.currentLiabilitiesTotal",
  "bs-liabilities-unclassified": "reports.finance.statementLines.unclassifiedLiabilities",
  "bs-liabilities-unclassified:total":
    "reports.finance.statementLines.unclassifiedLiabilitiesTotal",
  "is-revenue": "reports.finance.statementLines.revenue",
  "is-revenue:total": "reports.finance.statementLines.revenueTotal",
  "is-revenue-deductions": "reports.finance.statementLines.revenueDeductions",
  "is-revenue-deductions:total": "reports.finance.statementLines.revenueDeductionsTotal",
  "is-net-revenue": "reports.finance.statementLines.netRevenue",
  "is-cost-of-sales": "reports.finance.statementLines.costOfSales",
  "is-cost-of-sales:total": "reports.finance.statementLines.costOfSalesTotal",
  "is-gross-profit": "reports.finance.statementLines.grossProfit",
  "is-selling": "reports.finance.statementLines.selling",
  "is-selling:total": "reports.finance.statementLines.sellingTotal",
  "is-admin": "reports.finance.statementLines.admin",
  "is-admin:total": "reports.finance.statementLines.adminTotal",
  "is-operating-profit": "reports.finance.statementLines.operatingProfit",
  "is-other-income": "reports.finance.statementLines.otherIncome",
  "is-other-income:total": "reports.finance.statementLines.otherIncomeTotal",
  "is-other-expenses": "reports.finance.statementLines.otherExpenses",
  "is-other-expenses:total": "reports.finance.statementLines.otherExpensesTotal",
  "is-finance-costs": "reports.finance.statementLines.financeCosts",
  "is-finance-costs:total": "reports.finance.statementLines.financeCostsTotal",
  "is-fx": "reports.finance.statementLines.fx",
  "is-fx:total": "reports.finance.statementLines.fxTotal",
  "is-unclassified": "reports.finance.statementLines.unclassified",
  "is-unclassified:total": "reports.finance.statementLines.unclassifiedTotal",
  "cf-fx-effect": "reports.finance.statementLines.fxEffect",
  "cf-opening-entries": "reports.finance.statementLines.openingEntries",
  "current-year-closed": "reports.finance.statementLines.currentYearClosed",
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
