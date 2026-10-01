"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
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
import { MoneyValue } from "@/components/shared/money-value";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { DetailSection } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import {
  carrierCostStage,
  formatCurrencyAmounts,
  shippingSettlement,
  type CarrierCostStage,
  type ShippingSettlement,
} from "@/config/agents/commission-report";
import type {
  AgentCommissionReport,
  CommissionReportLine,
  CommissionReportOrder,
} from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDateRange, toISODate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { apiErrorMessage } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { SummaryCard } from "./summary-card";

const EMPTY_RANGE: DateRangeValue = { from: null, to: null };
const EXPORT_KEYS = [
  "order",
  "item",
  "class",
  "sales",
  "base",
  "rate",
  "source",
  "commission",
  "reversed",
];
const CARRIER_TONE: Record<CarrierCostStage, "neutral" | "info" | "warning"> = {
  NONE: "neutral",
  ESTIMATED: "neutral",
  AWAITING_APPROVAL: "warning",
  APPROVED: "info",
};
const SETTLEMENT_TONE: Record<ShippingSettlement, "success" | "warning" | "neutral"> = {
  SETTLED: "success",
  COMPANY_BEARS_SHORTFALL: "warning",
  COMPANY_KEEPS_EXCESS: "neutral",
  NO_AGENT_CHARGE: "neutral",
};

/**
 * Agent commission report (commission-policy.md A7) — item-level commission
 * by item type, the shipping settlement (customer shipping retained against
 * the predetermined agent charge; actual carrier cost shown apart), other charges and the net
 * entitlement (earned view), next to the cash view (collected, available,
 * paid out). Shared by the internal workspace and the agent portal; the
 * caller supplies the scoped loader and the order link.
 */
