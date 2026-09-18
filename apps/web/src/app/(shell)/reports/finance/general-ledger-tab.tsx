"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { FinancialReport } from "@/components/accounting/financial-report";
import type { FinancialReportLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type AccountLedger,
  type HierarchicalReportLine,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import { MoneyCell } from "./shared";
import { useReportQuery } from "./use-report-query";

export function GeneralLedgerTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [lines, setLines] = useState<HierarchicalReportLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [detail, setDetail] = useState<AccountLedger | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.trialBalance(params);
      setLines(result.lines ?? []);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openAccount = async (line: FinancialReportLine) => {
    if (!line.accountId) return;
    setDetailLoading(true);
    try {
      const statement = await accountingReportsService.accountStatement(line.accountId, params);
      setDetail(statement);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <FinancialReport
        lines={lines}
        columns={[
          { key: "opening", labelKey: "reports.finance.fields.openingBalance" },
          { key: "debit", labelKey: "reports.finance.fields.debit" },
          { key: "credit", labelKey: "reports.finance.fields.credit" },
          { key: "closing", labelKey: "reports.finance.fields.closingBalance", emphasize: true },
        ]}
        isLoading={isLoading || detailLoading}
        filters={filters}
        onFiltersChange={setFilters}
        printTitle={t("reports.finance.generalLedger")}
        exportFileName="general-ledger.csv"
        onPostingClick={(line) => {
          void openAccount(line);
        }}
      />

      <EnterpriseModal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        icon={ScrollText}
        title={detail ? `${detail.account.code} — ${detail.account.name}` : ""}
        size="lg"
        footer={(requestClose) => (
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
        )}
      >
        {detail ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">
                  {t("reports.finance.fields.openingBalance")}
                </div>
                <MoneyCell value={detail.openingBalance} />
              </div>
              <div>
                <div className="text-muted-foreground">{t("reports.finance.fields.debit")}</div>
                <MoneyCell value={detail.periodDebit} />
              </div>
              <div>
                <div className="text-muted-foreground">{t("reports.finance.fields.credit")}</div>
                <MoneyCell value={detail.periodCredit} />
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t("reports.finance.fields.closingBalance")}
                </div>
                <MoneyCell value={detail.closingBalance} />
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-start">
                  <tr>
                    <th className="p-2 text-start font-medium">
                      {t("reports.finance.fields.entryDate")}
                    </th>
                    <th className="p-2 text-start font-medium">
                      {t("reports.finance.fields.entryNumber")}
                    </th>
                    <th className="p-2 text-start font-medium">
                      {t("reports.finance.fields.sourceDocument")}
                    </th>
                    <th className="p-2 text-end font-medium">
                      {t("reports.finance.fields.debit")}
                    </th>
                    <th className="p-2 text-end font-medium">
                      {t("reports.finance.fields.credit")}
                    </th>
                    <th className="p-2 text-end font-medium">
                      {t("reports.finance.fields.runningBalance")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((movement, index) => (
                    <tr
                      key={`${movement.journalEntryId}-${index}`}
                      className="border-t border-border"
                    >
                      <td className="p-2">{formatDate(movement.entryDate)}</td>
                      <td className="p-2">
                        <Link
                          href={`/finance/journal-entries?entry=${movement.journalEntryId}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          <code dir="ltr">{movement.entryNumber}</code>
                        </Link>
                      </td>
                      <td className="p-2">
                        {movement.sourceType ?? movement.referenceNumber ?? "—"}
                      </td>
                      <td className="p-2 text-end">
                        <MoneyCell value={movement.debit} />
                      </td>
                      <td className="p-2 text-end">
                        <MoneyCell value={movement.credit} />
                      </td>
                      <td className="p-2 text-end">
                        <MoneyCell value={movement.runningBalance} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </EnterpriseModal>
    </>
  );
}
