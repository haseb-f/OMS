"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Info, Printer } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailSummaryBar,
} from "@/components/shared/detail-workspace";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import { entryTypeLabelKey } from "@/config/agent-portal/labels";
import { agentLedgerDescription } from "@/config/agents/agent-ledger-description";
import {
  buildPortalStatementPrintPayload,
  portalLineHref,
  portalLineReference,
} from "@/config/agent-portal/statement-print";
import {
  agentPortalService,
  type PortalStatement,
  type PortalStatementLine,
} from "@/services/agent-portal-service";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";
import { formatDate, formatDateRange, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

const EMPTY_RANGE: DateRangeValue = { from: null, to: null };
const EXPORT_KEYS = ["date", "type", "description", "reference", "debit", "credit", "balance"];
const DEDUCTION_KEYS = [
  "commission",
  "customerShippingRetained",
  "shippingFees",
  "returnFees",
  "serviceFees",
  "providerFees",
  "customerRefunds",
] as const;

function TypeCell({ line }: { line: PortalStatementLine }) {
  const { t } = useLocale();
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={line.memo ? "text-muted-foreground italic" : undefined}>
        {t(entryTypeLabelKey(line.entryType))}
      </span>
      {line.memo ? <StatusBadge label={t("agentPortal.statement.memo")} tone="neutral" /> : null}
    </span>
  );
}

function ReferenceCell({ line }: { line: PortalStatementLine }) {
  const href = portalLineHref(line);
  const label = portalLineReference(line);
  return href ? (
    <Link href={href} className="text-primary hover:underline">
      <SemanticValue kind="id">{label}</SemanticValue>
    </Link>
  ) : (
    <SemanticValue kind="id">{label}</SemanticValue>
  );
}

function DescriptionText({ line }: { line: PortalStatementLine }) {
  const { t } = useLocale();
  return (
    <span className={line.memo ? "text-muted-foreground" : undefined}>
      {agentLedgerDescription(line, t) || "—"}
    </span>
  );
}

function AmountCell({ value, memo }: { value: number; memo: boolean }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <MoneyValue value={value} className={memo ? "text-muted-foreground" : undefined} />;
}

function buildLedgerColumns(): ColumnDef<PortalStatementLine, unknown>[] {
  return [
    {
      id: "date",
      meta: { titleKey: "agentPortal.statement.fields.date", type: "date", importance: "critical" },
      accessorFn: (row) => formatDate(row.entryDate),
      cell: ({ row }) => <span className="num">{formatDate(row.original.entryDate)}</span>,
    },
    {
      id: "type",
      meta: {
        titleKey: "agentPortal.statement.fields.type",
        stacked: true,
        importance: "critical",
      },
      accessorFn: (row) => row.entryType,
      cell: ({ row }) => <TypeCell line={row.original} />,
    },
    {
      id: "description",
      meta: { titleKey: "agentPortal.statement.fields.description", type: "description" },
      accessorFn: (row) => row.description,
      cell: ({ row }) => (
        <StackedCell
          primary={<DescriptionText line={row.original} />}
          secondary={
            row.original.memo && row.original.memoAmount != null ? (
              <MoneyValue value={row.original.memoAmount} className="text-muted-foreground" />
            ) : undefined
          }
        />
      ),
    },
    {
      id: "reference",
      meta: {
        titleKey: "agentPortal.statement.fields.reference",
        type: "reference",
        importance: "high",
      },
      accessorFn: (row) => portalLineReference(row),
      cell: ({ row }) => <ReferenceCell line={row.original} />,
    },
    {
      id: "debit",
      meta: { titleKey: "agentPortal.statement.fields.debit", type: "money" },
      accessorFn: (row) => row.debit,
      cell: ({ row }) => <AmountCell value={row.original.debit} memo={row.original.memo} />,
    },
    {
      id: "credit",
      meta: { titleKey: "agentPortal.statement.fields.credit", type: "money" },
      accessorFn: (row) => row.credit,
      cell: ({ row }) => <AmountCell value={row.original.credit} memo={row.original.memo} />,
    },
    {
      id: "balance",
      meta: {
        titleKey: "agentPortal.statement.fields.balance",
        type: "money",
        importance: "critical",
      },
      accessorFn: (row) => row.balance,
      cell: ({ row }) => <MoneyValue value={row.original.balance} />,
    },
  ];
}

/**
 * Agent account statement (spec §8): period filter, summary, the plain-
 * language sign rule, the ledger with running balance (memo lines muted and
 * labelled), references linking to portal pages, export and landscape print.
 */