export function AgentCommissionReportView({
  load,
  orderHref,
  exportName,
}: {
  load: (params: { from?: string; to?: string }) => Promise<AgentCommissionReport>;
  orderHref: (storeOrderId: string) => string;
  exportName: string;
}) {
  const { t, locale } = useLocale();
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [report, setReport] = useState<AgentCommissionReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      from: range.from ? toISODate(range.from) : undefined,
      to: range.to ? toISODate(range.to) : undefined,
    }),
    [range],
  );

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setReport(await load(params));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [load, params]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const currency = report?.summary.currency.code ?? "";
  const itemName = useCallback(
    (row: CommissionReportLine) =>
      row.productId
        ? `${row.sku ?? ""} — ${(locale === "en" ? row.nameEn : null) ?? row.name ?? ""}`
        : t("agents.commission.report.legacyAllItems"),
    [locale, t],
  );
  const columns = useMemo(
    () => buildLineColumns(currency, t, itemName, orderHref),
    [currency, t, itemName, orderHref],
  );
  const periodLabel =
    range.from || range.to ? formatDateRange(range.from, range.to) : t("agents.statement.allDates");

  if (loadError) return <ErrorState description={loadError} onRetry={() => void reload()} />;
  const summary = report?.summary;
  const cash = report?.cash;
  // Spec 2 (2E): carrier cost and margin exist only in the internal report —
  // the portal response never carries them, so the portal never shows them.
  const carrierCost = summary?.carrierCost;

  const orderColumns: CompactDetailColumn<CommissionReportOrder>[] = [
    {
      id: "order",
      header: t("agents.commission.report.order"),
      cell: (row) => (
        <Link href={orderHref(row.storeOrderId)} className="num text-primary hover:underline">
          {row.orderNumber}
        </Link>
      ),
    },
    {
      id: "customerShipping",
      header: t("agents.commission.report.customerShipping"),
      align: "end",
      cell: (row) => <MoneyValue value={row.shipping.customerShipping} currency={currency} />,
    },
    {
      id: "agentShippingCharge",
      header: t("agents.commission.report.agentShippingCharge"),
      align: "end",
      cell: (row) =>
        row.shipping.agentShippingCharge == null ? (
          "—"
        ) : (
          <MoneyValue value={row.shipping.agentShippingCharge} currency={currency} />
        ),
    },
    {
      id: "retained",
      header: t("agents.commission.report.shippingRetained"),
      align: "end",
      cell: (row) => <MoneyValue value={row.shipping.retained} currency={currency} />,
    },
    {
      id: "settlement",
      header: t("agents.commission.report.settlement"),
      cell: (row) => {
        const settlement = shippingSettlement(row.shipping);
        return (
          <StatusBadge
            label={t(`agents.commission.report.settlements.${settlement}` as MessageKey)}
            tone={SETTLEMENT_TONE[settlement]}
          />
        );
      },
    },
    ...(carrierCost
      ? [
          {
            id: "carrier",
            header: t("agents.commission.report.carrierCost"),
            align: "end" as const,
            cell: (row: CommissionReportOrder) => {
              const carrier = row.shipping.carrier;
              if (!carrier) return "—";
              const stage = carrierCostStage(carrier);
              return (
                <span className="flex flex-col items-end gap-0.5">
                  <span className="num">
                    {stage === "ESTIMATED"
                      ? formatAmount(carrier.estimated)
                      : formatCurrencyAmounts(carrier.approvedByCurrency)}
                  </span>
                  <StatusBadge
                    label={t(`agents.commission.report.carrierStages.${stage}` as MessageKey)}
                    tone={CARRIER_TONE[stage]}
                  />
                </span>
              );
            },
          },
          {
            id: "margin",
            header: t("agentPricing.report.margin"),
            align: "end" as const,
            cell: (row: CommissionReportOrder) =>
              row.shipping.margin?.amount != null ? (
                <MoneyValue value={row.shipping.margin.amount} currency={currency} />
              ) : (
                "—"
              ),
          },
        ]
      : []),
    {
      id: "commission",
      header: t("agents.commission.report.commission"),
      align: "end",
      cell: (row) => <MoneyValue value={row.commissionNet} currency={currency} />,
    },
    {
      id: "net",
      header: t("agents.commission.report.netEntitlement"),
      align: "end",
      cell: (row) => <MoneyValue value={row.netEntitlement} currency={currency} />,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EnterpriseDateRangePicker value={range} onChange={setRange} />
        <span className="text-caption text-muted-foreground">
          {t("agents.commission.report.scopeNote")}
        </span>
      </div>

      {summary && cash ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title={t("agents.commission.report.productsTitle")}
            currency={currency}
            rows={[
              { label: t("agents.commission.report.sales"), value: summary.products.sales },
              { label: t("agents.commission.report.base"), value: summary.products.commissionBase },
              {
                label: t("agents.commission.report.reversed"),
                value: summary.products.commissionReversed,
              },
              {
                label: t("agents.commission.report.commission"),
                value: summary.products.commission,
                emphasis: true,
              },
            ]}
          />
          <SummaryCard
            title={t("agents.commission.report.servicesTitle")}
            currency={currency}
            rows={[
              { label: t("agents.commission.report.sales"), value: summary.services.sales },
              { label: t("agents.commission.report.base"), value: summary.services.commissionBase },
              {
                label: t("agents.commission.report.reversed"),
                value: summary.services.commissionReversed,
              },
              {
                label: t("agents.commission.report.commission"),
                value: summary.services.commission,
                emphasis: true,
              },
            ]}
          />
          <SummaryCard
            title={t("agents.commission.report.entitlementTitle")}
            currency={currency}
            rows={[
              { label: t("agents.commission.report.totalSales"), value: summary.totalSales },
              {
                label: t("agents.commission.report.customerCharges"),
                value: summary.customerCharges,
              },
              { label: t("agents.commission.report.returned"), value: summary.returned },
              {
                label: t("agents.commission.report.totalCommission"),
                value: summary.totalCommission,
              },
              {
                label: t("agents.commission.report.shippingRetained"),
                value: summary.shippingRetained,
              },
              { label: t("agents.commission.report.otherCharges"), value: summary.otherCharges },
              {
                label: t("agents.commission.report.netEntitlement"),
                value: summary.netEntitlement,
                emphasis: true,
              },
            ]}
          />
          <SummaryCard
            title={t("agents.commission.report.cashTitle")}
            currency={currency}
            rows={[
              {
                label: t("agents.commission.report.collectedByCompany"),
                value: cash.collectedByCompany,
              },
              {
                label: t("agents.commission.report.collectedByAgent"),
                value: cash.collectedByAgent,
              },
              {
                label: t("agents.commission.report.refundsByCompany"),
                value: cash.customerRefundsByCompany,
              },
              { label: t("agents.commission.report.pending"), value: cash.pending },
              { label: t("agents.commission.report.paidOut"), value: cash.paidOut },
              { label: t("agents.commission.report.balance"), value: cash.balance },
              {
                label: t("agents.commission.report.available"),
                value: cash.availableForPayout,
                emphasis: true,
              },
            ]}
          />
        </div>
      ) : null}
      {summary ? (
        <p className="text-caption text-muted-foreground">
          {carrierCost ? (
            <>
              {t("agents.commission.report.entitlementNote")}
              {carrierCost.ordersAwaitingApproval + carrierCost.ordersWithEstimateOnly > 0
                ? ` ${t("agents.commission.report.carrierPendingNote", {
                    awaiting: carrierCost.ordersAwaitingApproval,
                    estimated: carrierCost.ordersWithEstimateOnly,
                  })}`
                : ""}
            </>
          ) : (
            t("agentPricing.report.portalNote")
          )}
        </p>
      ) : null}

      <EnterpriseDataTable
        tableId="agent-commission-report"
        printTitle={`${t("agents.commission.report.title")} — ${periodLabel}`}
        columns={columns}
        data={report?.lines ?? []}
        isLoading={isLoading}
        onRefresh={() => void reload()}
        getRowId={(row) => `${row.storeOrderId}-${row.productId ?? "legacy"}`}
        emptyTitle={t("agents.commission.report.empty")}
        exportColumns={exportColumnsFromKeys(columns, EXPORT_KEYS, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            (report?.lines ?? []).map((row) => ({
              order: row.orderNumber,
              item: itemName(row),
              class: row.commissionClass
                ? t(`agents.commission.classes.${row.commissionClass}` as MessageKey)
                : "",
              sales: formatAmount(row.salesAmount),
              base: row.commissionBase != null ? formatAmount(row.commissionBase) : "",
              rate: row.ratePercent != null ? `${formatAmount(row.ratePercent)}%` : "",
              source: t(`agents.commission.sources.${row.rateSource}` as MessageKey),
              commission: formatAmount(row.commission),
              reversed: formatAmount(row.commissionReversed),
            })),
            keys,
            exportName,
            labels,
          )
        }
      />

      {report && report.orders.length > 0 ? (
        <DetailSection title={t("agents.commission.report.shippingTitle")}>
          <CompactDetailTable
            rows={report.orders}
            columns={orderColumns}
            rowKey={(row) => row.storeOrderId}
          />
        </DetailSection>
      ) : null}
    </div>
  );
}

