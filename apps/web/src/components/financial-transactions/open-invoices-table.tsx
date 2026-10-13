"use client";

import { useRef } from "react";
import { FileCheck2, Plus } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useElementWidth } from "@/hooks/use-element-width";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import type { OpenInvoiceRow } from "@/services/financial-transactions-service";
import {
  INVOICE_PAYMENT_STATUS_LABEL_KEY,
  INVOICE_PAYMENT_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { isOtherCurrency, type SettlementCurrency } from "./settlement-currency";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Below this width the seven columns no longer fit their figures: rows become cards. */
const TABLE_MIN_WIDTH = 720;

/**
 * One open invoice as the allocation section shows it (R20): the invoice
 * total, what earlier confirmed vouchers paid, what was still open before this
 * voucher, and what this voucher applies — always `total = paid before + open`.
 * For a confirmed voucher the API's figures already include its own lines, so
 * they are taken back out. Figures only; the API derives every one of them.
 */
export function describeOpenInvoice(
  invoice: OpenInvoiceRow,
  thisVoucher: number,
  confirmedVoucher: boolean,
) {
  const own = confirmedVoucher ? thisVoucher : 0;
  return {
    paidBefore: Math.max(round2(invoice.allocatedTotal - own), 0),
    openBefore: round2(invoice.remainingBalance + own),
    thisVoucher,
  };
}

/**
 * Financial Transactions & Matching Engine (TASK-043) — every open (not
 * fully paid) invoice for the selected party, reused as-is for both
 * Customer Receipts (Sales Invoices) and Supplier Payments (Purchase
 * Invoices) — the rows are already domain-agnostic `OpenInvoiceRow`s by the
 * time they reach this component. Clicking a row adds/updates it in the
 * `AllocationGrid`; "Pay All Remaining" allocates every row's full
 * remaining balance in one action (capped upstream at the transaction's
 * own unallocated amount by the caller). R20: previous payments and this
 * voucher's allocation per invoice; an invoice in another currency than the
 * voucher cannot be allocated. Below the tablet breakpoint rows become cards.
 */
export function OpenInvoicesTable({
  invoices,
  isLoading,
  disabled,
  onAllocate,
  onPayAllRemaining,
  readOnly,
  allocations = [],
  confirmedVoucher = false,
  currency = null,
}: {
  invoices: OpenInvoiceRow[];
  isLoading?: boolean;
  disabled?: boolean;
  onAllocate?: (invoice: OpenInvoiceRow) => void;
  onPayAllRemaining?: () => void;
  /** Profile-tab usage (Customer/Supplier Payments tab) — shows the same rows with no allocate action and no "Pay All Remaining" button. */
  readOnly?: boolean;
  /** This voucher's allocation lines (shown as "This voucher"). */
  allocations?: readonly { invoiceId: string; allocatedAmount: number }[];
  /** The voucher is confirmed: its lines are already inside the invoices' paid figures. */
  confirmedVoucher?: boolean;
  /** The voucher's settlement currency — invoices in another currency are not allocatable. */
  currency?: SettlementCurrency | null;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const stacked = isMobile || (width !== null && width < TABLE_MIN_WIDTH);

  return (
    <div ref={containerRef} className="min-w-0">
      {isLoading ? (
        <p className="p-4 text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : invoices.length === 0 ? (
        <EmptyState icon={FileCheck2} title={t("financialTransactions.openInvoices.empty")} />
      ) : (
        <OpenInvoiceRows
          invoices={invoices}
          disabled={disabled}
          onAllocate={onAllocate}
          onPayAllRemaining={onPayAllRemaining}
          readOnly={readOnly}
          allocations={allocations}
          confirmedVoucher={confirmedVoucher}
          currency={currency}
          stacked={stacked}
        />
      )}
    </div>
  );
}

function OpenInvoiceRows({
  invoices,
  disabled,
  onAllocate,
  onPayAllRemaining,
  readOnly,
  allocations,
  confirmedVoucher,
  currency,
  stacked,
}: {
  invoices: OpenInvoiceRow[];
  disabled?: boolean;
  onAllocate?: (invoice: OpenInvoiceRow) => void;
  onPayAllRemaining?: () => void;
  readOnly?: boolean;
  allocations: readonly { invoiceId: string; allocatedAmount: number }[];
  confirmedVoucher: boolean;
  currency: SettlementCurrency | null;
  stacked: boolean;
}) {
  const { t } = useLocale();

  const thisVoucherBy = new Map<string, number>();
  for (const line of allocations) {
    thisVoucherBy.set(
      line.invoiceId,
      round2((thisVoucherBy.get(line.invoiceId) ?? 0) + line.allocatedAmount),
    );
  }

  const rows = invoices.map((invoice) => {
    const figures = describeOpenInvoice(
      invoice,
      thisVoucherBy.get(invoice.invoiceId) ?? 0,
      confirmedVoucher,
    );
    const otherCurrency = isOtherCurrency(invoice, currency);
    const money = (value: number) => formatMoney(value, invoice.currencyCode ?? undefined);
    const status = (
      <StatusBadge
        label={t(INVOICE_PAYMENT_STATUS_LABEL_KEY[invoice.paymentStatus])}
        tone={INVOICE_PAYMENT_STATUS_TONE[invoice.paymentStatus]}
      />
    );
    const otherCurrencyNote = otherCurrency ? (
      <span className="text-caption text-muted-foreground">
        {t("financialTransactions.openInvoices.otherCurrency", {
          currency: currency?.currencyCode ?? "",
        })}
      </span>
    ) : null;
    const allocateButton = readOnly ? null : (
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || otherCurrency}
        aria-label={`${t("financialTransactions.openInvoices.allocate")} ${invoice.invoiceNumber}`}
        onClick={() => onAllocate?.(invoice)}
      >
        <Plus className="size-3.5 text-muted-foreground" />
      </EnterpriseButton>
    );
    return { invoice, figures, otherCurrency, money, status, otherCurrencyNote, allocateButton };
  });

  const header = (
    <div className="flex items-center justify-between gap-2">
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
  );

  const invoiceRef = (invoice: OpenInvoiceRow) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <code dir="ltr" className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs">
        {invoice.invoiceNumber}
      </code>
      <span className="num text-caption text-muted-foreground">
        {formatDate(invoice.documentDate)}
      </span>
    </div>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {rows.map(({ invoice, figures, money, status, otherCurrencyNote, allocateButton }) => (
          <div
            key={invoice.invoiceId}
            data-testid="open-invoice"
            className="flex flex-col gap-2 rounded-sm border border-border bg-card p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              {invoiceRef(invoice)}
              <div className="flex items-center gap-1">
                {status}
                {allocateButton}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
              <Figure
                label={t("financialTransactions.openInvoices.grandTotal")}
                value={money(invoice.grandTotal)}
              />
              <Figure
                label={t("financialTransactions.openInvoices.paidBefore")}
                value={money(figures.paidBefore)}
              />
              <Figure
                label={t("financialTransactions.openInvoices.remaining")}
                value={money(figures.openBefore)}
                strong
              />
              {!readOnly ? (
                <Figure
                  label={t("financialTransactions.openInvoices.thisVoucher")}
                  value={money(figures.thisVoucher)}
                  highlight={figures.thisVoucher > 0}
                />
              ) : null}
            </dl>
            {otherCurrencyNote}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      <div className="rounded-md border border-border">
        <Table className="w-full table-fixed border-separate border-spacing-0">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("financialTransactions.openInvoices.invoice")}</TableHead>
              <TableHead className="text-end">
                {t("financialTransactions.openInvoices.grandTotal")}
              </TableHead>
              <TableHead className="text-end">
                {t("financialTransactions.openInvoices.paidBefore")}
              </TableHead>
              <TableHead className="text-end">
                {t("financialTransactions.openInvoices.remaining")}
              </TableHead>
              {!readOnly && (
                <TableHead className="text-end">
                  {t("financialTransactions.openInvoices.thisVoucher")}
                </TableHead>
              )}
              <TableHead className="w-32">
                {t("financialTransactions.openInvoices.status")}
              </TableHead>
              {!readOnly && <TableHead className="w-(--width-control-actions)" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ invoice, figures, money, status, otherCurrencyNote, allocateButton }) => (
              <TableRow key={invoice.invoiceId} data-testid="open-invoice">
                <TableCell className="align-middle">
                  {invoiceRef(invoice)}
                  {otherCurrencyNote}
                </TableCell>
                <TableCell className="num align-middle text-end" dir="ltr">
                  {money(invoice.grandTotal)}
                </TableCell>
                <TableCell className="num align-middle text-end" dir="ltr">
                  {money(figures.paidBefore)}
                </TableCell>
                <TableCell className="num align-middle text-end font-medium" dir="ltr">
                  {money(figures.openBefore)}
                </TableCell>
                {!readOnly && (
                  <TableCell
                    className={cn(
                      "num align-middle text-end",
                      figures.thisVoucher > 0
                        ? "font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                    dir="ltr"
                  >
                    {money(figures.thisVoucher)}
                  </TableCell>
                )}
                <TableCell className="align-middle">{status}</TableCell>
                {!readOnly && <TableCell className="align-middle">{allocateButton}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  highlight,
}: {
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        dir="ltr"
        className={cn(
          "num text-end",
          strong && "font-medium",
          highlight && "font-semibold text-primary",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
