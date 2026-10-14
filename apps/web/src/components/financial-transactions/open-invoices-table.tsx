"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileCheck2, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  tableNumericCellClass,
} from "@/components/ui/table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyInput } from "@/components/shared/money-input";
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

/** Below this width the columns no longer fit their figures: rows become cards. */
const TABLE_MIN_WIDTH = 720;

/** One row of the table: an open invoice, or an invoice this voucher already settled in full. */
export type VoucherInvoiceRow = OpenInvoiceRow & {
  /** The invoice's own route (sales vs purchase) — every document reference is a real link. */
  href?: string;
  /** Read-only line (e.g. the part of a receipt an advance refund paid back). */
  locked?: boolean;
};

/**
 * One invoice as the voucher's allocation table shows it (R20, R22): the
 * invoice total, what earlier confirmed vouchers paid, credit notes applied
 * apart from cash, what this voucher applies, and what REMAINS once this
 * voucher counts — always `total = paid before + credit + this voucher +
 * remaining`. For a confirmed voucher the API's figures already include its
 * own lines, so «remaining» is the invoice's real balance (R22 §4, measured:
 * the old table showed the balance before the voucher). Display only.
 */
export function describeOpenInvoice(
  invoice: OpenInvoiceRow,
  thisVoucher: number,
  confirmedVoucher: boolean,
) {
  const own = confirmedVoucher ? thisVoucher : 0;
  const credited = round2(invoice.creditedTotal ?? 0);
  const remaining = confirmedVoucher
    ? round2(invoice.remainingBalance)
    : round2(invoice.remainingBalance - thisVoucher);
  return {
    paidBefore: Math.max(round2(invoice.allocatedTotal - own), 0),
    credited,
    /** What this invoice could take from this voucher (its balance before it). */
    openBefore: round2(invoice.remainingBalance + own),
    thisVoucher,
    remaining,
  };
}

/**
 * The rows the voucher's allocation table lists: the party's open invoices,
 * plus every invoice this voucher already allocates that is no longer open
 * (fully settled by it) — so a line can always be seen, changed or removed
 * in the ONE table.
 */
export function mergeAllocatedInvoices(
  openInvoices: readonly OpenInvoiceRow[],
  lines: readonly {
    invoiceId: string;
    invoiceNumber: string;
    invoiceHref?: string;
    allocatedAmount: number;
    grandTotal?: number | null;
    locked?: boolean;
  }[],
  hrefOf: (invoiceId: string) => string,
): VoucherInvoiceRow[] {
  const rows: VoucherInvoiceRow[] = openInvoices.map((invoice) => ({
    ...invoice,
    href: hrefOf(invoice.invoiceId),
  }));
  const known = new Set(openInvoices.map((invoice) => invoice.invoiceId));
  for (const line of lines) {
    if (!line.invoiceId || known.has(line.invoiceId)) continue;
    known.add(line.invoiceId);
    const total = line.grandTotal ?? line.allocatedAmount;
    rows.push({
      invoiceId: line.invoiceId,
      invoiceNumber: line.invoiceNumber,
      documentDate: "",
      currencyId: null,
      currencyCode: null,
      grandTotal: total,
      allocatedTotal: total,
      remainingBalance: 0,
      paymentStatus: "PAID",
      href: line.invoiceHref ?? hrefOf(line.invoiceId),
      locked: line.locked,
    });
  }
  return rows;
}

/**
 * Financial Transactions & Matching Engine (TASK-043, R20, R22) — the
 * party's open invoices for a receipt / supplier payment, party-agnostic
 * (`OpenInvoiceRow`s). R22: the ONE allocation surface of the voucher card —
 * each row carries an inline «this voucher» amount (`onAllocationChange`),
 * replacing the separate allocation grid and summaries; "Pay all remaining"
 * fills them oldest first. `readOnly` (profile tabs) shows the figures only.
 * An invoice in another currency than the voucher cannot be allocated.
 * Numeric cells use the shared `TableCell numeric` (header and figures on
 * the same logical end edge in RTL and LTR). Below the tablet width rows
 * become cards.
 */
