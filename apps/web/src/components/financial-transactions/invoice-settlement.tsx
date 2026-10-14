"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, FileCheck2, PencilLine, Unlink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  tableNumericCellClass,
} from "@/components/ui/table";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { MoneyInput } from "@/components/shared/money-input";
import { RowActionsMenu } from "@/components/shared/data-table/row-actions-menu";
import { StatusBadge } from "@/components/business/status-badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { notifyDataChanged, useDataChanged } from "@/hooks/use-data-changed";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { reportApiError, reportSuccess } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import {
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { customerReceiptsService } from "@/services/customer-receipts-service";
import { supplierPaymentsService } from "@/services/supplier-payments-service";
import { salesInvoicesService } from "@/services/sales-invoices-service";
import { purchaseInvoicesService } from "@/services/purchase-invoices-service";
import type {
  FinancialTransactionStatusValue,
  InvoicePaymentStatusValue,
} from "@/services/financial-transactions-service";
import type {
  InvoiceSettlement,
  InvoiceSettlementEntry,
} from "@/services/invoice-settlement-types";

export type InvoiceSettlementKind = "sales" | "purchase";

/** What an invoice detail response already carries (R20 + R22 contract 1). */
export interface InvoiceSettlementSource {
  id: string;
  status: string;
  grandTotal: string | number;
  allocatedTotal: number;
  remainingBalance: number;
  paymentStatus: InvoicePaymentStatusValue;
  paidTotal?: number;
  creditedTotal?: number;
  currency?: { code: string } | null;
  allocations?: {
    id: string;
    allocatedAmount: string;
    transaction: {
      id: string;
      transactionNumber: string;
      status: FinancialTransactionStatusValue;
    } | null;
  }[];
  returns?: { id: string; returnNumber: string; status: string }[];
}

/**
 * The settlement of one invoice: `GET …/invoices/:id/settlement` (R22
 * contract 2), else — before the endpoint exists on this API — the same
 * shape built from the invoice's own figures and allocation / return links
 * (no dates, no actions; `partial` says so). Never recomputes a balance.
 */
export function settlementFromInvoice(
  kind: InvoiceSettlementKind,
  invoice: InvoiceSettlementSource,
): InvoiceSettlement {
  const currencyCode = invoice.currency?.code ?? null;
  const payments: InvoiceSettlementEntry[] = (invoice.allocations ?? [])
    .filter((allocation) => allocation.transaction)
    .map((allocation) => ({
      kind: "PAYMENT",
      documentId: allocation.transaction!.id,
      documentNumber: allocation.transaction!.transactionNumber,
      documentType: kind === "sales" ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT",
      date: null,
      status: allocation.transaction!.status,
      amount: Number(allocation.allocatedAmount),
      currencyCode,
      allocationId: allocation.id,
      canUnallocate: false,
      canCancel: false,
    }));
  const credits: InvoiceSettlementEntry[] = (invoice.returns ?? []).map((row) => ({
    kind: "CREDIT_NOTE",
    documentId: row.id,
    documentNumber: row.returnNumber,
    documentType: kind === "sales" ? "SALES_RETURN" : "PURCHASE_RETURN",
    date: null,
    status: row.status,
    amount: Number.NaN,
    currencyCode,
    canUnallocate: false,
    canCancel: false,
  }));
  return {
    summary: {
      grandTotal: Number(invoice.grandTotal),
      paidTotal: invoice.paidTotal ?? invoice.allocatedTotal,
      creditedTotal: invoice.creditedTotal ?? 0,
      remainingBalance: invoice.remainingBalance,
      paymentStatus: invoice.paymentStatus,
      currencyCode,
    },
    entries: [...payments, ...credits],
  };
}

const loaders: Record<InvoiceSettlementKind, (id: string) => Promise<InvoiceSettlement>> = {
  sales: (id) => salesInvoicesService.settlement(id),
  purchase: (id) => purchaseInvoicesService.settlement(id),
};

/**
 * The invoice's settlement, kept fresh (R22 §5): reloaded after any money
 * operation here or in another tab and when the person returns to the tab
 * (`onStale` lets the page reload the invoice itself too). Only for a posted
 * invoice — a draft has nothing settled and its form must never be reloaded
 * under the person's hands.
 */
export function useInvoiceSettlement(
  kind: InvoiceSettlementKind,
  invoice: InvoiceSettlementSource | null,
  onStale?: () => void,
) {
  const posted = Boolean(invoice && invoice.status !== "DRAFT");
  const invoiceId = invoice?.id ?? null;
  const [remote, setRemote] = useState<InvoiceSettlement | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!invoiceId) return;
    loaders[kind](invoiceId)
      .then((result) => {
        setRemote(result);
        setFailed(false);
      })
      .catch(() => {
        setRemote(null);
        setFailed(true);
      });
  }, [kind, invoiceId]);

  useEffect(() => {
    if (posted) load();
  }, [posted, load]);

  useDataChanged(
    "settlement",
    () => {
      load();
      onStale?.();
    },
    posted,
  );

  const settlement = remote ?? (invoice ? settlementFromInvoice(kind, invoice) : null);
  return { settlement, partial: !remote && failed, reload: load };
}

