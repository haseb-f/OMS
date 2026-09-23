"use client";

import { useCallback, useEffect, useState } from "react";
import {
  accountingReportsService,
  type CashAvailabilityResult,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatMoney } from "@/lib/money";
import { EnterpriseBadge } from "@/components/ui/badge";
import { AccountingReportFilterBar } from "@/components/accounting/report-filter-bar";
import { useReportQuery } from "./use-report-query";

export function CashAvailabilityTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [result, setResult] = useState<CashAvailabilityResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setResult(
        await accountingReportsService.cashAvailability({
          asOf: params.dateTo,
          currencyId: params.currencyId,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.currencyId, params.dateTo, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <AccountingReportFilterBar value={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-center gap-2">
        <EnterpriseBadge variant="warning">
          {t("reports.finance.cashAvailabilityReport.estimateBadge")}
        </EnterpriseBadge>
        {result ? (
          <p className="text-caption text-muted-foreground">
            {result.formula}. {result.limitations[1]}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[48rem] text-start text-body">
          <thead className="bg-muted/40 text-caption text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t("reports.finance.cashAvailabilityReport.account")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("reports.finance.cashAvailabilityReport.currency")}
              </th>
              <th className="px-3 py-2 text-end font-medium">
                {t("reports.finance.cashAvailabilityReport.bookBalance")}
              </th>
              <th className="px-3 py-2 text-end font-medium">
                {t("reports.finance.cashAvailabilityReport.holds")}
              </th>
              <th className="px-3 py-2 text-end font-medium">
                {t("reports.finance.cashAvailabilityReport.committed")}
              </th>
              <th className="px-3 py-2 text-end font-medium">
                {t("reports.finance.cashAvailabilityReport.available")}
              </th>
              <th className="px-3 py-2 text-end font-medium">
                {t("reports.finance.cashAvailabilityReport.egpAvailable")}
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("common.loading")}
                </td>
              </tr>
            ) : !result?.accounts.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("reports.finance.cashAvailabilityReport.empty")}
                </td>
              </tr>
            ) : (
              result.accounts.map((row) => (
                <tr key={row.receivingAccountId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.accountName}</div>
                    <div className="text-caption text-muted-foreground" dir="ltr">
                      {row.accountCode}
                    </div>
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {row.currencyCode}
                  </td>
                  <td className="px-3 py-2 text-end" dir="ltr">
                    {formatMoney(row.bookBalance, row.currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-end" dir="ltr">
                    {formatMoney(row.recordedHolds, row.currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-end" dir="ltr">
                    {formatMoney(row.committedOutgoing, row.currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-end font-semibold" dir="ltr">
                    {formatMoney(row.availableToSpend, row.currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-end" dir="ltr">
                    {row.egpEquivalent.availableToSpend == null
                      ? "—"
                      : formatMoney(row.egpEquivalent.availableToSpend, "EGP")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result ? (
        <div className="flex flex-wrap gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-caption">
          {result.totalsByCurrency.map((total) => (
            <div key={total.currencyCode} dir="ltr">
              <span className="text-muted-foreground">{total.currencyCode}: </span>
              <span className="font-medium">
                {formatMoney(total.available, total.currencyCode)}
              </span>
            </div>
          ))}
          <div dir="ltr">
            <span className="text-muted-foreground">
              {t("reports.finance.cashAvailabilityReport.egpConsolidated")}:{" "}
            </span>
            <span className="font-semibold">
              {formatMoney(result.egpConsolidated.availableToSpend, "EGP")}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
