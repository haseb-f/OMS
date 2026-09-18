"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Link2, X } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import {
  paymentsReviewService,
  type PaymentReviewRow,
  type PaymentReviewStatus,
} from "@/services/payments-review-service";

function PaymentReviewPageContent() {
  const { t } = useLocale();
  const { user, hasPermission } = useUserContext();
  const canConfirm = hasPermission("sales.receipts.confirm");
  const [status, setStatus] = useState<PaymentReviewStatus | "">("");
  const [items, setItems] = useState<PaymentReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentReviewRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detail, setDetail] = useState<PaymentReviewRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const statuses: PaymentReviewStatus[] = status === "" ? ["PENDING", "MATCHED"] : [status];
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
        const result = await paymentsReviewService.list({
          status: statuses[0],
          page,
          pageSize,
        });
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [status, page, pageSize, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = useCallback(
    async (row: PaymentReviewRow, action: "match" | "verify") => {
      if (!user?.id) return;
      setBusyId(row.id);
      try {
        if (action === "match") await paymentsReviewService.match(row.id, user.id);
        else await paymentsReviewService.verify(row.id, user.id);
        toast.success(
          action === "match"
            ? t("finance.paymentReview.toasts.matched")
            : t("finance.paymentReview.toasts.verified"),
        );
        await load();
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
      } finally {
        setBusyId(null);
      }
    },
    [user, t, load],
  );

  const submitReject = async () => {
    if (!rejectTarget || !user?.id) return;
    setBusyId(rejectTarget.id);
    try {
      await paymentsReviewService.reject(rejectTarget.id, user.id, rejectReason || undefined);
      toast.success(t("finance.paymentReview.toasts.rejected"));
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setBusyId(null);
    }
  };

  const columns = useMemo<ColumnDef<PaymentReviewRow, unknown>[]>(
    () => [
      {
        id: "paymentNumber",
        meta: { titleKey: "finance.paymentReview.fields.number" },
        accessorFn: (row) => row.paymentNumber,
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
            <Link
              className="text-primary hover:underline"
              href={`/store-orders/${row.original.storeOrder.id}`}
            >
              {row.original.storeOrder.internalOrderId}
            </Link>
          ) : (
            (row.original.lead?.leadNumber ?? "—")
          ),
      },
      {
        id: "amount",
        meta: { titleKey: "finance.paymentReview.fields.amount" },
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {Number(row.original.amount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            {row.original.currency?.code}
          </span>
        ),
      },
      {
        id: "remaining",
        meta: { titleKey: "finance.paymentReview.fields.remaining" },
        cell: ({ row }) => (
          <span dir="ltr" className="tabular-nums">
            {row.original.settlement
              ? row.original.settlement.outstanding.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "—"}
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
                  : row.original.status === "MATCHED"
                    ? "info"
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
          if (!canConfirm) return null;
          return (
            <div className="flex flex-wrap gap-1">
              {payment.status === "PENDING" ? (
                <EnterpriseButton
                  size="xs"
                  disabled={busyId === payment.id}
                  onClick={() => void act(payment, "match")}
                >
                  <Link2 className="size-3" />
                  {t("finance.paymentReview.actions.match")}
                </EnterpriseButton>
              ) : null}
              {payment.status === "MATCHED" ? (
                <EnterpriseButton
                  size="xs"
                  variant="success"
                  disabled={busyId === payment.id}
                  onClick={() => void act(payment, "verify")}
                >
                  <Check className="size-3" />
                  {t("finance.paymentReview.actions.verify")}
                </EnterpriseButton>
              ) : null}
              {payment.status === "PENDING" || payment.status === "MATCHED" ? (
                <EnterpriseButton
                  size="xs"
                  variant="destructive"
                  disabled={busyId === payment.id}
                  onClick={() => setRejectTarget(payment)}
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
    [act, busyId, canConfirm, t],
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

      <EnterpriseModal
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        title={t("finance.paymentReview.actions.reject")}
        footer={() => (
          <>
            <EnterpriseButton variant="outline" onClick={() => setRejectTarget(null)}>
              {t("common.close")}
            </EnterpriseButton>
            <EnterpriseButton variant="destructive" onClick={() => void submitReject()}>
              {t("finance.paymentReview.actions.reject")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-2">
          <Label>{t("finance.paymentReview.fields.reason")}</Label>
          <Input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
        </div>
      </EnterpriseModal>

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
  return (
    <div className="flex flex-col gap-3 text-body">
      <p>
        {t("finance.paymentReview.fields.customer")}:{" "}
        {payment.storeOrder?.partner?.name ?? payment.lead?.customerName ?? payment.senderName}
      </p>
      <p>
        {t("finance.paymentReview.fields.amount")}:{" "}
        <span dir="ltr">
          {payment.amount} {payment.currency?.code}
        </span>
      </p>
      <p>
        {t("finance.paymentReview.fields.source")}: {payment.paymentSource?.name ?? "—"}
      </p>
      <p>
        {t("finance.paymentReview.fields.account")}: {payment.receivingAccount?.name ?? "—"}
      </p>
      <p>
        {t("finance.paymentReview.fields.proof")}: {payment.attachments.length}
      </p>
      {payment.settlement ? (
        <p>
          {t("finance.paymentReview.fields.remaining")}:{" "}
          <span dir="ltr">{payment.settlement.outstanding.toFixed(2)}</span>
        </p>
      ) : null}
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
