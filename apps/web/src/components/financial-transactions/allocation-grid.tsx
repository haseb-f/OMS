"use client";

import { useRef } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  DocumentLineTable,
  DocumentLineTableBody,
  DocumentLineTableCell,
  DocumentLineTableHead,
  DocumentLineTableHeader,
  DocumentLineTableRow,
  documentLineCellClass,
  documentLineHeadClass,
  documentLineNumericCellClass,
  documentLineNumericHeadClass,
  lineColumnsWidth,
  type LineColumnWidth,
} from "@/components/documents/document-line-table";
import { StatusBadge } from "@/components/business/status-badge";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { MoneyInput } from "@/components/shared/money-input";
import { FieldMessage } from "@/components/ui/form";
import { useIsMobile } from "@/hooks/use-mobile";
import { useElementWidth } from "@/hooks/use-element-width";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export interface AllocationGridLine {
  /** Client-side row identity — never the DB allocation id at this layer (mirrors ProductLineItemsGridLine.id). */
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  /** TASK-050 — the invoice's own editor route (`/sales/invoices/:id` or `/purchasing/purchase-invoices/:id`), supplied by the caller since this grid is party-agnostic. Every reference to another document must be a real link, never plain text. */
  invoiceHref: string;
  /** Read-only context shown next to the amount — how much this invoice can still take, at the moment the row was added. */
  remainingBalance: number;
  allocatedAmount: number;
}

/** Amount columns fit 10+ digit figures (price token × 1.5, as in the other line grids). */
const AMOUNT_WIDTH = "w-(--width-control-price)";
const TABLE_COLUMNS: LineColumnWidth[] = [
  "--width-control-product-min",
  ["--width-control-price", 1],
  ["--width-control-price", 1],
  "--width-control-actions",
];

/**
 * Financial Transactions & Matching Engine (TASK-043) — the editable table
 * of "which invoice gets how much of this receipt/payment," reused as-is
 * for both Customer Receipts and Supplier Payments (party-agnostic). Rows
 * are added via `OpenInvoicesTable`, never typed from scratch here — this
 * component only edits the amount on an already-selected invoice, or
 * removes it. Same line-table chrome and numeric edge as every document
 * editor; below the columns' combined width it renders line cards.
 */
