"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { Landmark } from "lucide-react";
import { FinancialReport } from "@/components/accounting/financial-report";
import type { FinancialReportLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type AccountLedger,
} from "@/services/accounting-reports-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import { useReportQuery } from "./use-report-query";

export function AccountStatementTab() {
  const { t } = useLocale();
  const router = useRouter();
  const { filters, setFilters, params } = useReportQuery();
  const [account, setAccount] = useState<ChartOfAccountRow | null>(null);
  const [statement, setStatement] = useState<AccountLedger | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) {
      setStatement(null);
      return;
    }
    setIsLoading(true);
    try {
      setStatement(await accountingReportsService.accountStatement(account.id, params));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [account, params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const lines = useMemo<FinancialReportLine[]>(() => {
    if (!statement) return [];
    const movements: FinancialReportLine[] = statement.movements.map((movement, index) => ({
      id: `${movement.journalEntryId}-${index}`,
      parentId: "statement",
      kind: "posting",
      level: 1,
      code: movement.entryNumber,
      label: `${formatDate(movement.entryDate)} · ${movement.description ?? movement.sourceType ?? ""}`,
      expandable: false,
      values: {
        debit: movement.debit,
        credit: movement.credit,
        running: movement.runningBalance,
      },
      children: [],
    }));
    return [
      {
        id: "opening",
        parentId: null,
        kind: "opening",
        level: 0,
        label: t("reports.finance.fields.openingBalance"),
        expandable: false,
        values: { debit: 0, credit: 0, running: statement.openingBalance },
        children: [],
      },
      {
        id: "statement",
        parentId: null,
        kind: "group",
        level: 0,
        code: statement.account.code,
        label: statement.account.name,
        expandable: movements.length > 0,
        values: {
          debit: statement.periodDebit,
          credit: statement.periodCredit,
          running: statement.closingBalance,
        },
        children: movements,
      },
      {
        id: "closing",
        parentId: null,
        kind: "closing",
        level: 0,
        label: t("reports.finance.fields.closingBalance"),
        expandable: false,
        values: { debit: 0, credit: 0, running: statement.closingBalance },
        children: [],
      },
    ];
  }, [statement, t]);

  return (
    <div className="flex flex-col gap-3">
      {!account ? (
        <>
          <FinancialReport
            lines={[]}
            columns={[
              { key: "debit", labelKey: "reports.finance.fields.debit" },
              { key: "credit", labelKey: "reports.finance.fields.credit" },
              {
                key: "running",
                labelKey: "reports.finance.fields.runningBalance",
                emphasize: true,
              },
            ]}
            isLoading={isLoading}
            filters={filters}
            onFiltersChange={setFilters}
            accountFilter={{ value: account, onChange: setAccount, required: true }}
            printTitle={t("reports.finance.accountStatement.title")}
            exportFileName="account-statement.csv"
          />
          <EmptyState
            icon={Landmark}
            title={t("reports.finance.accountStatement.selectAccountTitle")}
            description={t("reports.finance.accountStatement.selectAccountDescription")}
          />
        </>
      ) : (
        <FinancialReport
          lines={lines}
          columns={[
            { key: "debit", labelKey: "reports.finance.fields.debit" },
            { key: "credit", labelKey: "reports.finance.fields.credit" },
            { key: "running", labelKey: "reports.finance.fields.runningBalance", emphasize: true },
          ]}
          isLoading={isLoading}
          filters={filters}
          onFiltersChange={setFilters}
          accountFilter={{ value: account, onChange: setAccount, required: true }}
          printTitle={t("reports.finance.accountStatement.title")}
          exportFileName="account-statement.csv"
          status={{
            extras: statement
              ? [
                  {
                    label: t("reports.finance.fields.openingBalance"),
                    value: statement.openingBalance,
                  },
                  {
                    label: t("reports.finance.fields.closingBalance"),
                    value: statement.closingBalance,
                  },
                ]
              : [],
          }}
          onPostingClick={(line) => {
            const movement = statement?.movements.find(
              (row, index) => `${row.journalEntryId}-${index}` === line.id,
            );
            if (movement) router.push(`/finance/journal-entries?entry=${movement.journalEntryId}`);
          }}
        />
      )}
    </div>
  );
}
