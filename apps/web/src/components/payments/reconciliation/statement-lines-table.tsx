"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, GitCompareArrows, RotateCcw, Undo2, Unlink } from "lucide-react";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu, type RowAction } from "@/components/shared/data-table";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { StatementLineBadge } from "@/components/payments/payment-term-badge";
import { StatementLineKindBadge } from "./line-kind-badge";
import { paymentTerm, statementLineTerm } from "@/config/payments/payment-vocabulary";
import { isSettled } from "@/components/payments/match-panel/match-panel-model";
import { MoneyValue } from "@/components/shared/money-value";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  paymentReconciliationService,
  type StatementLine,
  type StatementLineMatch,
  type StatementLineStatus,
} from "@/services/payment-reconciliation-service";
import { ReasonDialog } from "./reason-dialog";
import { fetchAllPages } from "@/lib/fetch-all-pages";

const ALL_STATUSES: StatementLineStatus[] = ["UNMATCHED", "MATCHED", "EXCEPTION", "IGNORED"];

/** Claim → order → receipt → JE chips for one allocation (the related-record trail). */
export function MatchTrail({ match }: { match: StatementLineMatch }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <RelatedRecordLink
        kind="PAYMENT"
        id={match.payment.id}
        number={match.payment.paymentNumber}
        status={match.payment.status}
        settlementStatus={match.payment.settlementStatus}
      />
      {match.storeOrder ? (
        <RelatedRecordLink
          kind="STORE_ORDER"
          id={match.storeOrder.id}
          number={match.storeOrder.internalOrderId}
        />
      ) : null}
      {match.receipt ? (
        <RelatedRecordLink
          kind="CUSTOMER_RECEIPT"
          id={match.receipt.id}
          number={match.receipt.transactionNumber}
          status={match.receipt.status}
        />
      ) : null}
      {match.journalEntry ? (
        <RelatedRecordLink
          kind="JOURNAL_ENTRY"
          id={match.journalEntry.id}
          number={match.journalEntry.entryNumber}
        />
      ) : null}
    </div>
  );
}

type PendingAction =
  | { kind: "ignore"; line: StatementLine }
  | { kind: "reverse"; line: StatementLine; match: StatementLineMatch };

/**
 * Statement lines with provenance (source · file/sheet · row) and the
 * claim → order → receipt → JE trail. Used by the Statement tab (all
 * statuses) and the Exceptions tab (`statuses` = EXCEPTION / IGNORED).
 */
