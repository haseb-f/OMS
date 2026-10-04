"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Printer, Scale } from "lucide-react";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { ErrorState } from "@/components/shared/error-state";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import {
  deductionBreakdown,
  entryTypeTone,
  isMemoLine,
  ledgerDrillDown,
  lineReference,
} from "@/config/agents/agent-finance";
import { buildAgentStatementPrintPayload } from "@/config/agents/agent-statement-print";
import {
  agentLedgerDescription,
  type LedgerTranslate,
} from "@/config/agents/agent-ledger-description";
import {
  agentFinanceService,
  type AgentStatement,
  type AgentStatementLine,
} from "@/services/agents-service";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatPeriod, toISODate } from "@/lib/date";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money";
import { apiErrorMessage } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { PayoutDetailDialog } from "./agent-payouts";
import { SummaryCard } from "./summary-card";
import { AdjustmentDialog } from "./agent-finance-dialogs";

const EMPTY_RANGE: DateRangeValue = { from: null, to: null };

function ReferenceCell({
  line,
  onOpenPayout,
}: {
  line: AgentStatementLine;
  onOpenPayout: (payoutId: string) => void;
}) {
  const { t } = useLocale();
  const drill = ledgerDrillDown(line);
  return (
    <span className="flex min-w-0 flex-col items-start">
      {drill.orderHref ? (
        <Link href={drill.orderHref} className="num text-primary hover:underline">
          {drill.orderLabel ?? lineReference(line)}
        </Link>
      ) : drill.payoutId ? (
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="inline"
          className="num text-primary"
          onClick={() => onOpenPayout(drill.payoutId!)}
        >
          {drill.payoutLabel ?? lineReference(line)}
        </EnterpriseButton>
      ) : (
        <span className="num">{lineReference(line)}</span>
      )}
      {drill.paymentLabel && drill.orderHref ? (
        <span className="num text-caption text-muted-foreground">{drill.paymentLabel}</span>
      ) : null}
      {drill.journalHref ? (
        <Link
          href={drill.journalHref}
          className="text-caption text-muted-foreground hover:underline"
        >
          {t("agents.statement.journal")} <span className="num">{drill.journalLabel}</span>
        </Link>
      ) : null}
    </span>
  );
}

function DescriptionCell({ line, currency }: { line: AgentStatementLine; currency: string }) {
  const { t } = useLocale();
  const memo = isMemoLine(line);
  const description = agentLedgerDescription(line, t);
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge
          label={t(`agents.entryType.${line.entryType}` as MessageKey)}
          tone={entryTypeTone(line)}
        />
        {memo ? (
          <StatusBadge
            label={t("agents.statement.memoAmount", {
              amount: formatMoney(line.memoAmount, currency),
            })}
            tone="neutral"
          />
        ) : null}
      </span>
      {description ? (
        <span className={memo ? "text-caption text-muted-foreground" : "text-caption"}>
          {description}
        </span>
      ) : null}
    </span>
  );
}

function buildColumns(
  currency: string,
  onOpenPayout: (payoutId: string) => void,
): ColumnDef<AgentStatementLine, unknown>[] {
  const amount = (
    id: "debit" | "credit",
    importance: "critical" | "high",
  ): ColumnDef<AgentStatementLine, unknown> => ({
    id,
    meta: { titleKey: `agents.statement.${id}`, type: "money", importance },
    enableSorting: false,
    accessorFn: (row) => row[id],
    // A line posts to one side: the unused side is blank (not applicable), not 0.00.
    cell: ({ row }) => (
      <ReportMoney value={row.original[id] || undefined} quiet={isMemoLine(row.original)} />
    ),
  });
  return [
    {
      id: "date",
      meta: {
        titleKey: "agents.statement.date",
        type: "date",
        importance: "critical",
        minWidth: 96,
      },
      enableSorting: false,
      accessorFn: (row) => formatBusinessDate(row.entryDate),
    },
    {
      id: "reference",
      meta: {
        titleKey: "agents.statement.reference",
        stacked: true,
        importance: "high",
        minWidth: 120,
      },
      enableSorting: false,
      accessorFn: (row) => lineReference(row),
      cell: ({ row }) => <ReferenceCell line={row.original} onOpenPayout={onOpenPayout} />,
    },
    {
      id: "description",
      meta: {
        titleKey: "agents.statement.description",
        stacked: true,
        importance: "critical",
        minWidth: 200,
        grow: 2,
        // Print / preview use the localized text, never the stored English audit text.
        displayValue: (row, t) => agentLedgerDescription(row, t as LedgerTranslate),
      },
      enableSorting: false,
      accessorFn: (row) => row.description,
      cell: ({ row }) => <DescriptionCell line={row.original} currency={currency} />,
    },
    amount("debit", "high"),
    amount("credit", "high"),
    {
      id: "balance",
      meta: { titleKey: "agents.statement.runningBalance", type: "money", importance: "critical" },
      enableSorting: false,
      accessorFn: (row) => row.balance,
      cell: ({ row }) => <ReportMoney value={row.original.balance} />,
    },
    {
      id: "posting",
      meta: {
        titleKey: "agents.statement.posting",
        type: "status",
        importance: "low",
        defaultHidden: true,
      },
      enableSorting: false,
      accessorFn: (row) => row.postingStatus,
      cell: ({ row }) => <PostingCell line={row.original} />,
    },
  ];
}

