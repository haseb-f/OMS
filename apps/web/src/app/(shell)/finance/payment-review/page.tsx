"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { usePathname, useSearchParams } from "next/navigation";
import { CircleAlert, Eye, RefreshCw, Tags } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import {
  RowActionsMenu,
  useBulkLimitGuard,
  useSelectedRecords,
} from "@/components/shared/data-table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { StoreOrderLineAmountsDialog } from "@/components/store-orders/store-order-line-amounts-dialog";
import { PaymentActionButton } from "@/components/payments/payment-action-button";
import { PaymentClaimBadge } from "@/components/payments/payment-term-badge";
import { PaymentReviewGridCard } from "@/components/payments/review/payment-review-grid-card";
import { PaymentMatchPanel } from "@/components/payments/match-panel/payment-match-panel";
import { confirmPostSentence } from "@/components/payments/match-panel/match-panel-model";
import { BulkResultDialog } from "@/components/payments/bulk-result-dialog";
import { ReasonDialog } from "@/components/payments/reconciliation/reason-dialog";
import {
  PaymentStageStrip,
  isReviewListStage,
  type ReviewListStage,
} from "@/components/payments/review/payment-stage-strip";
import { formatCurrencyTotals, totalsByCurrency } from "@/components/payments/payment-totals";
import { paymentRecordTerm, paymentTerm } from "@/config/payments/payment-vocabulary";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, toast, reportApiError } from "@/lib/toast";
import { runInChunks } from "@/components/payments/bulk-chunks";
import {
  decisionBlockReason,
  isOpenDeclaration,
  rejectBlockReason,
} from "@/components/payments/payment-eligibility";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { BULK_LIMITS } from "@/lib/bulk-limits";
import {
  paymentsReviewService,
  type BulkItemsResult,
  type PaymentReviewRow,
  type PaymentReviewStatus,
  type PaymentReviewSummary,
  type PaymentSettlementFilter,
} from "@/services/payments-review-service";
import type { MessageKey } from "@/i18n/translate";
import { FETCH_ALL_ROW_CAP, fetchAllPages } from "@/lib/fetch-all-pages";

const RECORD_STATUSES: PaymentReviewStatus[] = [
  "PENDING",
  "MATCHED",
  "VERIFIED",
  "REJECTED",
  "DISPUTED",
];
const AWAITING_SETTLEMENT: PaymentSettlementFilter[] = ["AWAITING_SETTLEMENT", "PARTIALLY_SETTLED"];

/**
 * The ledger account a confirmation will debit: the payment method's
 * clearing account for declared claims, the receiving account for legacy
 * vouchers. Read-only — Finance never re-points it here.
 */
function debitAccountLabel(payment: PaymentReviewRow, t: (key: MessageKey) => string): string {
  if (payment.paymentMethod) {
    const account = payment.paymentMethod.account;
    return account
      ? `${account.code} — ${account.name}`
      : t("paymentDeclaration.review.noMethodAccount");
  }
  return payment.receivingAccount
    ? `${payment.receivingAccount.name} (${t("paymentDeclaration.review.legacyReceivingAccount")})`
    : "—";
}

/** Claims of a reconciliation-enabled method are confirmed only by matching them to the provider statement. */
function reconciledMethodId(payment: PaymentReviewRow): string | null {
  return payment.paymentMethod?.requiresReconciliation ? payment.paymentMethod.id : null;
}

/** A store-order payment can only be confirmed once its order carries an agreed price. */
function needsPrice(payment: PaymentReviewRow): boolean {
  return !!payment.storeOrder && !!payment.settlement && payment.settlement.total <= 0;
}

function isOpen(payment: PaymentReviewRow): boolean {
  return isOpenDeclaration(payment.status);
}

/** Why "Confirm & post" cannot run from the review list (null ⇒ it can; the server re-checks). */
function confirmBlockReason(payment: PaymentReviewRow): MessageKey | null {
  const blocked = decisionBlockReason(payment);
  if (blocked) return blocked;
  if (!payment.storeOrder) return "paymentVocabulary.reason.noOrder";
  if (reconciledMethodId(payment)) return "paymentVocabulary.reason.reconciledMethod";
  if (payment.paymentMethod && !payment.paymentMethod.account) {
    return "paymentVocabulary.reason.noDebitAccount";
  }
  if (needsPrice(payment)) return "paymentVocabulary.reason.missingPrice";
  return null;
}

