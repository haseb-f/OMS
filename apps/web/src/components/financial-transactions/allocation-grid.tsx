"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
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

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Financial Transactions & Matching Engine (TASK-043) — the editable table
 * of "which invoice gets how much of this receipt/payment," reused as-is
 * for both Customer Receipts and Supplier Payments (party-agnostic, same
 * "one grid, both domains" contract `ProductLineItemsGrid` already
 * established for Sales/Purchasing). Rows are added via
 * `OpenInvoicesTable`, never typed from scratch here — this component only
 * edits the amount on an already-selected invoice, or removes it.
 */
export function AllocationGrid({
  lines,
  onChange,
  disabled,
}: {
  lines: AllocationGridLine[];
  onChange: (lines: AllocationGridLine[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();

  const updateAmount = (id: string, allocatedAmount: number) => {
    onChange(lines.map((line) => (line.id === id ? { ...line, allocatedAmount } : line)));
  };

  const removeLine = (id: string) => {
    onChange(lines.filter((line) => line.id !== id));
  };

  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-caption text-muted-foreground">
        {t("financialTransactions.allocationGrid.empty")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table className="w-full table-fixed border-separate border-spacing-0">
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("financialTransactions.allocationGrid.invoice")}</TableHead>
            <TableHead className="w-40 text-end">
              {t("financialTransactions.allocationGrid.remaining")}
            </TableHead>
            <TableHead className="w-(--width-control-price) text-center">
              {t("financialTransactions.allocationGrid.amount")}
            </TableHead>
            <TableHead className="w-(--width-control-actions)" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const isOverpaid = line.allocatedAmount > line.remainingBalance;
            const isFullyPaid =
              line.allocatedAmount > 0 && line.allocatedAmount >= line.remainingBalance;
            return (
              <TableRow key={line.id}>
                <TableCell className="align-middle">
                  <div className="flex items-center gap-2">
                    <Link href={line.invoiceHref} className="hover:underline">
                      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {line.invoiceNumber}
                      </code>
                    </Link>
                    {isFullyPaid && (
                      <StatusBadge
                        label={t("financialTransactions.allocationGrid.fullyPaid")}
                        tone="success"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-middle text-end" dir="ltr">
                  {formatMoney(line.remainingBalance)}
                </TableCell>
                <TableCell className="w-(--width-control-price) align-middle">
                  <Input
                    type="number"
                    min={0}
                    max={line.remainingBalance}
                    dir="ltr"
                    inputSize="compact-md"
                    className={cn("text-center", isOverpaid && "border-destructive")}
                    value={line.allocatedAmount}
                    disabled={disabled}
                    onChange={(event) => updateAmount(line.id, event.target.valueAsNumber || 0)}
                  />
                  {isOverpaid && (
                    <p className="mt-1 text-end text-xs text-destructive">
                      {t("financialTransactions.allocationGrid.overpaid")}
                    </p>
                  )}
                </TableCell>
                <TableCell className="w-(--width-control-actions) align-middle">
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={t("common.remove")}
                    onClick={() => removeLine(line.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </EnterpriseButton>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