function PostingCell({ line }: { line: AgentStatementLine }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agents.postingStatus.${line.postingStatus}` as MessageKey)}
      tone={
        line.postingStatus === "POSTED"
          ? "success"
          : line.postingStatus === "PENDING_CONFIGURATION"
            ? "warning"
            : "neutral"
      }
    />
  );
}

const EXPORT_KEYS = [
  "date",
  "reference",
  "type",
  "description",
  "debit",
  "credit",
  "balance",
  "posting",
];

export function AgentStatementTab({ agentId }: { agentId: string }) {
  const { t } = useLocale();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { runPrint } = usePrintEngine();
  const canPrint = hasPermission("agents.statement.print");
  const canAdjust = hasPermission("agents.finance.adjust");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [statement, setStatement] = useState<AgentStatement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payoutId, setPayoutId] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      from: range.from ? toISODate(range.from) : undefined,
      to: range.to ? toISODate(range.to) : undefined,
    }),
    [range],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setStatement(await agentFinanceService.statement(agentId, params));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [agentId, params]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const currency = statement?.currency?.code ?? statement?.agent.currency?.code ?? "";
  const columns = useMemo(() => buildColumns(currency, setPayoutId), [currency]);
  const periodLabel =
    range.from || range.to
      ? formatPeriod(range.from, range.to, { from: t("datePicker.from"), to: t("datePicker.to") })
      : t("agents.statement.allDates");

  const print = () =>
    void runPrint("document", async () => {
      const data = await agentFinanceService.statementPrint(agentId, params);
      return buildAgentStatementPrintPayload(data, {
        title: t("agents.statement.printTitle"),
        partyLabel: t("agents.statement.party"),
        periodLabel,
        memoLabel: t("agents.statement.memo"),
        signNote: t("agents.signNote"),
        company: { name: activeCompany?.name ?? "", logoUrl: activeCompany?.logoUrl ?? null },
        printedByName: user?.fullName ?? null,
        typeLabel: (type) => t(`agents.entryType.${type}` as MessageKey),
        describe: (line) => agentLedgerDescription(line, t),
      });
    });

  // CSV keeps raw numbers (an empty cell when a value is missing).
  const exportRow = (line: AgentStatementLine): Record<string, string | number | null> => ({
    date: formatBusinessDate(line.entryDate),
    reference: lineReference(line),
    type: t(`agents.entryType.${line.entryType}` as MessageKey),
    description: isMemoLine(line)
      ? `${agentLedgerDescription(line, t)} (${t("agents.statement.memo")}: ${formatMoney(line.memoAmount)})`
      : agentLedgerDescription(line, t),
    // The unused side of a line is empty, not 0.
    debit: line.debit || null,
    credit: line.credit || null,
    balance: line.balance,
    posting: t(`agents.postingStatus.${line.postingStatus}` as MessageKey),
  });

  const summary = statement?.summary;
  const deductions = summary ? deductionBreakdown(summary) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EnterpriseDateRangePicker value={range} onChange={setRange} />
        <div className="flex flex-wrap gap-2">
          {canAdjust ? (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              disabled={!statement}
              onClick={() => setAdjustOpen(true)}
            >
              <Scale />
              {t("agents.adjustment.action")}
            </EnterpriseButton>
          ) : null}
          {canPrint ? (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              disabled={!statement}
              onClick={print}
            >
              <Printer />
              {t("agents.statement.print")}
            </EnterpriseButton>
          ) : null}
        </div>
      </div>
      <p className="text-caption text-muted-foreground">{t("agents.signNote")}</p>

      {loadError ? (
        <ErrorState description={loadError} onRetry={() => void load()} />
      ) : statement && summary && deductions ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title={t("agents.statement.salesTitle")}
              currency={currency}
              rows={[
                {
                  label: t("agents.statement.salesExShipping"),
                  value: summary.orders.merchandiseSalesExShipping,
                },
                {
                  label: t("agents.statement.customerShipping"),
                  value: summary.orders.customerShippingCharges,
                },
                {
                  label: t("agents.statement.serviceCharges"),
                  value: summary.orders.serviceCharges,
                },
                { label: t("agents.statement.discounts"), value: summary.orders.discounts },
                { label: t("agents.statement.tax"), value: summary.orders.tax },
                {
                  label: t("agents.statement.returns"),
                  value: summary.returns.merchandiseReturned,
                },
                {
                  label: t("agents.statement.refundsCompany"),
                  value: summary.refunds.paidByCompany,
                },
                { label: t("agents.statement.refundsAgent"), value: summary.refunds.paidByAgent },
                {
                  label: t("agents.statement.totalOrderValue"),
                  value: summary.orders.totalOrderValue,
                  emphasis: true,
                },
              ]}
            />
            <SummaryCard
              title={t("agents.statement.deductionsTitle")}
              currency={currency}
              rows={[
                { label: t("agents.statement.commissionBase"), value: summary.commission.base },
                // commission-policy.md A7: products vs services, never merged
                // with the shipping reimbursement (its own deduction row).
                {
                  label: t("agents.statement.productCommission"),
                  value: summary.commission.byClass.PRODUCT.commission,
                },
                {
                  label: t("agents.statement.serviceCommission"),
                  value: summary.commission.byClass.SERVICE.commission,
                },
                ...(summary.commission.legacySingleRate > 0
                  ? [
                      {
                        label: t("agents.statement.legacyCommission"),
                        value: summary.commission.legacySingleRate,
                      },
                    ]
                  : []),
                ...deductions.rows.map((row) => ({
                  label: t(`agents.statement.deductions.${row.key}` as MessageKey),
                  value: row.amount,
                })),
                {
                  label: t("agents.statement.totalDeductions"),
                  value: deductions.total,
                  emphasis: true,
                },
              ]}
            />
            <SummaryCard
              title={t("agents.statement.collectionsTitle")}
              currency={currency}
              rows={[
                {
                  label: t("agents.statement.collectedByCompany"),
                  value: summary.collections.byCompany,
                },
                {
                  label: t("agents.statement.collectedByAgent"),
                  value: summary.collections.byAgent,
                },
                {
                  label: t("agents.statement.adjustmentsCredit"),
                  value: summary.adjustments.credit,
                },
                { label: t("agents.statement.adjustmentsDebit"), value: summary.adjustments.debit },
                {
                  label: t("agents.statement.payoutsNet"),
                  value: summary.payouts.net,
                  emphasis: true,
                },
              ]}
            />
            <SummaryCard
              title={t("agents.statement.positionTitle")}
              currency={currency}
              rows={[
                { label: t("agents.statement.opening"), value: statement.openingBalance },
                { label: t("agents.statement.closing"), value: statement.closingBalance },
                { label: t("agents.statement.pending"), value: summary.position.pending },
                { label: t("agents.statement.paidOut"), value: summary.position.paidOut },
                { label: t("agents.statement.balance"), value: summary.position.balance },
                {
                  label: t("agents.statement.available"),
                  value: summary.position.available,
                  emphasis: true,
                },
              ]}
            />
          </div>

          <EnterpriseDataTable
            tableId="agent-statement"
            // A running-balance ledger: it reads as a sequence, and a card per line would
            // drop that order and headline an arbitrary figure. (The agent PORTAL statement
            // has its own line card that names the line's reference, debit, credit, balance.)
            gridView={false}
            printTitle={`${t("agents.statement.printTitle")} — ${statement.agent.name} (${periodLabel})`}
            columns={columns}
            data={statement.lines}
            isLoading={isLoading}
            onRefresh={() => void load()}
            getRowId={(row) => row.id}
            emptyTitle={t("agents.statement.empty")}
            exportColumns={exportColumnsFromKeys(
              columns,
              EXPORT_KEYS.filter((key) => key !== "type"),
              t,
            ).concat([{ key: "type", label: t("agents.statement.type") }])}
            onExport={(keys, labels) =>
              exportRowsToCsv(
                statement.lines.map(exportRow),
                keys,
                `${statement.agent.agentNumber}-statement.csv`,
                labels,
              )
            }
            footerRow={{
              description: t("agents.statement.closing"),
              debit: <ReportMoney value={statement.totals.debit} currency={currency} />,
              credit: <ReportMoney value={statement.totals.credit} currency={currency} />,
              balance: <ReportMoney value={statement.closingBalance} currency={currency} />,
            }}
          />
        </>
      ) : null}

      {adjustOpen && statement ? (
        <AdjustmentDialog
          agentId={agentId}
          agentLabel={`${statement.agent.name} · ${statement.agent.agentNumber}`}
          currency={currency}
          onOpenChange={setAdjustOpen}
          onRecorded={() => void load()}
        />
      ) : null}

      {payoutId ? (
        <PayoutDetailDialog
          payoutId={payoutId}
          onOpenChange={(open) => !open && setPayoutId(null)}
        />
      ) : null}
    </div>
  );
}