export function AllocationGrid({
  lines,
  onChange,
  disabled,
  documentLabel,
}: {
  lines: AllocationGridLine[];
  onChange: (lines: AllocationGridLine[]) => void;
  disabled?: boolean;
  /** Column header for the settled document — "Invoice" by default; a Customer Refund settles Sales Returns. */
  documentLabel?: string;
}) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const containerWidth = useElementWidth(containerRef);
  const stacked =
    isMobile || (containerWidth !== null && containerWidth < lineColumnsWidth(TABLE_COLUMNS));
  const documentHeader = documentLabel ?? t("financialTransactions.allocationGrid.invoice");

  const updateAmount = (id: string, allocatedAmount: number) => {
    onChange(lines.map((line) => (line.id === id ? { ...line, allocatedAmount } : line)));
  };

  const removeLine = (id: string) => {
    onChange(lines.filter((line) => line.id !== id));
  };

  if (lines.length === 0) {
    return (
      <div
        ref={containerRef}
        className="rounded-sm border border-dashed border-border p-6 text-center text-caption text-muted-foreground"
      >
        {t("financialTransactions.allocationGrid.empty")}
      </div>
    );
  }

  const describe = (line: AllocationGridLine) => {
    const isOverpaid = line.allocatedAmount > line.remainingBalance;
    const isFullyPaid = line.allocatedAmount > 0 && line.allocatedAmount >= line.remainingBalance;
    return { isOverpaid, isFullyPaid };
  };

  const documentLink = (line: AllocationGridLine, isFullyPaid: boolean) => (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        href={line.invoiceHref}
        className="num truncate font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {line.invoiceNumber}
      </Link>
      {isFullyPaid ? (
        <StatusBadge label={t("financialTransactions.allocationGrid.fullyPaid")} tone="success" />
      ) : null}
    </div>
  );

  const amountInput = (line: AllocationGridLine, isOverpaid: boolean) => (
    <MoneyInput
      max={line.remainingBalance}
      aria-label={`${t("financialTransactions.allocationGrid.amount")} ${line.invoiceNumber}`}
      aria-invalid={isOverpaid || undefined}
      className={cn(isOverpaid && "border-destructive")}
      value={line.allocatedAmount}
      disabled={disabled}
      onChange={(event) => updateAmount(line.id, event.target.valueAsNumber || 0)}
    />
  );

  const removeButton = (line: AllocationGridLine) => (
    <IconActionButton
      label={t("common.remove")}
      disabled={disabled}
      onClick={() => removeLine(line.id)}
    >
      <Trash2 className="size-3.5" />
    </IconActionButton>
  );

  const overpaidMessage = (
    <FieldMessage>{t("financialTransactions.allocationGrid.overpaid")}</FieldMessage>
  );

  if (stacked) {
    return (
      <div ref={containerRef} className="flex min-w-0 flex-col gap-2">
        {lines.map((line) => {
          const { isOverpaid, isFullyPaid } = describe(line);
          return (
            <div
              key={line.id}
              data-testid="allocation-line"
              className="flex flex-col gap-2 rounded-sm border border-border bg-card p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-caption text-muted-foreground">{documentHeader}</span>
                  {documentLink(line, isFullyPaid)}
                </div>
                {removeButton(line)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-caption text-muted-foreground">
                    {t("financialTransactions.allocationGrid.remaining")}
                  </span>
                  <span className="num text-body">{formatMoney(line.remainingBalance)}</span>
                </div>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-caption text-muted-foreground">
                    {t("financialTransactions.allocationGrid.amount")}
                  </span>
                  {amountInput(line, isOverpaid)}
                </label>
              </div>
              {isOverpaid ? overpaidMessage : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-w-0">
      <DocumentLineTable minWidthClass="min-w-0">
        <colgroup>
          <col className="w-(--width-control-product-min)" />
          <col className={AMOUNT_WIDTH} />
          <col className={AMOUNT_WIDTH} />
          <col className="w-(--width-control-actions)" />
        </colgroup>
        <DocumentLineTableHeader>
          <DocumentLineTableRow className="hover:bg-transparent">
            <DocumentLineTableHead className={documentLineHeadClass}>
              {documentHeader}
            </DocumentLineTableHead>
            <DocumentLineTableHead className={documentLineNumericHeadClass}>
              {t("financialTransactions.allocationGrid.remaining")}
            </DocumentLineTableHead>
            <DocumentLineTableHead className={documentLineNumericHeadClass}>
              {t("financialTransactions.allocationGrid.amount")}
            </DocumentLineTableHead>
            <DocumentLineTableHead className={documentLineHeadClass} />
          </DocumentLineTableRow>
        </DocumentLineTableHeader>
        <DocumentLineTableBody>
          {lines.map((line) => {
            const { isOverpaid, isFullyPaid } = describe(line);
            return (
              <DocumentLineTableRow key={line.id} data-testid="allocation-line">
                <DocumentLineTableCell className={documentLineCellClass}>
                  {documentLink(line, isFullyPaid)}
                </DocumentLineTableCell>
                <DocumentLineTableCell className={documentLineNumericCellClass}>
                  <span className="num">{formatMoney(line.remainingBalance)}</span>
                </DocumentLineTableCell>
                <DocumentLineTableCell
                  className={cn(documentLineNumericCellClass, isOverpaid && "whitespace-normal")}
                >
                  {amountInput(line, isOverpaid)}
                  {isOverpaid ? overpaidMessage : null}
                </DocumentLineTableCell>
                <DocumentLineTableCell className={documentLineCellClass}>
                  {removeButton(line)}
                </DocumentLineTableCell>
              </DocumentLineTableRow>
            );
          })}
        </DocumentLineTableBody>
      </DocumentLineTable>
    </div>
  );
}
