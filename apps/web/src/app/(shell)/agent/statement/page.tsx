"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  Clock,
  HandCoins,
  Info,
  Landmark,
  Percent,
  Printer,
  Scale,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
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
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { SummaryCard } from "@/components/agents/summary-card";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import { entryTypeLabelKey } from "@/config/agent-portal/labels";
import {
  agentLedgerDescription,
  type LedgerTranslate,
} from "@/config/agents/agent-ledger-description";
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
import { PortalStatementGridCard } from "@/components/agent-portal/portal-grid-cards";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";
import { formatPeriod, toISODate } from "@/lib/date";
import { formatBusinessDate } from "@/lib/business-date";
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

/**
 * Debit / credit / balance cells: the shared report formatter (0.00 for a
 * genuine zero, red minus). A line posts to one side, so the unused
 * debit/credit side is blank (`side`), not 0.00.
 */
function AmountCell({
  value,
  memo = false,
  side = false,
}: {
  value: number | null;
  memo?: boolean;
  side?: boolean;
}) {
  return <ReportMoney value={side && !value ? undefined : value} quiet={memo} />;
}

function buildLedgerColumns(): ColumnDef<PortalStatementLine, unknown>[] {
  return [
    {
      id: "date",
      meta: { titleKey: "agentPortal.statement.fields.date", type: "date", importance: "critical" },
      accessorFn: (row) => formatBusinessDate(row.entryDate),
      cell: ({ row }) => <span className="num">{formatBusinessDate(row.original.entryDate)}</span>,
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
      meta: {
        titleKey: "agentPortal.statement.fields.description",
        type: "description",
        // Print / preview use the localized text, never the stored English audit text.
        displayValue: (row, t) => agentLedgerDescription(row, t as LedgerTranslate),
      },
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
      cell: ({ row }) => <AmountCell value={row.original.debit} memo={row.original.memo} side />,
    },
    {
      id: "credit",
      meta: { titleKey: "agentPortal.statement.fields.credit", type: "money" },
      accessorFn: (row) => row.credit,
      cell: ({ row }) => <AmountCell value={row.original.credit} memo={row.original.memo} side />,
    },
    {
      id: "balance",
      meta: {
        titleKey: "agentPortal.statement.fields.balance",
        type: "money",
        importance: "critical",
      },
      accessorFn: (row) => row.balance,
      cell: ({ row }) => <AmountCell value={row.original.balance} />,
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
  const money = (value: number | null) => (
    <ReportMoney value={value} currency={currency?.code} align="inline" />
  );
  const summary = statement?.summary;
  const periodLabel =
    query.from || query.to
      ? formatPeriod(query.from, query.to, { from: t("datePicker.from"), to: t("datePicker.to") })
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
          <InsightGroup className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <InsightCard
              icon={Landmark}
              label={t("agentPortal.statement.opening")}
              value={money(statement.openingBalance)}
              amount={statement.openingBalance}
            />
            <InsightCard
              icon={Scale}
              tone="info"
              label={t("agentPortal.statement.closing")}
              value={money(statement.closingBalance)}
              amount={statement.closingBalance}
            />
            <InsightCard
              icon={Clock}
              tone="warning"
              label={t("agentPortal.statement.summary.pending")}
              value={money(summary.position.pending)}
              amount={summary.position.pending}
            />
            <InsightCard
              icon={CheckCircle2}
              tone="success"
              label={t("agentPortal.statement.summary.available")}
              value={money(summary.position.available)}
              amount={summary.position.available}
            />
            <InsightCard
              icon={HandCoins}
              label={t("agentPortal.statement.summary.paidOut")}
              value={money(summary.position.paidOut)}
              amount={summary.position.paidOut}
            />
            <InsightCard
              icon={Wallet}
              tone="info"
              label={t("agentPortal.statement.summary.balance")}
              value={money(summary.position.balance)}
              amount={summary.position.balance}
            />
          </InsightGroup>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <SummaryCard
              tone="revenue"
              icon={ShoppingBag}
              title={t("agentPortal.statement.sections.sales")}
              currency={currency?.code ?? ""}
              rows={[
                {
                  label: t("agentPortal.statement.summary.salesExShipping"),
                  value: summary.orders.merchandiseSalesExShipping,
                },
                {
                  label: t("agentPortal.statement.summary.shippingCharges"),
                  value: summary.orders.customerShippingCharges,
                },
                {
                  label: t("agentPortal.statement.summary.discounts"),
                  value: summary.orders.discounts,
                },
                { label: t("agentPortal.statement.summary.tax"), value: summary.orders.tax },
                {
                  label: t("agentPortal.statement.summary.returns"),
                  value: summary.returns.merchandiseReturned,
                },
                {
                  label: t("agentPortal.statement.summary.refundsCompany"),
                  value: summary.refunds.paidByCompany,
                },
                {
                  label: t("agentPortal.statement.summary.refundsAgent"),
                  value: summary.refunds.paidByAgent,
                },
                {
                  label: t("agentPortal.statement.summary.totalOrderValue"),
                  value: summary.orders.totalOrderValue,
                  emphasis: true,
                },
              ]}
            />

            <SummaryCard
              tone="profit"
              icon={Percent}
              title={t("agentPortal.statement.sections.commission")}
              currency={currency?.code ?? ""}
              rows={[
                {
                  label: t("agentPortal.statement.summary.commissionBase"),
                  value: summary.commission.base,
                },
                {
                  label: t("agentPortal.statement.summary.productCommission"),
                  value: summary.commission.byClass.PRODUCT.commission,
                },
                {
                  label: t("agentPortal.statement.summary.serviceCommission"),
                  value: summary.commission.byClass.SERVICE.commission,
                },
                {
                  label: t("agentPortal.statement.summary.adjustments"),
                  value:
                    Math.round((summary.adjustments.credit - summary.adjustments.debit) * 100) /
                    100,
                },
                {
                  label: t("agentPortal.statement.summary.byCompany"),
                  value: summary.collections.byCompany,
                },
                {
                  label: t("agentPortal.statement.summary.byAgent"),
                  value: summary.collections.byAgent,
                },
                {
                  label: t("agentPortal.statement.summary.commission"),
                  value: summary.commission.net,
                  emphasis: true,
                },
              ]}
            />

            <div className="lg:col-span-2">
              <SummaryCard
                tone="warning"
                icon={Scale}
                title={t("agentPortal.statement.sections.deductions")}
                currency={currency?.code ?? ""}
                columns={2}
                rows={DEDUCTION_KEYS.map((key) => ({
                  label: t(`agentPortal.statement.deductions.${key}`),
                  value: summary.deductions[key],
                }))}
              />
            </div>
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
              date: formatBusinessDate(line.entryDate),
              type: `${t(entryTypeLabelKey(line.entryType))}${line.memo ? ` (${t("agentPortal.statement.memo")})` : ""}`,
              description:
                line.memo && line.memoAmount != null
                  ? `${agentLedgerDescription(line, t)} (${formatMoney(line.memoAmount, currency?.code ?? null)})`
                  : agentLedgerDescription(line, t),
              reference: portalLineReference(line),
              // The unused side of a line is empty, not 0.
              debit: line.debit || null,
              credit: line.credit || null,
              balance: line.balance,
            })),
            keys,
            `agent-statement-${locale}.csv`,
            labels,
          )
        }
        emptyTitle={t("agentPortal.statement.empty")}
        getRowId={(row) => row.id}
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <PortalStatementGridCard
            line={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
          />
        )}
      />
    </PageWorkspace>
  );
}
