"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { HandCoins } from "lucide-react";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { MoneyValue } from "@/components/shared/money-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";
import {
  paymentSettlementsService,
  type CurrencyTotals,
  type EligibleClaim,
} from "@/services/payment-settlements-service";
import { selectionTotals } from "./settlement-form";
import { ProviderBalanceCard, RecordLink } from "./settlement-parts";
import { SettleDialog } from "./settle-dialog";

/**
 * Matched & posted claims of one method still sitting in its clearing
 * account. Select claims of one currency → Settle → preview → confirm.
 */
export function AwaitingSettlementTab({ methodId }: { methodId: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canSettle = hasPermission("finance.payment-reconciliation.settle");

  const [items, setItems] = useState<EligibleClaim[]>([]);
  const [totalsByCurrency, setTotalsByCurrency] = useState<CurrencyTotals[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await paymentSettlementsService.eligible(methodId);
      setItems(result.items);
      setTotalsByCurrency(result.totalsByCurrency);
      setError(null);
      // Drop selections that are no longer eligible (settled elsewhere).
      setRowSelection((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([id]) => result.items.some((item) => item.id === id)),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [methodId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.filter((item) => rowSelection[item.id]),
    [items, rowSelection],
  );
  const selection = selectionTotals(selected);

  const columns = useMemo<ColumnDef<EligibleClaim, unknown>[]>(
    () => [
      {
        id: "claim",
        meta: {
          titleKey: "paymentSettlement.fields.claim" as MessageKey,
          stacked: true,
          importance: "critical",
        },
        accessorFn: (row) => `${row.paymentNumber} ${row.referenceNumber ?? ""}`,
        cell: (info) => (
          <StackedCell
            primary={<SemanticValue kind="id">{info.row.original.paymentNumber}</SemanticValue>}
            secondary={formatDate(info.row.original.paymentDate)}
          />
        ),
      },
      {
        id: "order",
        meta: {
          titleKey: "paymentSettlement.fields.order" as MessageKey,
          stacked: true,
          importance: "high",
        },
        accessorFn: (row) =>
          `${row.storeOrder?.internalOrderId ?? ""} ${row.customer?.name ?? row.senderName}`,
        cell: (info) => {
          const row = info.row.original;
          return (
            <StackedCell
              primary={
                <RecordLink
                  kind="STORE_ORDER"
                  id={row.storeOrder?.id}
                  label={row.storeOrder?.internalOrderId}
                />
              }
              secondary={row.customer?.name ?? row.senderName}
            />
          );
        },
      },
      {
        id: "receipt",
        meta: {
          titleKey: "paymentSettlement.fields.receipt" as MessageKey,
          stacked: true,
          importance: "medium",
        },
        accessorFn: (row) =>
          `${row.receipt?.transactionNumber ?? ""} ${row.receipt?.journalEntryNumber ?? ""}`,
        cell: (info) => {
          const receipt = info.row.original.receipt;
          return (
            <StackedCell
              primary={
                <RecordLink
                  kind="CUSTOMER_RECEIPT"
                  id={receipt?.id}
                  label={receipt?.transactionNumber}
                />
              }
              secondary={
                <RecordLink
                  kind="JOURNAL_ENTRY"
                  id={receipt?.journalEntryId}
                  label={receipt?.journalEntryNumber}
                />
              }
            />
          );
        },
      },
      {
        id: "amount",
        meta: {
          titleKey: "paymentSettlement.fields.amount" as MessageKey,
          align: "end",
          importance: "low",
          type: "money",
        },
        accessorFn: (row) => Number(row.amount),
        cell: (info) => (
          <MoneyValue value={info.row.original.amount} currency={info.row.original.currency} />
        ),
      },
      {
        id: "settled",
        meta: {
          titleKey: "paymentSettlement.fields.settled" as MessageKey,
          align: "end",
          importance: "low",
          type: "money",
        },
        accessorFn: (row) => Number(row.settledAmount),
        cell: (info) => (
          <MoneyValue
            value={info.row.original.settledAmount}
            currency={info.row.original.currency}
          />
        ),
      },
      {
        id: "remaining",
        meta: {
          titleKey: "paymentSettlement.fields.remaining" as MessageKey,
          align: "end",
          importance: "critical",
          type: "money",
        },
        accessorFn: (row) => Number(row.remainingAmount),
        cell: (info) => (
          <MoneyValue
            value={info.row.original.remainingAmount}
            currency={info.row.original.currency}
          />
        ),
      },
      {
        id: "status",
        meta: {
          titleKey: "paymentSettlement.fields.status" as MessageKey,
          importance: "medium",
          displayValue: (row, tr) =>
            tr(`paymentSettlement.claimStatus.${row.settlementStatus}` as MessageKey),
        },
        accessorFn: (row) => row.settlementStatus,
        cell: (info) => {
          const status = info.row.original.settlementStatus;
          return (
            <StatusBadge
              label={t(`paymentSettlement.claimStatus.${status}`)}
              tone={status === "PARTIALLY_SETTLED" ? "warning" : "info"}
            />
          );
        },
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-3">
      <ProviderBalanceCard methodId={methodId} refreshKey={refreshKey} />

      {totalsByCurrency.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("paymentSettlement.awaiting.totalsTitle")}
          </span>
          {totalsByCurrency.map((row) => (
            <span key={row.currency.id}>
              {row.currency.code}:{" "}
              {t("paymentSettlement.awaiting.totalsLine", {
                count: row.count,
                amount: formatMoney(row.remainingAmount, row.currency.code),
              })}
            </span>
          ))}
        </div>
      ) : null}

      <EnterpriseDataTable
        tableId={`payment-settlement-awaiting`}
        printTitle={t("paymentSettlement.awaiting.title")}
        columns={columns}
        data={items}
        isLoading={isLoading}
        error={error}
        onRetry={load}
        onRefresh={load}
        getRowId={(row) => row.id}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        searchPlaceholder={t("paymentSettlement.awaiting.searchPlaceholder")}
        emptyTitle={t("paymentSettlement.awaiting.empty")}
        bulkActions={
          <div className="flex flex-wrap items-center gap-2">
            {selection.mixedCurrency ? (
              <span className="text-caption text-warning-foreground">
                {t("paymentSettlement.awaiting.mixedCurrency")}
              </span>
            ) : (
              <span className="text-caption text-muted-foreground">
                {t("paymentSettlement.awaiting.selectedSummary", {
                  count: selection.count,
                  amount: formatMoney(selection.remaining, selection.currency?.code ?? null),
                })}
              </span>
            )}
            <EnterpriseButton
              type="button"
              size="sm"
              disabled={!canSettle || selection.count === 0 || selection.mixedCurrency}
              onClick={() => setDialogOpen(true)}
            >
              <HandCoins />
              {t("paymentSettlement.awaiting.settle")}
            </EnterpriseButton>
          </div>
        }
      />

      {canSettle && selected.length > 0 && !selection.mixedCurrency ? (
        <SettleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          methodId={methodId}
          claims={selected}
          onSettled={() => {
            setRowSelection({});
            setRefreshKey((key) => key + 1);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