export function OpenInvoicesTable({
  invoices,
  isLoading,
  disabled,
  onAllocate,
  onAllocationChange,
  commitOnBlur = false,
  onPayAllRemaining,
  readOnly,
  allocations = [],
  confirmedVoucher = false,
  currency = null,
}: {
  invoices: VoucherInvoiceRow[];
  isLoading?: boolean;
  disabled?: boolean;
  /** Legacy row action ("+"): allocate the invoice's balance. Ignored when `onAllocationChange` is given. */
  onAllocate?: (invoice: OpenInvoiceRow) => void;
  /** R22 — the inline «this voucher» amount changed (0 removes the line). */
  onAllocationChange?: (invoice: VoucherInvoiceRow, amount: number) => void;
  /** A confirmed voucher changes allocations on the server: commit an amount on blur, not per keystroke. */
  commitOnBlur?: boolean;
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
          onAllocationChange={onAllocationChange}
          commitOnBlur={commitOnBlur}
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

/** The inline «this voucher» amount — live while drafting, committed on blur once posted. */
function ThisVoucherInput({
  invoice,
  amount,
  disabled,
  commitOnBlur,
  overLimit,
  onChange,
}: {
  invoice: VoucherInvoiceRow;
  amount: number;
  disabled?: boolean;
  commitOnBlur: boolean;
  overLimit: boolean;
  onChange: (amount: number) => void;
}) {
  const { t } = useLocale();
  const [pending, setPending] = useState<number | null>(null);
  const shown = pending ?? amount;
  return (
    <MoneyInput
      aria-label={`${t("vouchers.allocation.thisVoucher")} ${invoice.invoiceNumber}`}
      aria-invalid={overLimit || undefined}
      value={shown || ""}
      disabled={disabled || invoice.locked}
      onValueChange={(value) => {
        const next = round2(value ?? 0);
        if (commitOnBlur) setPending(next);
        else onChange(next);
      }}
      onBlur={() => {
        if (commitOnBlur && pending !== null) {
          if (pending !== amount) onChange(pending);
          setPending(null);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

function OpenInvoiceRows({
  invoices,
  disabled,
  onAllocate,
  onAllocationChange,
  commitOnBlur,
  onPayAllRemaining,
  readOnly,
  allocations,
  confirmedVoucher,
  currency,
  stacked,
}: {
  invoices: VoucherInvoiceRow[];
  disabled?: boolean;
  onAllocate?: (invoice: OpenInvoiceRow) => void;
  onAllocationChange?: (invoice: VoucherInvoiceRow, amount: number) => void;
  commitOnBlur: boolean;
  onPayAllRemaining?: () => void;
  readOnly?: boolean;
  allocations: readonly { invoiceId: string; allocatedAmount: number }[];
  confirmedVoucher: boolean;
  currency: SettlementCurrency | null;
  stacked: boolean;
}) {
  const { t } = useLocale();
  const inline = Boolean(onAllocationChange) && !readOnly;
  const showCredit = invoices.some((invoice) => (invoice.creditedTotal ?? 0) > 0);

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
    const overLimit = figures.thisVoucher > figures.openBefore + 0.005;
    const status = (
      <StatusBadge
        label={t(INVOICE_PAYMENT_STATUS_LABEL_KEY[invoice.paymentStatus])}
        tone={INVOICE_PAYMENT_STATUS_TONE[invoice.paymentStatus]}
      />
    );
    const notes = (
      <>
        {otherCurrency ? (
          <span className="block text-caption text-muted-foreground">
            {t("financialTransactions.openInvoices.otherCurrency", {
              currency: currency?.currencyCode ?? "",
            })}
          </span>
        ) : null}
        {invoice.locked ? (
          <span className="block text-caption text-muted-foreground">
            {t("vouchers.allocation.locked")}
          </span>
        ) : null}
        {overLimit ? (
          <span role="alert" className="block text-caption text-destructive">
            {t("financialTransactions.allocationGrid.overpaid")}
          </span>
        ) : null}
      </>
    );
    const amountControl = inline ? (
      <ThisVoucherInput
        invoice={invoice}
        amount={figures.thisVoucher}
        disabled={disabled || otherCurrency}
        commitOnBlur={commitOnBlur}
        overLimit={overLimit}
        onChange={(amount) => onAllocationChange?.(invoice, amount)}
      />
    ) : null;
    const allocateButton =
      readOnly || inline ? null : (
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
    return { invoice, figures, money, status, notes, amountControl, allocateButton };
  });

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-caption text-muted-foreground">
        {t("financialTransactions.openInvoices.count", {
          count: invoices.filter((invoice) => invoice.remainingBalance > 0).length,
        })}
        {inline ? ` · ${t("vouchers.allocation.hint")}` : null}
      </p>
      {!readOnly && onPayAllRemaining ? (
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
      ) : null}
    </div>
  );

  const invoiceRef = (invoice: VoucherInvoiceRow) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      {invoice.href ? (
        <Link
          href={invoice.href}
          dir="ltr"
          className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid"
        >
          {invoice.invoiceNumber}
        </Link>
      ) : (
        <code dir="ltr" className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs">
          {invoice.invoiceNumber}
        </code>
      )}
      {invoice.documentDate ? (
        <span className="num w-fit text-caption text-muted-foreground">
          {formatDate(invoice.documentDate)}
        </span>
      ) : null}
    </div>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {rows.map(({ invoice, figures, money, status, notes, amountControl, allocateButton }) => (
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
              {showCredit ? (
                <Figure label={t("vouchers.allocation.credited")} value={money(figures.credited)} />
              ) : null}
              <Figure
                label={t("financialTransactions.openInvoices.remaining")}
                value={money(figures.remaining)}
                strong
              />
              {!readOnly && !amountControl ? (
                <Figure
                  label={t("vouchers.allocation.thisVoucher")}
                  value={money(figures.thisVoucher)}
                  highlight={figures.thisVoucher > 0}
                />
              ) : null}
            </dl>
            {amountControl ? (
              <label data-testid="allocation-line" className="flex min-w-0 flex-col gap-1">
                <span className="text-caption text-muted-foreground">
                  {t("vouchers.allocation.thisVoucher")}
                </span>
                {amountControl}
              </label>
            ) : null}
            {notes}
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
              <TableHead className={tableNumericCellClass}>
                {t("financialTransactions.openInvoices.grandTotal")}
              </TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("financialTransactions.openInvoices.paidBefore")}
              </TableHead>
              {showCredit ? (
                <TableHead className={tableNumericCellClass}>
                  {t("vouchers.allocation.credited")}
                </TableHead>
              ) : null}
              {!readOnly && (
                <TableHead
                  className={cn(tableNumericCellClass, inline && "w-(--width-control-price)")}
                >
                  {t("vouchers.allocation.thisVoucher")}
                </TableHead>
              )}
              <TableHead className={tableNumericCellClass}>
                {t("financialTransactions.openInvoices.remaining")}
              </TableHead>
              <TableHead className="w-32">
                {t("financialTransactions.openInvoices.status")}
              </TableHead>
              {!readOnly && !inline && <TableHead className="w-(--width-control-actions)" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(
              ({ invoice, figures, money, status, notes, amountControl, allocateButton }) => (
                <TableRow key={invoice.invoiceId} data-testid="open-invoice">
                  <TableCell className="whitespace-normal">
                    {invoiceRef(invoice)}
                    {notes}
                  </TableCell>
                  <TableCell numeric>{money(invoice.grandTotal)}</TableCell>
                  <TableCell numeric>{money(figures.paidBefore)}</TableCell>
                  {showCredit ? <TableCell numeric>{money(figures.credited)}</TableCell> : null}
                  {!readOnly &&
                    (amountControl ? (
                      <TableCell data-testid="allocation-line" className={tableNumericCellClass}>
                        {amountControl}
                      </TableCell>
                    ) : (
                      <TableCell
                        numeric
                        className={cn(
                          figures.thisVoucher > 0
                            ? "font-semibold text-primary"
                            : "text-muted-foreground",
                        )}
                      >
                        {money(figures.thisVoucher)}
                      </TableCell>
                    ))}
                  <TableCell numeric className="font-medium">
                    {money(figures.remaining)}
                  </TableCell>
                  <TableCell>{status}</TableCell>
                  {!readOnly && !inline && <TableCell>{allocateButton}</TableCell>}
                </TableRow>
              ),
            )}
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
        className={cn(
          tableNumericCellClass,
          strong && "font-medium",
          highlight && "font-semibold text-primary",
        )}
      >
        <span className="num">{value}</span>
      </dd>
    </div>
  );
}
