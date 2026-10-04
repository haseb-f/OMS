"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import {
  FinancialReportView,
  ReportPagination,
  type FinancialReportColumn,
  type FinancialReportLine,
  type FinancialReportTextColumn,
} from "@/components/accounting/financial-report";
import { StatusBadge } from "@/components/business/status-badge";
import { tableIdentityCellClass } from "@/components/ui/table";
import {
  investmentDistributionsService,
  type ProfitDistributionRow,
} from "@/services/investment-distributions-service";
import {
  investorLedgerService,
  type InvestorLedgerEntryRow,
} from "@/services/investor-ledger-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { apiErrorMessage } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

const DISTRIBUTION_TONE: Record<
  ProfitDistributionRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "destructive",
};

interface ProfitRow {
  distribution: ProfitDistributionRow;
  entitledAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
}

/** Investor Engine Milestone 3, Phase 44 — per-Opportunity approved/paid/outstanding, one row per Distribution this Investor is entitled in. */
export function ProfitsTab({ investorId }: { investorId: string }) {
  const { t } = useLocale();
  const [distributions, setDistributions] = useState<ProfitDistributionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await investmentDistributionsService.list({ investorId, pageSize: 100 });
      setDistributions(result.items);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [investorId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const rows = useMemo<ProfitRow[]>(
    () =>
      (distributions ?? []).flatMap((distribution) => {
        const row = distribution.investorDistributions.find((r) => r.investorId === investorId);
        return row
          ? [
              {
                distribution,
                entitledAmount: row.entitledAmount,
                paidAmount: row.paidAmount,
                outstandingAmount: row.outstandingAmount,
                status: row.status,
              },
            ]
          : [];
      }),
    [distributions, investorId],
  );

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!distributions) return null;
  if (rows.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("investors.ledger.profitsTab.empty")} />;
  }

  const sum = (pick: (row: ProfitRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const money = (value: number) => (
    <span className="num">{formatAmount(value, { zero: "dash" })}</span>
  );

  const columns: CompactDetailColumn<ProfitRow>[] = [
    {
      id: "opportunity",
      header: t("investors.ledger.profitsTab.opportunity"),
      cell: (row) => (
        <a
          href={`/investors/opportunities/${row.distribution.opportunityId}`}
          className={`num hover:underline ${tableIdentityCellClass}`}
        >
          {row.distribution.opportunityCode}
        </a>
      ),
      footer: t("reports.finance.totals"),
    },
    {
      id: "approved",
      header: t("investors.ledger.profitsTab.approvedProfit"),
      align: "end",
      cell: (row) => money(row.entitledAmount),
      footer: money(sum((row) => row.entitledAmount)),
    },
    {
      id: "paid",
      header: t("investors.ledger.profitsTab.paid"),
      align: "end",
      cell: (row) => money(row.paidAmount),
      footer: money(sum((row) => row.paidAmount)),
    },
    {
      id: "outstanding",
      header: t("investors.ledger.profitsTab.outstanding"),
      align: "end",
      cell: (row) => money(row.outstandingAmount),
      footer: money(sum((row) => row.outstandingAmount)),
    },
    {
      id: "status",
      header: t("investors.ledger.profitsTab.status"),
      cell: (row) => (
        <StatusBadge
          label={t(`investors.distributions.investorStatus.${row.status}` as MessageKey)}
          tone={DISTRIBUTION_TONE[row.distribution.status]}
        />
      ),
    },
  ];

  return (
    <DetailSection>
      <CompactDetailTable columns={columns} rows={rows} rowKey={(row) => row.distribution.id} />
    </DetailSection>
  );
}

const PAGE_SIZE = 20;
const NO_EXPANDED = new Set<string>();

const STATEMENT_COLUMNS: FinancialReportColumn[] = [
  { key: "debit", labelKey: "investors.ledger.statement.debit" },
  { key: "credit", labelKey: "investors.ledger.statement.credit" },
];

/** Investor Engine Milestone 3, Phase 45/57 — the admin-facing Investor Statement, server-paginated, rendered as a financial report grid. */
export function StatementTab({ investorId }: { investorId: string }) {
  const { t } = useLocale();
  const [entries, setEntries] = useState<InvestorLedgerEntryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await investorLedgerService.statement(investorId, {
        page,
        pageSize: PAGE_SIZE,
      });
      setEntries(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [investorId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const textColumns = useMemo<FinancialReportTextColumn[]>(
    () => [
      { key: "date", labelKey: "investors.ledger.statement.date", width: 7 },
      {
        key: "type",
        labelKey: "investors.ledger.statement.type",
        width: 10,
        render: (line) => <StatusBadge label={line.text?.type ?? ""} tone="neutral" />,
      },
    ],
    [],
  );

  const lines = useMemo<FinancialReportLine[]>(
    () =>
      (entries ?? []).map((entry) => ({
        id: entry.id,
        parentId: null,
        kind: "posting",
        level: 0,
        label: entry.description,
        expandable: false,
        values: { debit: entry.debitAmount, credit: entry.creditAmount },
        text: {
          date: formatDate(entry.entryDate),
          type: t(`investors.ledger.entryType.${entry.type}` as MessageKey),
        },
        children: [],
      })),
    [entries, t],
  );

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!entries) return null;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DetailSection>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <FinancialReportView
          lines={lines}
          columns={STATEMENT_COLUMNS}
          textColumns={textColumns}
          expanded={NO_EXPANDED}
          onToggle={() => undefined}
          nameHeaderKey="investors.ledger.statement.description"
          emptyLabel={t("investors.ledger.statement.empty")}
        />
        <ReportPagination
          rangeLabel={t("investors.ledger.statement.range", {
            from: (page - 1) * PAGE_SIZE + 1,
            to: Math.min(page * PAGE_SIZE, total),
            total,
          })}
          page={page}
          pageCount={pageCount}
          isLoading={isLoading}
          onPageChange={setPage}
        />
      </div>
    </DetailSection>
  );
}