const DOCUMENT_HREF: Record<string, (id: string) => string> = {
  CUSTOMER_RECEIPT: (id) => `/sales/payments/${id}`,
  SUPPLIER_PAYMENT: (id) => `/purchasing/payments/${id}`,
  SALES_RETURN: (id) => `/sales/returns/${id}`,
  PURCHASE_RETURN: (id) => `/purchasing/purchase-returns/${id}`,
};

function entryHref(kind: InvoiceSettlementKind, entry: InvoiceSettlementEntry): string {
  const byType = DOCUMENT_HREF[entry.documentType];
  if (byType) return byType(entry.documentId);
  if (entry.kind === "CREDIT_NOTE") {
    return kind === "sales"
      ? DOCUMENT_HREF.SALES_RETURN(entry.documentId)
      : DOCUMENT_HREF.PURCHASE_RETURN(entry.documentId);
  }
  return kind === "sales"
    ? DOCUMENT_HREF.CUSTOMER_RECEIPT(entry.documentId)
    : DOCUMENT_HREF.SUPPLIER_PAYMENT(entry.documentId);
}

type PendingAction =
  | { type: "unallocate"; entry: InvoiceSettlementEntry }
  | { type: "edit"; entry: InvoiceSettlementEntry }
  | { type: "cancel"; entry: InvoiceSettlementEntry };

/**
 * R22 §5 — the invoice's settlement history (sales and purchase alike):
 * every linked voucher with its date, status and the amount it applies to
 * this invoice, and credit notes on their own lines (never as cash). The
 * permitted actions — unallocate, change the amount (one atomic call, no new
 * cash movement), cancel the voucher — come from the API (`canUnallocate`,
 * `canCancel`); after each the invoice and every open view refresh.
 */
