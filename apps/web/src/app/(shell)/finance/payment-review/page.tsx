"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { CheckCheck, CircleAlert, Eye, RefreshCw, Scale, Tags, X } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { RowActionsMenu } from "@/components/shared/data-table/row-actions-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { StoreOrderLineAmountsDialog } from "@/components/store-orders/store-order-line-amounts-dialog";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import {
  paymentsReviewService,
  type PaymentReviewRow,
  type PaymentReviewStatus,
} from "@/services/payments-review-service";
import { paymentRecordStatusBadge } from "@/config/store-orders/status";
import type { MessageKey } from "@/i18n/translate";

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

type ReasonMode = "reject" | "dispute";

/**
 * Claims of a reconciliation-enabled method are confirmed only by matching
 * them to the provider statement (the API refuses a direct confirm) — the
 * review queue links to the method's workspace instead.
 */
function reconciledMethodId(payment: PaymentReviewRow): string | null {
  return payment.paymentMethod?.requiresReconciliation ? payment.paymentMethod.id : null;
}

/** A store-order payment can only be confirmed once its order carries an agreed price. */
function needsPrice(payment: PaymentReviewRow): boolean {
  return !!payment.storeOrder && !!payment.settlement && payment.settlement.total <= 0;
}

function PaymentReviewPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canConfirm = hasPermission("sales.receipts.confirm");
  const canEditOrders = hasPermission("store-orders.edit");
  const [status, setStatus] = useState<PaymentReviewStatus | "">("");
  const [items, setItems] = useState<PaymentReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Synchronous in-flight guard — a double-click lands before React re-renders `busyId`. */
  const inFlight = useRef(new Set<string>());
  const [confirmTarget, setConfirmTarget] = useState<PaymentReviewRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentReviewRow | null>(null);
  // Reject and Dispute share one reason dialog (both require a reason).
  const [reasonMode, setReasonMode] = useState<ReasonMode>("reject");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [priceTarget, setPriceTarget] = useState<PaymentReviewRow | null>(null);
  const [detail, setDetail] = useState<PaymentReviewRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      if (status === "") {
        const [pending, matched] = await Promise.all([
          paymentsReviewService.list({ status: "PENDING", page: 1, pageSize: 100 }),
          paymentsReviewService.list({ status: "MATCHED", page: 1, pageSize: 100 }),
        ]);
        const merged = [...pending.items, ...matched.items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setItems(merged.slice((page - 1) * pageSize, page * pageSize));
        setTotal(pending.total + matched.total);
      } else {
        const result = await paymentsReviewService.list({ status, page, pageSize });
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (error) {
      reportApiError(error, "common.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
          await load();
        }
      }),
    [runExclusive, t, load],
  );

  const openReasonDialog = (payment: PaymentReviewRow, mode: ReasonMode) => {
    setReasonMode(mode);
    setRejectReason("");
    setRejectError(null);
    setRejectTarget(payment);
  };

  const submitReject = async () => {
    const target = rejectTarget;
    if (!target) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError(
        reasonMode === "dispute"
          ? t("paymentDeclaration.review.disputeReasonRequired")
          : t("finance.paymentReview.rejectDialog.reasonRequired"),
      );
      return;
    }
    await runExclusive(target.id, async () => {
      try {
        if (reasonMode === "dispute") {
          await paymentsReviewService.dispute(target.id, reason);
          toast.success(t("paymentDeclaration.review.disputed"));
        } else {
          await paymentsReviewService.reject(target.id, reason);
          toast.success(
            t("finance.paymentReview.toasts.rejected", { payment: target.paymentNumber }),
          );
        }
        setRejectTarget(null);
        setRejectReason("");
        await load();
      } catch (error) {
        reportApiError(error, "common.failedToSave");
      }
    });
  };

  const columns = useMemo<ColumnDef<PaymentReviewRow, unknown>[]>(
    () => [
      {
        id: "paymentNumber",
        meta: { titleKey: "finance.paymentReview.fields.number" },
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
        meta: { titleKey: "finance.paymentReview.fields.customer" },
        accessorFn: (row) =>
          row.storeOrder?.partner?.name ?? row.lead?.customerName ?? row.senderName,
      },
      {
        id: "order",
        meta: { titleKey: "finance.paymentReview.fields.order" },
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
        meta: { titleKey: "paymentDeclaration.review.method" },
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
        meta: { titleKey: "paymentDeclaration.review.debitAccount" },
        accessorFn: (row) => debitAccountLabel(row, t),
      },
      {
        id: "reference",
        meta: { titleKey: "finance.paymentReview.fields.reference" },
        accessorFn: (row) => row.referenceNumber ?? "—",
      },
      {
        id: "proof",
        meta: { titleKey: "finance.paymentReview.fields.proof" },
        accessorFn: (row) => row.attachments.length,
      },
      {
        id: "date",
        meta: { titleKey: "finance.paymentReview.fields.date" },
        accessorFn: (row) => formatDate(row.paymentDate),
      },
      {
        id: "status",
        meta: { titleKey: "finance.paymentReview.fields.status" },
        cell: ({ row }) => {
          const badge = paymentRecordStatusBadge(row.original.status);
          return (
            <StatusBadge
              label={badge.labelKey ? t(badge.labelKey) : badge.fallback}
              tone={badge.tone}
            />
          );
        },
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        cell: ({ row }) => {
          const payment = row.original;
          const busy = busyId === payment.id;
          const open = payment.status === "PENDING" || payment.status === "MATCHED";
          const missingPrice = needsPrice(payment);
          const workspaceMethodId = reconciledMethodId(payment);
          return (
            // One line per row: the state's primary action and Reject stay
            // inline; secondary actions live in the row menu.
            <div className="flex flex-nowrap items-center justify-end gap-1">
              {canConfirm && open && missingPrice && canEditOrders ? (
                <EnterpriseButton
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  data-testid="payment-set-price"
                  title={t("finance.paymentReview.needsPrice", {
                    order: payment.storeOrder?.internalOrderId ?? "",
                  })}
                  onClick={() => setPriceTarget(payment)}
                >
                  <Tags className="size-3" />
                  {t("finance.paymentReview.actions.setPrice")}
                </EnterpriseButton>
              ) : null}
              {canConfirm && open && workspaceMethodId ? (
                <EnterpriseButton
                  size="xs"
                  variant="outline"
                  asChild
                  data-testid="payment-reconcile-link"
                  title={t("paymentDeclaration.review.reconcileHint")}
                >
                  <Link href={`/finance/payment-reconciliation/${workspaceMethodId}`}>
                    <Scale className="size-3" />
                    {t("paymentDeclaration.review.reconcileInWorkspace")}
                  </Link>
                </EnterpriseButton>
              ) : null}
              {canConfirm && open && !workspaceMethodId ? (
                <EnterpriseButton
                  size="xs"
                  variant="success"
                  disabled={busy || missingPrice}
                  data-testid="payment-confirm-post"
                  title={
                    missingPrice
                      ? t("finance.paymentReview.needsPrice", {
                          order: payment.storeOrder?.internalOrderId ?? "",
                        })
                      : undefined
                  }
                  onClick={() => setConfirmTarget(payment)}
                >
                  <CheckCheck className="size-3" />
                  {t("finance.paymentReview.actions.confirmPost")}
                </EnterpriseButton>
              ) : null}
              {canConfirm && open ? (
                <EnterpriseButton
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  data-testid="payment-reject"
                  onClick={() => openReasonDialog(payment, "reject")}
                >
                  <X className="size-3" />
                  {t("finance.paymentReview.actions.reject")}
                </EnterpriseButton>
              ) : null}
              <RowActionsMenu
                label={t("common.actions")}
                actions={[
                  {
                    key: "view",
                    label: t("common.view"),
                    icon: Eye,
                    onSelect: () => setDetail(payment),
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
                    label: t("paymentDeclaration.review.dispute"),
                    icon: CircleAlert,
                    hidden: !(canConfirm && open && payment.storeOrder),
                    disabled: busy,
                    separatorBefore: true,
                    onSelect: () => openReasonDialog(payment, "dispute"),
                  },
                ]}
              />
            </div>
          );
        },
      },
    ],
    [busyId, canConfirm, canEditOrders, confirmAndPost, t],
  );

  return (
    <PageWorkspace
      dense
      title={t("nav.financePaymentReview")}
      description={t("finance.paymentReview.description")}
    >
      <EnterpriseDataTable
        tableId="finance-payment-review"
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
        isLoading={isLoading}
        getRowId={(row) => row.id}
        filterBar={
          <SelectFilter
            label={t("finance.paymentReview.fields.status")}
            value={status}
            onChange={(value) => {
              setStatus(value as PaymentReviewStatus | "");
              setPage(1);
            }}
            allLabel={t("finance.paymentReview.queue")}
            options={[
              { value: "PENDING", label: t("storeOrders.detail.payments.recordStatus.PENDING") },
              { value: "MATCHED", label: t("storeOrders.detail.payments.recordStatus.MATCHED") },
              { value: "VERIFIED", label: t("storeOrders.detail.payments.recordStatus.VERIFIED") },
              { value: "REJECTED", label: t("storeOrders.detail.payments.recordStatus.REJECTED") },
              { value: "DISPUTED", label: t("paymentDeclaration.recordStatus.DISPUTED") },
            ]}
          />
        }
      />

      <ConfirmationDialog
        open={!!confirmTarget}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={t("finance.paymentReview.confirmDialog.title", {
          payment: confirmTarget?.paymentNumber ?? "",
        })}
        description={t("finance.paymentReview.confirmDialog.description", {
          amount: confirmTarget
            ? formatMoney(confirmTarget.amount, confirmTarget.currency?.code)
            : "",
          order: confirmTarget?.storeOrder?.internalOrderId ?? "—",
        })}
        confirmLabel={t("finance.paymentReview.actions.confirmPost")}
        cancelLabel={t("common.close")}
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) void confirmAndPost(target);
        }}
      />

      <EnterpriseModal
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        size="md"
        title={
          reasonMode === "dispute"
            ? `${t("paymentDeclaration.review.disputeTitle")} ${rejectTarget?.paymentNumber ?? ""}`
            : `${t("finance.paymentReview.actions.reject")} ${rejectTarget?.paymentNumber ?? ""}`
        }
        description={
          reasonMode === "dispute"
            ? t("paymentDeclaration.review.disputeDescription")
            : t("finance.paymentReview.rejectDialog.description")
        }
        isDirty={rejectReason.trim().length > 0}
        footer={(requestClose) => (
          <>
            <EnterpriseButton variant="ghost" size="sm" onClick={requestClose}>
              {t("common.close")}
            </EnterpriseButton>
            <EnterpriseButton
              variant="destructive"
              size="sm"
              data-testid="payment-reject-submit"
              disabled={!rejectTarget || busyId === rejectTarget.id}
              onClick={() => void submitReject()}
            >
              {reasonMode === "dispute"
                ? t("paymentDeclaration.review.dispute")
                : t("finance.paymentReview.actions.reject")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-reject-reason">
            {reasonMode === "dispute"
              ? t("paymentDeclaration.review.disputeReason")
              : t("finance.paymentReview.fields.reason")}
          </Label>
          <Textarea
            id="payment-reject-reason"
            rows={3}
            maxLength={500}
            value={rejectReason}
            placeholder={t("finance.paymentReview.rejectDialog.placeholder")}
            aria-invalid={!!rejectError}
            onChange={(event) => {
              setRejectReason(event.target.value);
              if (rejectError) setRejectError(null);
            }}
          />
          {rejectError ? <p className="text-caption text-destructive">{rejectError}</p> : null}
        </div>
      </EnterpriseModal>

      <StoreOrderLineAmountsDialog
        orderId={priceTarget?.storeOrder?.id ?? null}
        open={!!priceTarget}
        onOpenChange={(open) => !open && setPriceTarget(null)}
        onSaved={() => void load()}
      />

      <EnterpriseModal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.paymentNumber ?? ""}
        footer={(close) => (
          <EnterpriseButton variant="outline" onClick={close}>
            {t("common.close")}
          </EnterpriseButton>
        )}
      >
        {detail ? <PaymentReviewDetail payment={detail} /> : null}
      </EnterpriseModal>
    </PageWorkspace>
  );
}