export default function AgentStatementPage() {
  const { t, locale } = useLocale();
  const { runPrint } = usePrintEngine();
  const printCompany = usePrintCompany();
  const [range, setRange] = usePathRestorableState<DateRangeValue>("range", EMPTY_RANGE);
  const [statement, setStatement] = useState<PortalStatement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      from: range.from ? toISODate(new Date(range.from)) : undefined,
      to: range.to ? toISODate(new Date(range.to)) : undefined,
    }),
    [range],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setStatement(await agentPortalService.statement(query));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildLedgerColumns(), []);
  const currency = statement?.currency ?? null;
  const money = (value: number) => <MoneyValue value={value} currency={currency} />;
  const summary = statement?.summary;
  const periodLabel =
    query.from || query.to
      ? formatDateRange(query.from ?? null, query.to ?? null)
      : t("agentPortal.statement.allDates");

  const print = () =>
    void runPrint(
      "document",
      async () => {
        const data = await agentPortalService.statementPrintData(query);
        return buildPortalStatementPrintPayload(data, {
          title: t("agentPortal.statement.printTitle"),
          partyLabel: t("agentPortal.statement.partyLabel"),
          periodLabel,
          memoLabel: t("agentPortal.statement.memo"),
          signNote: t("agentPortal.statement.signNote"),
          company: printCompany,
          typeLabel: (type) => t(entryTypeLabelKey(type)),
          describe: (line) => agentLedgerDescription(line, t),
        });
      },
      "agentPortal.common.loadFailed",
    );

  const footerRow = statement
    ? {
        type: <span className="font-semibold">{t("agentPortal.statement.closing")}</span>,
        debit: money(statement.totals.debit),
        credit: money(statement.totals.credit),
        balance: <span className="font-semibold">{money(statement.closingBalance)}</span>,
      }
    : undefined;

  return (
    <PageWorkspace
      title={t("agentPortal.statement.title")}
      description={t("agentPortal.statement.description")}
      actions={
        <HeaderActions
          secondary={[
            {
              key: "print",
              label: t("agentPortal.statement.print"),
              icon: Printer,
              disabled: !statement,
              onSelect: print,
            },
          ]}
          inline={<EnterpriseDateRangePicker value={range} onChange={setRange} />}
        />
      }
    >
      <p className="flex items-start gap-2 rounded-md border border-info-soft bg-info-soft px-3 py-2 text-caption text-info-soft-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("agentPortal.statement.signNote")}
      </p>

      {statement && summary ? (
        <>
          <DetailSummaryBar>
            <DetailField
              label={t("agentPortal.statement.opening")}
              value={money(statement.openingBalance)}
            />
            <DetailField
              label={t("agentPortal.statement.closing")}
              value={money(statement.closingBalance)}
            />
            <DetailField
              label={t("agentPortal.statement.summary.pending")}
              value={money(summary.position.pending)}
            />
            <DetailField
              label={t("agentPortal.statement.summary.available")}
              value={money(summary.position.available)}
            />
            <DetailField
              label={t("agentPortal.statement.summary.paidOut")}
              value={money(summary.position.paidOut)}
            />
            <DetailField
              label={t("agentPortal.statement.summary.balance")}
              value={money(summary.position.balance)}
            />
          </DetailSummaryBar>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <DetailSection title={t("agentPortal.statement.sections.sales")}>
              <DetailFieldGrid>
                <DetailField
                  label={t("agentPortal.statement.summary.salesExShipping")}
                  value={money(summary.orders.merchandiseSalesExShipping)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.shippingCharges")}
                  value={money(summary.orders.customerShippingCharges)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.totalOrderValue")}
                  value={money(summary.orders.totalOrderValue)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.discounts")}
                  value={money(summary.orders.discounts)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.tax")}
                  value={money(summary.orders.tax)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.returns")}
                  value={money(summary.returns.merchandiseReturned)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.refundsCompany")}
                  value={money(summary.refunds.paidByCompany)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.refundsAgent")}
                  value={money(summary.refunds.paidByAgent)}
                />
              </DetailFieldGrid>
            </DetailSection>

            <DetailSection title={t("agentPortal.statement.sections.commission")}>
              <DetailFieldGrid>
                <DetailField
                  label={t("agentPortal.statement.summary.commissionBase")}
                  value={money(summary.commission.base)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.commissionRate")}
                  value={
                    summary.commission.ratePercent != null ? (
                      <span className="num">{summary.commission.ratePercent}%</span>
                    ) : (
                      "—"
                    )
                  }
                />
                <DetailField
                  label={t("agentPortal.statement.summary.commission")}
                  value={money(summary.commission.net)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.adjustments")}
                  value={money(
                    Math.round((summary.adjustments.credit - summary.adjustments.debit) * 100) /
                      100,
                  )}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.byCompany")}
                  value={money(summary.collections.byCompany)}
                />
                <DetailField
                  label={t("agentPortal.statement.summary.byAgent")}
                  value={money(summary.collections.byAgent)}
                />
              </DetailFieldGrid>
            </DetailSection>

            <DetailSection
              title={t("agentPortal.statement.sections.deductions")}
              className="lg:col-span-2"
            >
              <DetailFieldGrid columns={4}>
                {DEDUCTION_KEYS.map((key) => (
                  <DetailField
                    key={key}
                    label={t(`agentPortal.statement.deductions.${key}`)}
                    value={money(summary.deductions[key])}
                  />
                ))}
              </DetailFieldGrid>
            </DetailSection>
          </div>
        </>
      ) : null}

      <EnterpriseDataTable
        tableId="agent-portal-statement"
        printTitle={`${t("agentPortal.statement.printTitle")} — ${periodLabel}`}
        columns={columns}
        data={statement?.lines ?? []}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        footerRow={footerRow}
        exportColumns={exportColumnsFromKeys(columns, EXPORT_KEYS, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            (statement?.lines ?? []).map((line) => ({
              date: formatDate(line.entryDate),
              type: `${t(entryTypeLabelKey(line.entryType))}${line.memo ? ` (${t("agentPortal.statement.memo")})` : ""}`,
              description:
                line.memo && line.memoAmount != null
                  ? `${agentLedgerDescription(line, t)} (${formatMoney(line.memoAmount, currency?.code ?? null)})`
                  : agentLedgerDescription(line, t),
              reference: portalLineReference(line),
              debit: line.debit,
              credit: line.credit,
              balance: line.balance,
            })),
            keys,
            `agent-statement-${locale}.csv`,
            labels,
          )
        }
        emptyTitle={t("agentPortal.statement.empty")}
        getRowId={(row) => row.id}
      />
    </PageWorkspace>
  );
}
