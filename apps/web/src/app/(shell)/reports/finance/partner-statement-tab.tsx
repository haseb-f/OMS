"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { UsersRound } from "lucide-react";
import { FinancialReport } from "@/components/accounting/financial-report";
import type { FinancialReportLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type PartnerStatementResult,
} from "@/services/accounting-reports-service";
import { PartnerPicker } from "@/components/business/partner-picker";
import type { PartnerRoleValue, PartnerRow } from "@/services/partners-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import { useReportQuery } from "./use-report-query";

export function PartnerStatementTab({ role }: { role: PartnerRoleValue }) {
  const { t } = useLocale();
  const router = useRouter();
  const { filters, setFilters, params } = useReportQuery();
  const [partner, setPartner] = useState<PartnerRow | null>(null);
  const [statement, setStatement] = useState<PartnerStatementResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const statementTitle =
    role === "CUSTOMER"
      ? t("reports.finance.customerStatement")
      : t("reports.finance.supplierStatement");

  const load = useCallback(async () => {
    if (!partner) {
      setStatement(null);
      return;
    }
    setIsLoading(true);
    try {
      setStatement(
        await accountingReportsService.partnerStatement(partner.id, {
          ...params,
          page: 1,
          pageSize: 500,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [partner, params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const lines = useMemo<FinancialReportLine[]>(() => {
    if (!statement) return [];
    const movements: FinancialReportLine[] = statement.movements.map((movement, index) => ({
      id: `${movement.journalEntryId}-${movement.accountCode}-${index}`,
      parentId: "statement",
      kind: "posting",
      level: 1,
      code: movement.accountCode,
      label: `${formatDate(movement.entryDate)} · ${movement.entryNumber} · ${movement.description ?? movement.sourceType ?? ""}`,
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
        code: statement.partner.partnerNumber,
        label: statement.partner.name,
        expandable: movements.length > 0,
        values: {
          debit: statement.movements.reduce((sum, row) => sum + row.debit, 0),
          credit: statement.movements.reduce((sum, row) => sum + row.credit, 0),
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
      <FinancialReport
        lines={partner ? lines : []}
        columns={[
          { key: "debit", labelKey: "reports.finance.fields.debit" },
          { key: "credit", labelKey: "reports.finance.fields.credit" },
          { key: "running", labelKey: "reports.finance.fields.runningBalance", emphasize: true },
        ]}
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={setFilters}
        printTitle={statementTitle}
        exportFileName={`${role.toLowerCase()}-statement.csv`}
        nameHeaderKey="reports.finance.fields.partnerName"
        toolbarExtra={<PartnerPicker role={role} value={partner} onChange={setPartner} />}
        onPostingClick={(line) => {
          const movement = statement?.movements.find(
            (row, index) => `${row.journalEntryId}-${row.accountCode}-${index}` === line.id,
          );
          if (movement) router.push(`/finance/journal-entries?entry=${movement.journalEntryId}`);
        }}
      />
      {!partner ? (
        <EmptyState
          icon={UsersRound}
          title={statementTitle}
          description={t("reports.finance.partnerStatement.selectDescription")}
        />
      ) : null}
    </div>
  );
}