function PaymentReviewDetail({ payment }: { payment: PaymentReviewRow }) {
  const { t } = useLocale();
  const rows: Array<[string, React.ReactNode]> = [
    [
      t("finance.paymentReview.fields.customer"),
      payment.storeOrder?.partner?.name ?? payment.lead?.customerName ?? payment.senderName,
    ],
    [
      t("finance.paymentReview.fields.amount"),
      <span key="amount" dir="ltr" className="tabular-nums">
        {formatMoney(payment.amount, payment.currency?.code)}
      </span>,
    ],
    [
      t("paymentDeclaration.review.method"),
      payment.paymentMethod?.name ?? payment.paymentSource?.name ?? "—",
    ],
    [
      t("paymentDeclaration.review.debitAccount"),
      <span key="debit" className="inline-flex flex-col">
        <span>{debitAccountLabel(payment, t)}</span>
        <span className="text-caption text-muted-foreground">
          {t("paymentDeclaration.review.debitAccountHint")}
        </span>
      </span>,
    ],
    [t("finance.paymentReview.fields.proof"), payment.attachments.length],
  ];
  if (payment.origin && payment.origin !== "LEGACY") {
    rows.push([
      t("paymentDeclaration.review.origin"),
      t(`paymentDeclaration.origin.${payment.origin}` as MessageKey),
    ]);
  }
  if (payment.declarationKind) {
    rows.push([
      t("paymentDeclaration.review.kind"),
      t(`paymentDeclaration.kind.${payment.declarationKind}` as MessageKey),
    ]);
  }
  if (payment.paymentMethod) {
    rows.push([
      t("paymentDeclaration.review.requiresReconciliation"),
      payment.paymentMethod.requiresReconciliation
        ? t("paymentDeclaration.method.yes")
        : t("paymentDeclaration.method.no"),
    ]);
  }
  if (payment.disputeReason) {
    rows.push([t("paymentDeclaration.fields.reason"), payment.disputeReason]);
  }
  if (payment.settlement) {
    rows.push([
      t("finance.paymentReview.fields.remaining"),
      <span key="remaining" dir="ltr" className="tabular-nums">
        {formatMoney(payment.settlement.outstanding)}
      </span>,
    ]);
  }
  return (
    <div className="flex flex-col gap-3 text-body">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {needsPrice(payment) ? (
        <p className="text-caption text-warning-foreground">
          {t("finance.paymentReview.needsPrice", {
            order: payment.storeOrder?.internalOrderId ?? "",
          })}
        </p>
      ) : null}
      <RelatedRecordsPanel kind="PAYMENT" id={payment.id} refreshKey={payment.status} />
    </div>
  );
}

export default function FinancePaymentReviewPage() {
  return (
    <PermissionGate permission="sales.receipts.view">
      <PaymentReviewPageContent />
    </PermissionGate>
  );
}
