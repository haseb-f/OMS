"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, ScrollText } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { FinancialReport } from "@/components/accounting/financial-report";
import type { FinancialReportLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type JournalReportEntry,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import { MoneyCell } from "./shared";
import { useReportQuery } from "./use-report-query";

export function JournalReportTab() {
  const { t } = useLocale();
  const router = useRouter();
  const { filters, setFilters, params } = useReportQuery();
  const [items, setItems] = useState<JournalReportEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [detail, setDetail] = useState<JournalReportEntry | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.journalReport({
        ...params,
        page: 1,
        pageSize: 200,
        sortOrder: "desc",
      });
      setItems(result.items);
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

  const lines = useMemo<FinancialReportLine[]>(
    () =>
      items.map((entry) => ({
        id: entry.id,
        parentId: null,
        kind: "posting",
        level: 0,
        code: entry.entryNumber,
        label: `${formatDate(entry.entryDate)} · ${entry.sourceType ?? "—"} · ${entry.description ?? ""}`,
        expandable: false,
        values: {
          debit: Number(entry.totalDebit),
          credit: Number(entry.totalCredit),
        },
        children: [],
      })),
    [items],
  );

  return (
    <>
      <FinancialReport
        lines={lines}
        columns={[
          { key: "debit", labelKey: "reports.finance.fields.debit" },
          { key: "credit", labelKey: "reports.finance.fields.credit" },
        ]}
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={setFilters}
        printTitle={t("reports.finance.journalReport")}
        exportFileName="journal-report.csv"
        nameHeaderKey="reports.finance.fields.sourceDocument"
        onPostingClick={(line) => {
          const match = items.find((entry) => entry.id === line.id);
          if (match) setDetail(match);
        }}
      />

      <EnterpriseModal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        icon={ScrollText}
        title={detail ? detail.entryNumber : ""}
        size="lg"
        footer={(requestClose) => (
          <>
            {detail ? (
              <EnterpriseButton
                type="button"
                variant="outline"
                onClick={() => router.push(`/finance/journal-entries/${detail.id}`)}
              >
                <Eye />
                {t("common.view")}
              </EnterpriseButton>
            ) : null}
            <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
              {t("common.close")}
            </EnterpriseButton>
          </>
        )}
      >
        {detail ? (
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-start font-medium">
                    {t("reports.finance.fields.accountCode")}
                  </th>
                  <th className="p-2 text-start font-medium">
                    {t("reports.finance.fields.accountName")}
                  </th>
                  <th className="p-2 text-start font-medium">
                    {t("reports.finance.fields.description")}
                  </th>
                  <th className="p-2 text-end font-medium">{t("reports.finance.fields.debit")}</th>
                  <th className="p-2 text-end font-medium">{t("reports.finance.fields.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id} className="border-t border-border">
                    <td className="p-2">{line.account.code}</td>
                    <td className="p-2">{line.account.name}</td>
                    <td className="p-2">{line.description ?? "—"}</td>
                    <td className="p-2 text-end">
                      <MoneyCell value={Number(line.debit)} />
                    </td>
                    <td className="p-2 text-end">
                      <MoneyCell value={Number(line.credit)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </EnterpriseModal>
    </>
  );
}