function buildLineColumns(
  currency: string,
  t: (key: MessageKey) => string,
  itemName: (row: CommissionReportLine) => string,
  orderHref: (storeOrderId: string) => string,
): ColumnDef<CommissionReportLine, unknown>[] {
  const money = (
    id: string,
    get: (row: CommissionReportLine) => number | null,
    importance: "critical" | "high" | "medium" = "high",
  ): ColumnDef<CommissionReportLine, unknown> => ({
    id,
    meta: { titleKey: `agents.commission.report.${id}` as MessageKey, type: "money", importance },
    enableSorting: false,
    accessorFn: (row) => get(row),
    cell: ({ row }) => {
      const value = get(row.original);
      return value == null ? "—" : <MoneyValue value={value} currency={currency} />;
    },
  });
  return [
    {
      id: "order",
      meta: { titleKey: "agents.commission.report.order", importance: "critical" },
      enableSorting: false,
      accessorFn: (row) => row.orderNumber,
      cell: ({ row }) => (
        <Link
          href={orderHref(row.original.storeOrderId)}
          className="num text-primary hover:underline"
        >
          {row.original.orderNumber}
        </Link>
      ),
    },
    {
      id: "item",
      meta: { titleKey: "agents.commission.report.item", importance: "critical", minWidth: 180 },
      enableSorting: false,
      accessorFn: (row) => itemName(row),
    },
    {
      id: "class",
      meta: { titleKey: "agents.commission.report.class", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) =>
        row.commissionClass
          ? t(`agents.commission.classes.${row.commissionClass}` as MessageKey)
          : "—",
    },
    money("sales", (row) => row.salesAmount),
    money("base", (row) => row.commissionBase, "medium"),
    {
      id: "rate",
      meta: { titleKey: "agents.commission.report.rate", type: "number", importance: "high" },
      enableSorting: false,
      accessorFn: (row) => row.ratePercent,
      cell: ({ row }) =>
        row.original.ratePercent == null ? (
          "—"
        ) : (
          <span className="num">{formatAmount(row.original.ratePercent)}%</span>
        ),
    },
    {
      id: "source",
      meta: { titleKey: "agents.commission.report.source", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => t(`agents.commission.sources.${row.rateSource}` as MessageKey),
    },
    money("commission", (row) => row.commission, "critical"),
    money("reversed", (row) => row.commissionReversed, "medium"),
  ];
}
