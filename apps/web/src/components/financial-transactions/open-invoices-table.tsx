"use client";

import { Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FileCheck2 } from "lucide-react";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { OpenInvoiceRow } from "@/services/financial-transactions-service";
import {
  INVOICE_PAYMENT_STATUS_LABEL_KEY,
  INVOICE_PAYMENT_STATUS_TONE,
} from "@/config/financial-transactions/status";

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Financial Transactions & Matching Engine (TASK-043) — every open (not
 * fully paid) invoice for the selected party, reused as-is for both
 * Customer Receipts (Sales Invoices) and Supplier Payments (Purchase
 * Invoices) — the rows are already domain-agnostic `OpenInvoiceRow`s by the
 * time they reach this component. Clicking a row adds/updates it in the
 * `AllocationGrid`; "Pay All Remaining" allocates every row's full
 * remaining balance in one action (capped upstream at the transaction's
 * own unallocated amount by the caller).
 */
export function OpenInvoicesTable({
  invoices,
  isLoading,
  disabled,
  onAllocate,
  onPayAllRemaining,
  readOnly,
}: {
  invoices: OpenInvoiceRow[];
  isLoading?: boolean;
  disabled?: boolean;
  onAllocate?: (invoice: OpenInvoiceRow) => void;
  onPayAllRemaining?: () => void;
  /** Profile-tab usage (Customer/Supplier Payments tab) — shows the same rows with no allocate action and no "Pay All Remaining" button. */
  readOnly?: boolean;
}) {
  const { t } = useLocale();

  if (isLoading) {
    return <p className="p-4 text-caption text-muted-foreground">{t("common.loading")}</p>;
  }

  if (invoices.length === 0) {
    return <EmptyState icon={FileCheck2} title={t("financialTransactions.openInvoices.empty")} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-caption text-muted-foreground">
          {t("financialTransactions.openInvoices.count", { count: invoices.length })}
        </p>
        {!readOnly && (
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={disabled}
            onClick={onPayAllRemaining}
          >
            {t("financialTransactions.openInvoices.payAllRemaining")}
          </EnterpriseButton>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="w-full table-fixed border-separate border-spacing-0">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("financialTransactions.openInvoices.invoice")}</TableHead>
              <TableHead className="w-32">{t("financialTransactions.openInvoices.date")}</TableHead>
              <TableHead className="w-32 text-end">
                {t("financialTransactions.openInvoices.grandTotal")}
              </TableHead>
              <TableHead className="w-32 text-end">
                {t("financialTransactions.openInvoices.remaining")}
              </TableHead>
              <TableHead className="w-36">
                {t("financialTransactions.openInvoices.status")}
              </TableHead>
              {!readOnly && <TableHead className="w-(--width-control-actions)" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.invoiceId}>
                <TableCell className="align-middle">
                  <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {invoice.invoiceNumber}
                  </code>
                </TableCell>
                <TableCell className="align-middle">{formatDate(invoice.documentDate)}</TableCell>
                <TableCell className="align-middle text-end" dir="ltr">
                  {formatMoney(invoice.grandTotal)}
                </TableCell>
                <TableCell className="align-middle text-end font-medium" dir="ltr">
                  {formatMoney(invoice.remainingBalance)}
                </TableCell>
                <TableCell className="align-middle">
                  <StatusBadge
                    label={t(INVOICE_PAYMENT_STATUS_LABEL_KEY[invoice.paymentStatus])}
                    tone={INVOICE_PAYMENT_STATUS_TONE[invoice.paymentStatus]}
                  />
                </TableCell>
                {!readOnly && (
                  <TableCell className="align-middle">
                    <EnterpriseButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      aria-label={t("financialTransactions.openInvoices.allocate")}
                      onClick={() => onAllocate?.(invoice)}
                    >
                      <Plus className="size-3.5 text-muted-foreground" />
                    </EnterpriseButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