type BulkKind = "confirm" | "reject";

function PaymentReviewPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stageParam = searchParams.get("stage");
  const stage: ReviewListStage | null = isReviewListStage(stageParam) ? stageParam : null;
  const canConfirm = hasPermission("sales.receipts.confirm");
  const canEditOrders = hasPermission("store-orders.edit");
  const [status, setStatus] = useState<PaymentReviewStatus | "">("");
  const [items, setItems] = useState<PaymentReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  /** Committed (already debounced by the table) search term — sent to the API. */
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<PaymentReviewSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Synchronous in-flight guard — a double-click lands before React re-renders `busyId`. */
  const inFlight = useRef(new Set<string>());
  const [confirmTarget, setConfirmTarget] = useState<PaymentReviewRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentReviewRow | null>(null);
  const [priceTarget, setPriceTarget] = useState<PaymentReviewRow | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulk, setBulk] = useState<{
    kind: BulkKind;
    targets: PaymentReviewRow[];
    selected: number;
  } | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  const [isResolvingBulk, setIsResolvingBulk] = useState(false);
  const [isRunningBulk, setIsRunningBulk] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    result: BulkItemsResult<unknown>;
    labels: Map<string, string>;
  } | null>(null);
  const withinBulkLimit = useBulkLimitGuard();

  /** A stage chip wins over the status filter; the status filter clears the stage. */
  const listQuery = useMemo(() => {
    if (stage === "declared") return { status: "PENDING" as const };
    // Only claims Finance can confirm from this list (reconciliation methods finish in their workspace).
    if (stage === "awaitingConfirmation") {
      return { status: "MATCHED" as const, reconciled: "false" as const };
    }
    if (stage === "awaitingSettlement") {
      return { status: "VERIFIED" as const, settlementStatus: AWAITING_SETTLEMENT };
    }
    return status ? { status } : null;
  }, [stage, status]);
  const searchTerm = search.trim() || undefined;
  /** Every filter the current rows answer to — the selection/bulk scope. */
  const selectionQuery = useMemo(
    () => ({ listQuery, search: searchTerm }),
    [listQuery, searchTerm],
  );

  const stageHref = useCallback(
    (next: ReviewListStage | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("stage", next);
      else params.delete("stage");
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await paymentsReviewService.summary());
    } catch (error) {
      reportApiError(error, "common.loadFailed");
    }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!listQuery) {
        const [pending, matched] = await Promise.all([
          paymentsReviewService.list({
            status: "PENDING",
            search: searchTerm,
            page: 1,
            pageSize: 100,
          }),
          paymentsReviewService.list({
            status: "MATCHED",
            search: searchTerm,
            page: 1,
            pageSize: 100,
          }),
        ]);
        const merged = [...pending.items, ...matched.items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setItems(merged.slice((page - 1) * pageSize, page * pageSize));
        setTotal(pending.total + matched.total);
      } else {
        const result = await paymentsReviewService.list({
          ...listQuery,
          search: searchTerm,
          page,
          pageSize,
        });
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (error) {
      reportApiError(error, "common.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [listQuery, searchTerm, page, pageSize]);

  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadSummary()]);
  }, [load, loadSummary]);

  // Print / bulk: every row in the current view, not just the loaded page.
  const fetchAllRows = useCallback(async () => {
    const fetchQuery = (query: NonNullable<typeof listQuery>) =>
      fetchAllPages((nextPage, nextPageSize) =>
        paymentsReviewService.list({
          ...query,
          search: searchTerm,
          page: nextPage,
          pageSize: nextPageSize,
        }),
      );
    if (listQuery) return fetchQuery(listQuery);
    const [pending, matched] = await Promise.all([
      fetchQuery({ status: "PENDING" }),
      fetchQuery({ status: "MATCHED" }),
    ]);
    return {
      rows: [...pending.rows, ...matched.rows]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, FETCH_ALL_ROW_CAP),
      total: pending.total + matched.total,
    };
  }, [listQuery, searchTerm]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  const selection = useSelectedRecords({
    items,
    rowSelection,
    fetchAllRows,
    query: selectionQuery,
  });

  const runExclusive = useCallback(async (id: string, work: () => Promise<void>) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setBusyId(id);
    try {
      await work();
    } finally {
      inFlight.current.delete(id);
      setBusyId(null);
    }
  }, []);

  const confirmAndPost = useCallback(
    (payment: PaymentReviewRow) =>
      runExclusive(payment.id, async () => {
        try {
          const result = await paymentsReviewService.confirm(payment.id);
          const receipt = result.receipt;
          toast.success(
            t(
              result.alreadyPosted
                ? "finance.paymentReview.toasts.alreadyPosted"
                : "finance.paymentReview.toasts.confirmedPosted",
              {
                payment: result.paymentNumber,
                receipt: receipt.transactionNumber,
                journal: receipt.journalEntry?.entryNumber ?? "—",
              },
            ),
          );
        } catch (error) {
          reportApiError(error, "common.failedToSave");
        } finally {
          await reloadAll();
        }
      }),
    [runExclusive, t, reloadAll],
  );

  const confirmSentence = (payment: PaymentReviewRow) => {
    const sentence = confirmPostSentence({
      amount: payment.amount,
      currencyCode: payment.currency?.code,
      account: debitAccountLabel(payment, t),
      order: payment.storeOrder?.internalOrderId ?? "—",
    });
    return t(sentence.key, sentence.params);
  };

  const rejectSentence = (payment: PaymentReviewRow) =>
    t("paymentVocabulary.effect.reject", {
      payment: payment.paymentNumber,
      amount: formatMoney(payment.amount, payment.currency?.code),
      order: payment.storeOrder?.internalOrderId ?? "—",
    });

  /** Resolves the whole selection (every page), keeps the eligible records and shows the exact counts. */
  const startBulk = async (kind: BulkKind) => {
    if (!withinBulkLimit(selection.selectedIds.length, BULK_LIMITS.paymentBulkSelectionMax)) return;
    setIsResolvingBulk(true);
    try {
      const records = await selection.resolve({ fresh: true });
      if (!records) return;
      const eligible = records.filter((row) =>
        kind === "confirm" ? confirmBlockReason(row) === null : rejectBlockReason(row) === null,
      );
      if (eligible.length === 0) {
        toast.info(t("paymentVocabulary.bulk.noneEligible"));
        return;
      }
      setBulkReason("");
      setBulk({ kind, targets: eligible, selected: records.length });
    } finally {
      setIsResolvingBulk(false);
    }
  };

  const runBulk = async (reason?: string) => {
    if (!bulk) return;
    setIsRunningBulk(true);
    const labels = new Map(bulk.targets.map((row) => [row.id, row.paymentNumber]));
    try {
      // Small requests (the server processes each item in turn); results merged per item.
      const result = await runInChunks<PaymentReviewRow, unknown>(
        bulk.targets,
        BULK_LIMITS.paymentBulkChunk,
        (chunk) => {
          const ids = chunk.map((row) => row.id);
          return bulk.kind === "confirm"
            ? paymentsReviewService.bulkConfirm(ids)
            : paymentsReviewService.bulkReject(ids, reason ?? "");
        },
        {
          idOf: (row) => row.id,
          onProgress: (done, total) => setBulkProgress({ done, total }),
          requestFailed: (message) => t("paymentVocabulary.bulk.requestFailed", { message }),
          errorMessage: (error) => apiErrorMessage(error),
        },
      );
      if (result.failed.length === 0) {
        toast.success(t("paymentVocabulary.bulk.allDone", { count: result.succeeded.length }));
      } else {
        setBulkResult({ result, labels });
      }
      setBulk(null);
      setRowSelection({});
    } finally {
      setIsRunningBulk(false);
      setBulkProgress(null);
      await reloadAll();
    }
  };

  const bulkConfirmLabel = (action: string) =>
    bulkProgress ? t("paymentVocabulary.bulk.progress", bulkProgress) : action;

  // The row's primary action + Reject + menu - the ONE control behind the table's
  // Actions cell and the Grid card (permissions, block reasons and busy state are
  // shared). `wrap` lets the card's narrower footer break the strip onto two lines.
  const renderRowActions = useCallback(
    (payment: PaymentReviewRow, wrap = false) => {
      const busy = busyId === payment.id;
      const open = isOpen(payment);
      const workspaceMethodId = reconciledMethodId(payment);
      const blocked = confirmBlockReason(payment);
      return (
        <div
          className={`flex ${wrap ? "flex-wrap" : "flex-nowrap"} items-center justify-end gap-1`}
        >
          {canConfirm && open && workspaceMethodId ? (
            <PaymentActionButton
              intent="match"
              size="xs"
              quiet
              disabled={busy}
              data-testid="payment-match-review"
              onClick={() => setPanelId(payment.id)}
            />
          ) : null}
          {canConfirm && open && !workspaceMethodId ? (
            <PaymentActionButton
              intent="confirmPost"
              size="xs"
              disabled={busy}
              disabledReason={blocked ? t(blocked) : null}
              data-testid="payment-confirm-post"
              onClick={() => setConfirmTarget(payment)}
            />
          ) : null}
          {canConfirm && open ? (
            <PaymentActionButton
              intent="rejectDeclaration"
              size="xs"
              disabled={busy}
              disabledReason={
                rejectBlockReason(payment) ? t(rejectBlockReason(payment) as MessageKey) : null
              }
              data-testid="payment-reject"
              onClick={() => setRejectTarget(payment)}
            />
          ) : null}
          {!open ? (
            <PaymentActionButton
              intent="review"
              size="xs"
              quiet
              onClick={() => setPanelId(payment.id)}
            />
          ) : null}
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "review",
                label: t("paymentVocabulary.action.review"),
                icon: Eye,
                onSelect: () => setPanelId(payment.id),
              },
              {
                key: "set-price",
                label: t("finance.paymentReview.actions.setPrice"),
                icon: Tags,
                hidden: !(canConfirm && open && needsPrice(payment) && canEditOrders),
                onSelect: () => setPriceTarget(payment),
              },
              {
                key: "sync-receipt",
                label: t("docFlow.payments.syncReceipt"),
                icon: RefreshCw,
                hidden: !(canConfirm && payment.status === "VERIFIED" && payment.storeOrder),
                disabled: busy,
                onSelect: () => void confirmAndPost(payment),
              },
              {
                key: "dispute",
                label: t("paymentVocabulary.action.dispute"),
                icon: CircleAlert,
                hidden: !(canConfirm && open && payment.storeOrder),
                disabled: busy,
                separatorBefore: true,
                onSelect: () => setPanelId(payment.id),
              },
            ]}
          />
        </div>
      );
    },
    [busyId, canConfirm, canEditOrders, confirmAndPost, t],
  );

  const columns = useMemo<ColumnDef<PaymentReviewRow, unknown>[]>(
    () => [
      {
        id: "paymentNumber",
        meta: {
          titleKey: "finance.paymentReview.fields.number",
          identity: true,
          type: "reference",
        },
        cell: ({ row }) => (
          <RelatedRecordLink
            kind="PAYMENT"
            id={row.original.id}
            number={row.original.paymentNumber}
            status={row.original.status}
            variant="inline"
          />
        ),
      },
      {
        id: "customer",
        meta: { titleKey: "finance.paymentReview.fields.customer", type: "name" },
        accessorFn: (row) =>
          row.storeOrder?.partner?.name ?? row.lead?.customerName ?? row.senderName,
      },
      {
        id: "order",
        meta: {
          titleKey: "finance.paymentReview.fields.order",
          type: "reference",
          importance: "high",
        },
        cell: ({ row }) =>
          row.original.storeOrder ? (
            <RelatedRecordLink
              kind="STORE_ORDER"
              id={row.original.storeOrder.id}
              number={row.original.storeOrder.internalOrderId}
              variant="inline"
            />
          ) : (
            (row.original.lead?.leadNumber ?? "—")
          ),
      },
      {
        id: "amount",
        meta: { titleKey: "finance.paymentReview.fields.amount", align: "end", type: "money" },
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {formatMoney(row.original.amount, row.original.currency?.code)}
          </span>
        ),
      },
      {
        id: "remaining",
        meta: { titleKey: "finance.paymentReview.fields.remaining", align: "end", type: "money" },
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {row.original.settlement ? formatMoney(row.original.settlement.outstanding) : "—"}
          </span>
        ),
      },
      {
        id: "method",
        meta: { titleKey: "paymentDeclaration.review.method", type: "default" },
        cell: ({ row }) => (
          <span className="inline-flex flex-col">
            <span>
              {row.original.paymentMethod?.name ?? row.original.paymentSource?.name ?? "—"}
            </span>
            {row.original.origin && row.original.origin !== "LEGACY" ? (
              <span className="text-caption text-muted-foreground">
                {[
                  t(`paymentDeclaration.origin.${row.original.origin}` as MessageKey),
                  row.original.declarationKind
                    ? t(`paymentDeclaration.kind.${row.original.declarationKind}` as MessageKey)
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "account",
        meta: {
          titleKey: "paymentDeclaration.review.debitAccount",
          type: "default",
          importance: "low",
        },
        accessorFn: (row) => debitAccountLabel(row, t),
      },
      {
        id: "reference",
        meta: { titleKey: "finance.paymentReview.fields.reference", type: "reference" },
        accessorFn: (row) => row.referenceNumber ?? "—",
      },
      {
        id: "proof",
        meta: { titleKey: "finance.paymentReview.fields.proof", type: "number" },
        accessorFn: (row) => row.attachments.length,
      },
      {
        id: "date",
        meta: { titleKey: "finance.paymentReview.fields.date", type: "date" },
        accessorFn: (row) => formatDate(row.paymentDate),
      },
      {
        id: "status",
        meta: {
          titleKey: "finance.paymentReview.fields.status",
          type: "status",
          displayValue: (row, tr) => {
            const term = paymentRecordTerm(row.status);
            return term ? tr(paymentTerm(term).labelKey) : row.status;
          },
        },
        cell: ({ row }) => (
          <PaymentClaimBadge
            status={row.original.status}
            settlementStatus={row.original.settlementStatus}
          />
        ),
      },
      {
        id: "__actions",
        // Primary action + Reject + row menu on one line — never spilling into the date.
        meta: { titleKey: "common.actions", fixedWidth: 330 },
        cell: ({ row }) => renderRowActions(row.original),
      },
    ],
    [renderRowActions, t],
  );

  const bulkTotals = bulk
    ? formatCurrencyTotals(
        totalsByCurrency(bulk.targets, (row) => ({
          code: row.currency?.code,
          amount: row.amount,
        })),
      )
    : "";
  const bulkDescription = bulk ? (
    <>
      {t("paymentVocabulary.bulk.selectedEligible", {
        eligible: bulk.targets.length,
        selected: bulk.selected,
      })}{" "}
      {bulk.kind === "confirm"
        ? t("paymentVocabulary.effect.bulkConfirm", { totals: bulkTotals })
        : t("paymentVocabulary.effect.bulkReject")}
      {bulk.selected > bulk.targets.length ? (
        <> {t("paymentVocabulary.bulk.skipped", { count: bulk.selected - bulk.targets.length })}</>
      ) : null}
    </>
  ) : null;

  return (
    <PageWorkspace
      dense
      title={t("nav.financePaymentReview")}
      description={t("finance.paymentReview.description")}
    >
      <div className="flex flex-col gap-3">
        <PaymentStageStrip summary={summary} active={stage} listHref={stageHref} />

        <EnterpriseDataTable
          tableId="finance-payment-review"
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
          isLoading={isLoading}
          getRowId={(row) => row.id}
          onRefresh={() => void reloadAll()}
          renderGridCard={({ row, selected, onToggleSelected }) => (
            <PaymentReviewGridCard
              payment={row}
              selected={selected}
              onToggleSelected={canConfirm ? onToggleSelected : undefined}
              actions={renderRowActions(row, true)}
            />
          )}
          rowSelection={canConfirm ? rowSelection : undefined}
          onRowSelectionChange={canConfirm ? setRowSelection : undefined}
          selectionResetKey={selectionQuery}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchPlaceholder={t("finance.paymentReview.searchPlaceholder")}
          bulkActions={
            canConfirm ? (
              <>
                <PaymentActionButton
                  intent="confirmPost"
                  disabled={isResolvingBulk}
                  onClick={() => void startBulk("confirm")}
                />
                <PaymentActionButton
                  intent="rejectDeclaration"
                  disabled={isResolvingBulk}
                  onClick={() => void startBulk("reject")}
                />
              </>
            ) : undefined
          }
          filterBar={
            <SelectFilter
              label={t("finance.paymentReview.fields.status")}
              value={stage ? "" : status}
              onChange={(value) => {
                setStatus(value as PaymentReviewStatus | "");
                setPage(1);
                if (stage) window.history.replaceState(null, "", stageHref(null));
              }}
              allLabel={t("finance.paymentReview.queue")}
              options={RECORD_STATUSES.map((value) => ({
                value,
                label: t(paymentTerm(paymentRecordTerm(value) ?? "DECLARED").labelKey),
              }))}
            />
          }
        />
      </div>

      <ConfirmationDialog
        open={!!confirmTarget}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        tone="success"
        title={t("finance.paymentReview.confirmDialog.title", {
          payment: confirmTarget?.paymentNumber ?? "",
        })}
        description={confirmTarget ? confirmSentence(confirmTarget) : undefined}
        confirmLabel={t("paymentVocabulary.action.confirmPost")}
        cancelLabel={t("common.close")}
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) void confirmAndPost(target);
        }}
      />

      <ReasonDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        tone="destructive"
        title={`${t("paymentVocabulary.action.rejectDeclaration")} ${rejectTarget?.paymentNumber ?? ""}`}
        description={rejectTarget ? rejectSentence(rejectTarget) : undefined}
        confirmLabel={t("paymentVocabulary.action.rejectDeclaration")}
        onConfirm={async (reason) => {
          const target = rejectTarget;
          if (!target) return;
          await runExclusive(target.id, async () => {
            try {
              await paymentsReviewService.reject(target.id, reason);
              toast.success(
                t("finance.paymentReview.toasts.rejected", { payment: target.paymentNumber }),
              );
              await reloadAll();
            } catch (error) {
              reportApiError(error, "common.failedToSave");
              throw error;
            }
          });
        }}
      />

      <ConfirmationDialog
        open={bulk?.kind === "confirm"}
        onOpenChange={(open) => {
          if (!open && !isRunningBulk) setBulk(null);
        }}
        tone="success"
        title={bulk ? t("paymentVocabulary.bulk.confirmTitle", { count: bulk.targets.length }) : ""}
        description={bulkDescription}
        confirmLabel={bulkConfirmLabel(t("paymentVocabulary.action.confirmPost"))}
        isConfirming={isRunningBulk}
        onConfirm={() => void runBulk()}
      />

      <ConfirmationDialog
        open={bulk?.kind === "reject"}
        onOpenChange={(open) => {
          if (!open && !isRunningBulk) setBulk(null);
        }}
        tone="destructive"
        title={bulk ? t("paymentVocabulary.bulk.rejectTitle", { count: bulk.targets.length }) : ""}
        description={bulkDescription}
        extra={
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-bulk-reject-reason">
              {t("paymentVocabulary.bulk.sharedReason")}
            </Label>
            <Textarea
              id="payment-bulk-reject-reason"
              rows={2}
              maxLength={500}
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
            />
          </div>
        }
        confirmLabel={bulkConfirmLabel(t("paymentVocabulary.action.rejectDeclaration"))}
        confirmDisabled={!bulkReason.trim()}
        isConfirming={isRunningBulk}
        onConfirm={() => void runBulk(bulkReason.trim())}
      />

      <BulkResultDialog
        result={bulkResult?.result ?? null}
        label={(id) => bulkResult?.labels.get(id) ?? id}
        onClose={() => setBulkResult(null)}
      />

      <StoreOrderLineAmountsDialog
        orderId={priceTarget?.storeOrder?.id ?? null}
        open={!!priceTarget}
        onOpenChange={(open) => !open && setPriceTarget(null)}
        onSaved={() => void reloadAll()}
      />

      <PaymentMatchPanel
        paymentId={panelId}
        onOpenChange={(open) => !open && setPanelId(null)}
        onChanged={() => void reloadAll()}
      />
    </PageWorkspace>
  );
}

export default function FinancePaymentReviewPage() {
  return (
    <PermissionGate permission="sales.receipts.view">
      <PaymentReviewPageContent />
    </PermissionGate>
  );
}
