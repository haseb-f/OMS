"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCheck, RefreshCw, Tags, X } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { StoreOrderLineAmountsDialog } from "@/components/store-orders/store-order-line-amounts-dialog";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatMoney } from "@/lib/money";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import {
  paymentsReviewService,
  type PaymentReviewRow,
  type PaymentReviewStatus,
} from "@/services/payments-review-service";

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
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [status, page, pageSize, t]);

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
          toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
        } finally {
          await load();
        }
      }),
    [runExclusive, t, load],
  );

  const submitReject = async () => {
    const target = rejectTarget;
    if (!target) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError(t("finance.paymentReview.rejectDialog.reasonRequired"));
      return;
    }
    await runExclusive(target.id, async () => {
      try {
        await paymentsReviewService.reject(target.id, reason);
        toast.success(
          t("finance.paymentReview.toasts.rejected", { payment: target.paymentNumber }),
        );
        setRejectTarget(null);
        setRejectReason("");
        await load();
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
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
        meta: { titleKey: "finance.paymentReview.fields.amount", align: "end" },
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {formatMoney(row.original.amount, row.original.currency?.code)}
          </span>
        ),
      },
      {
        id: "remaining",
        meta: { titleKey: "finance.paymentReview.fields.remaining", align: "end" },
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {row.original.settlement ? formatMoney(row.original.settlement.outstanding) : "—"}
          </span>
        ),
      },
      {
        id: "source",
        meta: { titleKey: "finance.paymentReview.fields.source" },
        accessorFn: (row) => row.paymentSource?.name ?? "—",
      },
      {
        id: "account",
        meta: { titleKey: "finance.paymentReview.fields.account" },
        accessorFn: (row) => row.receivingAccount?.name ?? "—",
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
        cell: ({ row }) => (
          <StatusBadge
            label={t(`storeOrders.detail.payments.recordStatus.${row.original.status}` as never)}
            tone={
              row.original.status === "VERIFIED"
                ? "success"
                : row.original.status === "REJECTED"
                  ? "destructive"
                  : "warning"
            }
          />
        ),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        cell: ({ row }) => {
          const payment = row.original;
          const busy = busyId === payment.id;
          const open = payment.status === "PENDING" || payment.status === "MATCHED";
          const missingPrice = needsPrice(payment);
          return (
            <div className="flex flex-wrap items-center gap-1">
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
              {canConfirm && open ? (
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
              {canConfirm && payment.status === "VERIFIED" && payment.storeOrder ? (
                <EnterpriseButton
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void confirmAndPost(payment)}
                >
                  <RefreshCw className="size-3" />
                  {t("docFlow.payments.syncReceipt")}
                </EnterpriseButton>
              ) : null}
              {canConfirm && open ? (
                <EnterpriseButton
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  data-testid="payment-reject"
                  onClick={() => {
                    setRejectReason("");
                    setRejectError(null);
                    setRejectTarget(payment);
                  }}
                >
                  <X className="size-3" />
                  {t("finance.paymentReview.actions.reject")}
                </EnterpriseButton>
              ) : null}
              <EnterpriseButton size="xs" variant="ghost" onClick={() => setDetail(payment)}>
                {t("common.view")}
              </EnterpriseButton>
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
        title={`${t("finance.paymentReview.actions.reject")} ${rejectTarget?.paymentNumber ?? ""}`}
        description={t("finance.paymentReview.rejectDialog.description")}
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
              {t("finance.paymentReview.actions.reject")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-reject-reason">{t("finance.paymentReview.fields.reason")}</Label>
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
    [t("finance.paymentReview.fields.source"), payment.paymentSource?.name ?? "—"],
    [t("finance.paymentReview.fields.account"), payment.receivingAccount?.name ?? "—"],
    [t("finance.paymentReview.fields.proof"), payment.attachments.length],
  ];
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
