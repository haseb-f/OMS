"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Undo2 } from "lucide-react";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu } from "@/components/shared/data-table";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, toISODate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";
import {
  paymentSettlementsService,
  type SettlementDocStatus,
  type SettlementSummary,
} from "@/services/payment-settlements-service";
import { RecordLink } from "./settlement-parts";
import { SettlementDetailSheet, ReverseSettlementDialog } from "./settlement-detail-sheet";

const STATUSES: SettlementDocStatus[] = ["POSTED", "REVERSED"];

/** Settlement register of one method: filters, detail drawer and (permissioned) reversal. */
export function SettlementsTab({ methodId }: { methodId: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCorrect = hasPermission("finance.payment-reconciliation.correct");

  const [items, setItems] = useState<SettlementSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SettlementDocStatus | "">("");
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<SettlementSummary | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await paymentSettlementsService.list({
        paymentMethodId: methodId,
        status: status || undefined,
        dateFrom: range.from ? toISODate(range.from) : undefined,
        dateTo: range.to ? toISODate(range.to) : undefined,
        search: search || undefined,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [methodId, status, range, search, page, pageSize, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<SettlementSummary, unknown>[]>(
    () => [
      {
        id: "settlementNumber",
        meta: {
          titleKey: "paymentSettlement.fields.settlementNumber" as MessageKey,
          stacked: true,
          importance: "critical",
        },
        cell: (info) => (
          <StackedCell
            primary={<SemanticValue kind="id">{info.row.original.settlementNumber}</SemanticValue>}
            secondary={formatDate(info.row.original.settlementDate)}
          />
        ),
      },
      {
        id: "providerReference",
        meta: {
          titleKey: "paymentSettlement.fields.providerReference" as MessageKey,
          stacked: true,
          importance: "medium",
        },
        cell: (info) => (
          <StackedCell
            primary={
              info.row.original.providerReference ? (
                <SemanticValue kind="id">{info.row.original.providerReference}</SemanticValue>
              ) : null
            }
            secondary={info.row.original.receivingAccount.name}
          />
        ),
      },
      {
        id: "gross",
        meta: {
          titleKey: "paymentSettlement.fields.gross" as MessageKey,
          align: "end",
          importance: "high",
        },
        cell: (info) => (
          <MoneyValue value={info.row.original.grossAmount} currency={info.row.original.currency} />
        ),
      },
      {
        id: "received",
        meta: {
          titleKey: "paymentSettlement.fields.received" as MessageKey,
          align: "end",
          importance: "medium",
        },
        cell: (info) => (
          <MoneyValue
            value={info.row.original.receivedAmount}
            currency={info.row.original.receivedCurrency}
          />
        ),
      },
      {
        id: "fee",
        meta: {
          titleKey: "paymentSettlement.fields.fee" as MessageKey,
          align: "end",
          importance: "low",
        },
        cell: (info) => (
          <MoneyValue value={info.row.original.feeAmount} currency={info.row.original.currency} />
        ),
      },
      {
        id: "journal",
        meta: {
          titleKey: "paymentSettlement.fields.journal" as MessageKey,
          stacked: true,
          importance: "low",
        },
        cell: (info) => (
          <StackedCell
            primary={
              <RecordLink
                kind="JOURNAL_ENTRY"
                id={info.row.original.journalEntry?.id}
                label={info.row.original.journalEntry?.entryNumber}
              />
            }
            secondary={
              <RecordLink
                kind="JOURNAL_ENTRY"
                id={info.row.original.reversalJournalEntry?.id}
                label={info.row.original.reversalJournalEntry?.entryNumber}
              />
            }
          />
        ),
      },
      {
        id: "status",
        meta: { titleKey: "paymentSettlement.fields.status" as MessageKey, importance: "high" },
        cell: (info) => {
          const value = info.row.original.status;
          return (
            <StatusBadge
              label={t(`paymentSettlement.docStatus.${value}`)}
              tone={value === "POSTED" ? "success" : "warning"}
            />
          );
        },
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" as MessageKey },
        enableSorting: false,
        enableHiding: false,
        cell: (info) => {
          const row = info.row.original;
          return (
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "view",
                  label: t("common.view"),
                  icon: Eye,
                  onSelect: () => setDetailId(row.id),
                },
                {
                  key: "reverse",
                  label: t("paymentSettlement.reverse.action"),
                  icon: Undo2,
                  destructive: true,
                  separatorBefore: true,
                  hidden: !canCorrect || row.status !== "POSTED",
                  onSelect: () => setReverseTarget(row),
                },
              ]}
            />
          );
        },
      },
    ],
    [t, canCorrect],
  );

  return (
    <>
      <EnterpriseDataTable
        tableId="payment-settlements"
        printTitle={t("paymentSettlement.list.title")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("paymentSettlement.list.searchPlaceholder")}
        filterBar={
          <div className="flex flex-wrap items-center gap-2">
            <SelectFilter
              label={t("paymentSettlement.fields.status")}
              value={status}
              onChange={(value) => {
                setStatus(value as SettlementDocStatus | "");
                setPage(1);
              }}
              allLabel={t("paymentSettlement.docStatus.ALL")}
              options={STATUSES.map((value) => ({
                value,
                label: t(`paymentSettlement.docStatus.${value}`),
              }))}
            />
            <EnterpriseDateRangePicker
              value={range}
              onChange={(value) => {
                setRange(value);
                setPage(1);
              }}
            />
          </div>
        }
        isLoading={isLoading}
        error={error}
        onRetry={load}
        onRefresh={load}
        getRowId={(row) => row.id}
        emptyTitle={t("paymentSettlement.list.empty")}
      />

      <SettlementDetailSheet
        settlementId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        canCorrect={canCorrect}
        onReversed={() => void load()}
      />

      <ReverseSettlementDialog
        settlement={reverseTarget}
        onOpenChange={(open) => {
          if (!open) setReverseTarget(null);
        }}
        onReversed={() => {
          setReverseTarget(null);
          void load();
        }}
      />
    </>
  );
}
