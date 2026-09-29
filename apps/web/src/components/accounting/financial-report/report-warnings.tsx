"use client";

import { Info, TriangleAlert } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocale } from "@/providers/locale-provider";
import { formatAmount } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";
import type { ReportWarning } from "@/services/accounting-reports-service";

const MESSAGE: Record<ReportWarning["code"], MessageKey> = {
  UNCLASSIFIED_ACCOUNTS: "reports.finance.statementWarnings.unclassified",
  ROLE_CONFLICT: "reports.finance.statementWarnings.roleConflict",
  CAPITAL_RETURN_IN_PROFIT_OR_LOSS: "reports.finance.statementWarnings.capitalReturn",
  DRAFTS_INCLUDED: "reports.finance.statementWarnings.drafts",
  CARRY_FORWARD_OPENING_ENTRY: "reports.finance.statementWarnings.carryForward",
  UNBALANCED_ENTRIES: "reports.finance.statementWarnings.unbalanced",
};

/** Localized one-line text of a report warning (screen, and summary/export via callers). */
export function reportWarningText(
  warning: ReportWarning,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  return t(MESSAGE[warning.code], {
    count: warning.accounts?.length ?? 0,
    entries: (warning.entries ?? []).map((entry) => entry.entryNumber).join(", "),
  });
}

/**
 * The same warnings as summary notes, so print and Excel/CSV carry the
 * caveats shown on screen (`FinancialReportSummary.notes`).
 */
export function reportWarningNotes(
  warnings: ReportWarning[] | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  extra?: string | null,
): Array<{ id: string; label: string; text: string }> {
  const label = t("reports.finance.statementWarnings.label");
  const notes = (warnings ?? []).map((warning) => {
    const accounts = (warning.accounts ?? [])
      .slice(0, 20)
      .map((account) => `${account.code} (${formatAmount(account.amount)})`)
      .join(", ");
    const more = (warning.accounts?.length ?? 0) > 20 ? ", …" : "";
    return {
      id: warning.code,
      label,
      text: `${reportWarningText(warning, t)}${accounts ? ` ${accounts}${more}` : ""}`,
    };
  });
  return extra ? [...notes, { id: "extra", label, text: extra }] : notes;
}

/**
 * The statement-integrity caption under a financial report's filters
 * (unclassified accounts, conflicting mappings, drafts, carry-forward
 * entries): one warning line each, the affected accounts one click away.
 * Renders nothing when the report has no warnings.
 */
export function ReportWarnings({
  warnings,
  extra,
}: {
  warnings?: ReportWarning[];
  /** A plain informational line shown after the warnings (e.g. excluded transfers). */
  extra?: string | null;
}) {
  const { t } = useLocale();
  const list = warnings ?? [];
  if (list.length === 0 && !extra) return null;
  return (
    <span className="flex flex-col gap-1">
      {list.map((warning) => (
        <span
          key={warning.code}
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
          role="status"
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-warning-soft-foreground">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            {reportWarningText(warning, t)}
          </span>
          {warning.accounts && warning.accounts.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <EnterpriseButton
                  type="button"
                  variant="link"
                  size="inline"
                  className="text-caption"
                >
                  <Info aria-hidden />
                  {t("reports.finance.statementWarnings.details")}
                </EnterpriseButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-caption">
                  {warning.accounts.map((account) => (
                    <li key={account.accountId} className="flex justify-between gap-3">
                      <bdi className="min-w-0 truncate">
                        {account.code} — {account.name}
                      </bdi>
                      <span className="shrink-0 tabular-nums">{formatAmount(account.amount)}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
        </span>
      ))}
      {extra ? <span>{extra}</span> : null}
    </span>
  );
}
