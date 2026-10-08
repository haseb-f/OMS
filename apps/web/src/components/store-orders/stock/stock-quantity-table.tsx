"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/providers/locale-provider";

export interface StockQuantityRow {
  storeOrderItemId: string;
  sku: string;
  name: string;
  /** Upper bound of the input (and what the hint names). */
  max: number;
  hint: string;
  /** Extra cell after the quantity (e.g. the received condition). */
  extra?: ReactNode;
}

/**
 * R15 W5a — the one per-line quantity entry the stock dialogs share
 * (dispatch, delivery, received back): product, hint, a whole-number input
 * bounded by `max`, and an optional extra cell. Compact table, numbers LTR.
 */
export function StockQuantityTable({
  rows,
  values,
  onChange,
  quantityLabel,
  extraLabel,
  disabled,
}: {
  rows: StockQuantityRow[];
  values: Record<string, number>;
  onChange: (storeOrderItemId: string, quantity: number) => void;
  quantityLabel: string;
  extraLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("storeOrderStock.columns.product")}</TableHead>
          <TableHead className="w-28">{quantityLabel}</TableHead>
          {extraLabel ? <TableHead className="w-36">{extraLabel}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.storeOrderItemId}>
            <TableCell>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-caption text-muted-foreground">
                  <span dir="ltr" className="font-mono">
                    {row.sku}
                  </span>
                  {" · "}
                  {row.hint}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Input
                dir="ltr"
                type="number"
                inputMode="numeric"
                min={0}
                max={row.max}
                step={1}
                disabled={disabled}
                value={String(values[row.storeOrderItemId] ?? 0)}
                onChange={(event) => {
                  const parsed = Math.floor(Number(event.target.value));
                  onChange(
                    row.storeOrderItemId,
                    Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), row.max) : 0,
                  );
                }}
                aria-label={`${quantityLabel} ${row.sku}`}
              />
            </TableCell>
            {extraLabel ? <TableCell>{row.extra}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