export function InvoiceSettlementHistory({
  kind,
  settlement,
  partial,
  onChanged,
}: {
  kind: InvoiceSettlementKind;
  settlement: InvoiceSettlement | null;
  partial?: boolean;
  /** Extra refresh after an action (the `settlement` signal already reloads `useInvoiceSettlement`). */
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [editAmount, setEditAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const service = kind === "sales" ? customerReceiptsService : supplierPaymentsService;
  const entries = settlement?.entries ?? [];

  const run = async (
    operation: () => Promise<unknown>,
    successKey:
      | "vouchers.settlement.toasts.unallocated"
      | "vouchers.settlement.toasts.updated"
      | "vouchers.settlement.toasts.cancelled",
  ) => {
    setBusy(true);
    try {
      await operation();
      reportSuccess(t(successKey));
      setPending(null);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setBusy(false);
      notifyDataChanged("settlement");
      onChanged?.();
    }
  };

  const confirmPending = () => {
    if (!pending) return;
    const { entry } = pending;
    if (pending.type === "unallocate" && entry.allocationId) {
      void run(
        () => service.unallocate(entry.documentId, entry.allocationId!),
        "vouchers.settlement.toasts.unallocated",
      );
    } else if (pending.type === "edit" && entry.allocationId && editAmount && editAmount > 0) {
      void run(
        () =>
          service.updateAllocation(entry.documentId, entry.allocationId!, {
            allocatedAmount: editAmount,
          }),
        "vouchers.settlement.toasts.updated",
      );
    } else if (pending.type === "cancel") {
      void run(() => service.cancel(entry.documentId), "vouchers.settlement.toasts.cancelled");
    }
  };

  const money = (entry: InvoiceSettlementEntry) =>
    formatMoney(entry.amount, entry.currencyCode ?? undefined);
  const status = (entry: InvoiceSettlementEntry) => {
    const code = entry.status as FinancialTransactionStatusValue;
    const known = TRANSACTION_STATUS_LABEL_KEY[code];
    return known ? (
      <StatusBadge label={t(known)} tone={TRANSACTION_STATUS_TONE[code]} />
    ) : (
      <StatusBadge label={String(entry.status)} tone="neutral" />
    );
  };

  const kindLabel = (entry: InvoiceSettlementEntry) =>
    t(
      entry.kind === "CREDIT_NOTE"
        ? "vouchers.settlement.kinds.CREDIT_NOTE"
        : kind === "sales"
          ? "vouchers.settlement.kinds.PAYMENT_IN"
          : "vouchers.settlement.kinds.PAYMENT_OUT",
    );
  const actions = (entry: InvoiceSettlementEntry) => (
    <RowActionsMenu
      label={t("common.actions")}
      actions={[
        {
          key: "edit",
          label: t("vouchers.settlement.actions.editAmount"),
          icon: PencilLine,
          hidden: !entry.canUnallocate || !entry.allocationId,
          onSelect: () => {
            setEditAmount(entry.amount);
            setPending({ type: "edit", entry });
          },
        },
        {
          key: "unallocate",
          label: t("vouchers.settlement.actions.unallocate"),
          icon: Unlink,
          hidden: !entry.canUnallocate || !entry.allocationId,
          onSelect: () => setPending({ type: "unallocate", entry }),
        },
        {
          key: "cancel",
          label: t("vouchers.settlement.actions.cancelVoucher"),
          icon: Ban,
          destructive: true,
          separatorBefore: true,
          hidden: !entry.canCancel,
          onSelect: () => setPending({ type: "cancel", entry }),
        },
      ]}
    />
  );
  const documentLink = (entry: InvoiceSettlementEntry) => (
    <Link
      href={entryHref(kind, entry)}
      dir="ltr"
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary hover:underline"
    >
      {entry.documentNumber}
    </Link>
  );

  const dialogVoucher = pending?.entry.documentNumber ?? "";
  const dialogAmount = pending ? money(pending.entry) : "";

  return (
    <DetailSection title={t("vouchers.settlement.history")}>
      {partial ? (
        <p className="text-caption text-muted-foreground">
          {t("vouchers.settlement.partialHistory")}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <EmptyState icon={FileCheck2} title={t("vouchers.settlement.empty")} />
      ) : isMobile ? (
        <ul className="flex flex-col divide-y divide-border">
          {entries.map((entry) => (
            <li
              key={`${entry.kind}-${entry.documentId}-${entry.allocationId ?? ""}`}
              className="flex items-start justify-between gap-2 py-2"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {documentLink(entry)}
                  {status(entry)}
                </div>
                <span className="text-caption text-muted-foreground">
                  {kindLabel(entry)}
                  {entry.date ? (
                    <>
                      {" "}
                      · <bdi className="num">{formatDate(entry.date)}</bdi>
                    </>
                  ) : null}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <bdi className="num font-medium">{money(entry)}</bdi>
                {actions(entry)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("vouchers.settlement.columns.document")}</TableHead>
              <TableHead>{t("vouchers.settlement.columns.date")}</TableHead>
              <TableHead>{t("vouchers.settlement.columns.kind")}</TableHead>
              <TableHead>{t("vouchers.settlement.columns.status")}</TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("vouchers.settlement.columns.amount")}
              </TableHead>
              <TableHead className="w-(--width-control-actions)" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={`${entry.kind}-${entry.documentId}-${entry.allocationId ?? ""}`}>
                <TableCell>{documentLink(entry)}</TableCell>
                <TableCell>
                  {entry.date ? <span className="num">{formatDate(entry.date)}</span> : "—"}
                </TableCell>
                <TableCell>{kindLabel(entry)}</TableCell>
                <TableCell>{status(entry)}</TableCell>
                <TableCell numeric className="font-medium">
                  {money(entry)}
                </TableCell>
                <TableCell>{actions(entry)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        tone={pending?.type === "cancel" ? "destructive" : "warning"}
        title={
          pending?.type === "cancel"
            ? t("vouchers.settlement.cancelTitle", { voucher: dialogVoucher })
            : pending?.type === "edit"
              ? t("vouchers.settlement.editTitle", { voucher: dialogVoucher })
              : t("vouchers.settlement.unallocateTitle", { voucher: dialogVoucher })
        }
        description={
          pending?.type === "cancel"
            ? t("vouchers.settlement.cancelDescription")
            : pending?.type === "edit"
              ? t("vouchers.settlement.editDescription")
              : t("vouchers.settlement.unallocateDescription", { amount: dialogAmount })
        }
        extra={
          pending?.type === "edit" ? (
            <MoneyInput
              aria-label={t("vouchers.settlement.actions.editAmount")}
              inputSize="prominent"
              value={editAmount ?? ""}
              adornment={pending.entry.currencyCode ?? undefined}
              onValueChange={(value) => setEditAmount(value)}
            />
          ) : undefined
        }
        confirmDisabled={pending?.type === "edit" && !(editAmount && editAmount > 0)}
        isConfirming={busy}
        confirmLabel={
          pending?.type === "cancel"
            ? t("vouchers.settlement.actions.cancelVoucher")
            : pending?.type === "edit"
              ? t("vouchers.settlement.actions.editAmount")
              : t("vouchers.settlement.actions.unallocate")
        }
        cancelLabel={t("common.close")}
        onConfirm={confirmPending}
      />
    </DetailSection>
  );
}