export function StatementLinesTable({
  methodId,
  tableId,
  statuses = ALL_STATUSES,
  defaultStatus,
  refreshKey,
  canMatch,
  canCorrect,
  onMatchLine,
  onChanged,
  emptyTitle,
}: {
  methodId: string;
  tableId: string;
  statuses?: StatementLineStatus[];
  defaultStatus?: StatementLineStatus;
  refreshKey?: unknown;
  canMatch: boolean;
  canCorrect: boolean;
  onMatchLine?: (line: StatementLine) => void;
  onChanged?: () => void;
  emptyTitle: string;
}) {
  const { t } = useLocale();
  const [items, setItems] = useState<StatementLine[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<StatementLineStatus | "">(defaultStatus ?? "");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const listFilters = useMemo(
    () => ({ status: status || undefined, search: search || undefined }),
    [status, search],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await paymentReconciliationService.listLines(methodId, {
        ...listFilters,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [methodId, listFilters, page, pageSize, t]);

  // Print: every line matching the current filters, not just the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        paymentReconciliationService.listLines(methodId, {
          ...listFilters,
          page: nextPage,
          pageSize: nextPageSize,
        }),
      ),
    [methodId, listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  const afterChange = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  const isReversal = (match: StatementLineMatch) => match.reversalEffect === "REVERSE_POSTING";
  const correctionSentence = (match: StatementLineMatch) => {
    const line = pending?.kind === "reverse" ? pending.line : null;
    const params = {
      amount: formatMoney(match.amount, line?.currency.code),
      reference: line?.providerReference ?? line?.orderReference ?? "—",
      payment: match.payment.paymentNumber,
    };
    return isReversal(match)
      ? t("paymentVocabulary.effect.reversePosting", {
          ...params,
          receipt: match.receipt?.transactionNumber ?? "—",
          journal: match.journalEntry?.entryNumber ?? "—",
        })
      : t("paymentVocabulary.effect.unmatch", params);
  };

  const reopen = useCallback(
    async (line: StatementLine) => {
      try {
        await paymentReconciliationService.reopenLine(methodId, line.id);
        toast.success(t("paymentReconciliation.exceptions.reopened"));
        afterChange();
      } catch (error) {
        reportApiError(error, t("common.failedToSave"));
      }
    },
    [methodId, t, afterChange],
  );

  const columns = useMemo<ColumnDef<StatementLine, unknown>[]>(
    () => [
      {
        id: "date",
        header: t("paymentReconciliation.fields.transactionDate"),
        meta: { titleKey: "paymentReconciliation.fields.transactionDate" as MessageKey },
        accessorFn: (row) => formatDate(row.transactionDate),
      },
      {
        id: "reference",
        header: t("paymentReconciliation.fields.providerReference"),
        meta: { titleKey: "paymentReconciliation.fields.providerReference" as MessageKey },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span dir="ltr" className="truncate font-medium">
              {row.original.providerReference ?? "—"}
            </span>
            {row.original.orderReference ? (
              <span dir="ltr" className="truncate text-caption text-muted-foreground">
                {row.original.orderReference}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "customer",
        header: t("paymentReconciliation.fields.customerName"),
        meta: { titleKey: "paymentReconciliation.fields.customerName" as MessageKey },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate">{row.original.customerName ?? "—"}</span>
            {row.original.customerPhone ? (
              <span dir="ltr" className="truncate text-caption text-muted-foreground">
                {row.original.customerPhoneE164 ?? row.original.customerPhone}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "amount",
        header: t("paymentReconciliation.fields.amount"),
        meta: {
          titleKey: "paymentReconciliation.fields.amount" as MessageKey,
          align: "end",
          type: "money",
        },
        cell: ({ row }) => (
          <div className="flex flex-col items-end">
            <MoneyValue value={row.original.amount} currency={row.original.currency} />
            {row.original.feeAmount !== null ? (
              <span dir="ltr" className="text-caption text-muted-foreground">
                {t("paymentReconciliation.fields.fee")}{" "}
                {formatMoney(row.original.feeAmount, row.original.currency.code)}
              </span>
            ) : null}
            {row.original.matchedAmount > 0 && row.original.remaining > 0 ? (
              <span dir="ltr" className="text-caption text-warning-foreground">
                {t("paymentReconciliation.fields.remaining")}{" "}
                {formatMoney(row.original.remaining, row.original.currency.code)}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        header: t("paymentReconciliation.fields.status"),
        meta: { titleKey: "paymentReconciliation.fields.status" as MessageKey },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* A refund / chargeback awaiting review shows that state instead of "unmatched". */}
            {row.original.kind && row.original.kind !== "PAYMENT" ? (
              row.original.status === "UNMATCHED" ? (
                <StatementLineKindBadge kind={row.original.kind} review />
              ) : (
                <>
                  <StatementLineBadge status={row.original.status} />
                  <StatementLineKindBadge kind={row.original.kind} />
                </>
              )
            ) : (
              <StatementLineBadge status={row.original.status} />
            )}
            {row.original.exceptionReason ? (
              <span className="text-caption text-muted-foreground">
                {row.original.exceptionReason}
              </span>
            ) : null}
            {row.original.providerStatus ? (
              <span className="text-caption text-muted-foreground" dir="auto">
                {row.original.providerStatus}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "matchedTo",
        header: t("paymentReconciliation.statement.matchedTo"),
        meta: { titleKey: "paymentReconciliation.statement.matchedTo" as MessageKey },
        cell: ({ row }) => {
          const active = row.original.matches.filter((match) => match.status === "ACTIVE");
          if (active.length === 0) return "—";
          return (
            <div className="flex min-w-0 flex-col gap-1">
              {active.map((match) => (
                <MatchTrail key={match.id} match={match} />
              ))}
            </div>
          );
        },
      },
      {
        id: "source",
        header: t("paymentReconciliation.fields.source"),
        meta: { titleKey: "paymentReconciliation.fields.source" as MessageKey },
        cell: ({ row }) => {
          const provenance = row.original.provenance;
          const source = t(`paymentReconciliation.source.${provenance.sourceType}`);
          return (
            <div className="flex min-w-0 flex-col">
              <span>
                {provenance.rowNumber
                  ? t("paymentReconciliation.statement.provenance", {
                      source,
                      row: String(provenance.rowNumber),
                    })
                  : t("paymentReconciliation.statement.provenanceNoRow", { source })}
              </span>
              {provenance.fileName || provenance.sheetName ? (
                <span className="truncate text-caption text-muted-foreground" dir="auto">
                  {provenance.fileName ?? provenance.sheetName}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" as MessageKey },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const line = row.original;
          const actions: RowAction[] = [
            {
              key: "match",
              label: t("paymentReconciliation.tabs.matching"),
              icon: GitCompareArrows,
              hidden:
                !canMatch ||
                !onMatchLine ||
                line.status !== "UNMATCHED" ||
                (line.kind ?? "PAYMENT") !== "PAYMENT",
              onSelect: () => onMatchLine?.(line),
            },
            {
              key: "reopen",
              label: t("paymentReconciliation.exceptions.reopen"),
              icon: RotateCcw,
              hidden: !canMatch || (line.status !== "EXCEPTION" && line.status !== "IGNORED"),
              onSelect: () => void reopen(line),
            },
            {
              key: "ignore",
              label: t("paymentReconciliation.exceptions.ignore"),
              icon: Ban,
              hidden: !canMatch || line.status === "IGNORED" || line.matchedAmount > 0,
              onSelect: () => setPending({ kind: "ignore", line }),
            },
            ...line.matches
              .filter((match) => match.status === "ACTIVE")
              .map<RowAction>((match, index) => {
                // Labelled by what the server will actually do (shared rule with reverseMatch).
                const reverse = match.reversalEffect === "REVERSE_POSTING";
                const settled = isSettled(match.payment.settlementStatus);
                const label = reverse
                  ? `${t("paymentVocabulary.action.reversePosting")} · ${match.journalEntry?.entryNumber ?? match.payment.paymentNumber}`
                  : `${t("paymentVocabulary.action.unmatch")} · ${match.payment.paymentNumber}`;
                return {
                  key: `reverse-${match.id}`,
                  // Invalid stays visible, disabled, with its reason.
                  label: settled ? `${label} — ${t("paymentVocabulary.reason.settled")}` : label,
                  icon: reverse ? Undo2 : Unlink,
                  destructive: reverse,
                  separatorBefore: index === 0,
                  hidden: !canCorrect,
                  disabled: settled,
                  onSelect: () => setPending({ kind: "reverse", line, match }),
                };
              }),
          ];
          if (actions.every((action) => action.hidden)) return null;
          return <RowActionsMenu label={t("common.actions")} actions={actions} />;
        },
      },
    ],
    [t, canMatch, canCorrect, onMatchLine, reopen],
  );

  return (
    <>
      <EnterpriseDataTable
        tableId={tableId}
        printTitle={t("paymentReconciliation.title")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        fetchAllRows={fetchAllRows}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("paymentReconciliation.statement.searchPlaceholder")}
        filterBar={
          statuses.length > 1 ? (
            <SelectFilter
              label={t("paymentReconciliation.fields.status")}
              value={status}
              onChange={(value) => {
                setStatus(value as StatementLineStatus | "");
                setPage(1);
              }}
              allLabel={t("paymentReconciliation.status.ALL")}
              options={statuses.map((value) => ({
                value,
                label: t(paymentTerm(statementLineTerm(value)).labelKey),
              }))}
            />
          ) : undefined
        }
        isLoading={isLoading}
        getRowId={(row) => row.id}
        emptyTitle={emptyTitle}
        onRefresh={load}
        getRowCanExpand={(row) => !!row.provenance.rawRow}
        renderExpandedRegions={(row) => [
          {
            startColumnId: "date",
            grow: "until-next-region",
            content: (
              <div className="flex min-w-0 flex-col gap-1 text-caption">
                <span className="font-medium">{t("paymentReconciliation.statement.rawRow")}</span>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(row.provenance.rawRow ?? {}).map(([key, value]) => (
                    <div key={key} className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-muted-foreground">{key}:</dt>
                      <dd className="truncate" dir="auto">
                        {value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
                {row.matches
                  .filter((match) => match.status === "REVERSED")
                  .map((match) => (
                    <span key={match.id} className="text-muted-foreground">
                      {match.payment.paymentNumber} · {formatMoney(match.amount, row.currency.code)}{" "}
                      · {match.reversalReason}
                    </span>
                  ))}
              </div>
            ),
          },
        ]}
      />

      <ReasonDialog
        open={pending?.kind === "ignore"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("paymentReconciliation.exceptions.ignoreTitle")}
        description={t("paymentReconciliation.exceptions.ignoreDescription")}
        confirmLabel={t("paymentReconciliation.exceptions.ignore")}
        onConfirm={async (reason) => {
          if (pending?.kind !== "ignore") return;
          try {
            await paymentReconciliationService.ignoreLine(methodId, pending.line.id, reason);
            toast.success(t("paymentReconciliation.exceptions.ignored"));
            afterChange();
          } catch (error) {
            reportApiError(error, t("common.failedToSave"));
            throw error;
          }
        }}
      />

      <ReasonDialog
        open={pending?.kind === "reverse"}
        onOpenChange={(open) => !open && setPending(null)}
        tone={pending?.kind === "reverse" && isReversal(pending.match) ? "destructive" : "warning"}
        title={
          pending?.kind === "reverse"
            ? isReversal(pending.match)
              ? `${t("paymentVocabulary.action.reversePosting")}${pending.match.journalEntry ? ` · ${pending.match.journalEntry.entryNumber}` : ""}`
              : t("paymentVocabulary.action.unmatch")
            : ""
        }
        description={pending?.kind === "reverse" ? correctionSentence(pending.match) : undefined}
        confirmLabel={
          pending?.kind === "reverse" && isReversal(pending.match)
            ? t("paymentVocabulary.action.reversePosting")
            : t("paymentVocabulary.action.unmatch")
        }
        onConfirm={async (reason) => {
          if (pending?.kind !== "reverse") return;
          try {
            const result = await paymentReconciliationService.reverseMatch(
              methodId,
              pending.match.id,
              reason,
            );
            toast.success(
              result.cancelledReceipt
                ? t("paymentReconciliation.exceptions.reversedReceipt", {
                    receipt: result.cancelledReceipt.transactionNumber,
                  })
                : t("paymentReconciliation.exceptions.reversed"),
            );
            afterChange();
          } catch (error) {
            reportApiError(error, t("common.failedToSave"));
            throw error;
          }
        }}
      />
    </>
  );
}
