"use client";

import type { ReactNode } from "react";
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
} from "@/components/documents/document-line-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { TruncateText } from "@/components/shared/truncate-text";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type DocumentLineReviewRow = {
  id: string;
  productName: string;
  meta?: ReactNode;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectDisabled?: boolean;
  quantity?: number;
  onQuantityChange?: (quantity: number) => void;
  quantityMin?: number;
  quantityMax?: number;
  quantityDisabled?: boolean;
  warehouse?: WarehouseRow | null;
  onWarehouseChange?: (warehouse: WarehouseRow) => void;
  warehouseError?: boolean;
  warehouseDisabled?: boolean;
};

/**
 * Read-only product rows with optional select / qty / warehouse — used by
 * convert-to-order, convert-to-invoice, and create-return dialogs. Does not
 * compute prices; callers submit existing document quantities only.
 */
export function DocumentLineReviewTable({
  rows,
  showSelect = false,
  showWarehouse = false,
  showQuantity = true,
  quantityLabel,
  empty,
  isLoading = false,
}: {
  rows: DocumentLineReviewRow[];
  showSelect?: boolean;
  showWarehouse?: boolean;
  showQuantity?: boolean;
  quantityLabel?: string;
  empty?: ReactNode;
  isLoading?: boolean;
}) {
  const { t } = useLocale();
  const minWidthClass = showWarehouse
    ? "min-w-[720px]"
    : showSelect
      ? "min-w-[560px]"
      : "min-w-[480px]";

  return (
    <DocumentLineTable minWidthClass={minWidthClass}>
      <colgroup>
        {showSelect ? <col className="w-(--width-control-check)" /> : null}
        <col />
        {showWarehouse ? <col className="w-(--width-control-warehouse)" /> : null}
        {showQuantity ? <col className="w-(--width-control-quantity)" /> : null}
      </colgroup>
      <DocumentLineTableHeader>
        <DocumentLineTableRow className="hover:bg-transparent">
          {showSelect ? (
            <DocumentLineTableHead
              className={cn(documentLineHeadClass, "w-(--width-control-check)")}
            />
          ) : null}
          <DocumentLineTableHead className={documentLineHeadClass}>
            {t("sales.editor.grid.product")}
          </DocumentLineTableHead>
          {showWarehouse ? (
            <DocumentLineTableHead
              className={cn(documentLineHeadClass, "w-(--width-control-warehouse)")}
            >
              {t("sales.editor.grid.warehouse")}
            </DocumentLineTableHead>
          ) : null}
          {showQuantity ? (
            <DocumentLineTableHead
              className={cn(documentLineNumericHeadClass, "w-(--width-control-quantity)")}
            >
              {quantityLabel ?? t("sales.editor.grid.quantity")}
            </DocumentLineTableHead>
          ) : null}
        </DocumentLineTableRow>
      </DocumentLineTableHeader>
      <DocumentLineTableBody>
        {isLoading ? (
          <DocumentLineTableRow className="hover:bg-transparent">
            <DocumentLineTableCell
              colSpan={(showSelect ? 1 : 0) + 1 + (showWarehouse ? 1 : 0) + (showQuantity ? 1 : 0)}
              className={cn(documentLineCellClass, "py-6 text-center text-muted-foreground")}
            >
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-3.5" />
                {t("common.loading")}
              </span>
            </DocumentLineTableCell>
          </DocumentLineTableRow>
        ) : rows.length === 0 ? (
          <DocumentLineTableRow className="hover:bg-transparent">
            <DocumentLineTableCell
              colSpan={(showSelect ? 1 : 0) + 1 + (showWarehouse ? 1 : 0) + (showQuantity ? 1 : 0)}
              className={cn(documentLineCellClass, "py-6 text-center text-muted-foreground")}
            >
              {empty ?? t("common.noResults")}
            </DocumentLineTableCell>
          </DocumentLineTableRow>
        ) : (
          rows.map((row) => (
            <DocumentLineTableRow
              key={row.id}
              className={cn("hover:bg-muted/40", row.selectDisabled && "opacity-60")}
            >
              {showSelect ? (
                <DocumentLineTableCell
                  className={cn(documentLineCellClass, "w-(--width-control-check)")}
                >
                  <Checkbox
                    checked={row.selected ?? false}
                    disabled={row.selectDisabled}
                    onCheckedChange={(checked) => row.onSelectedChange?.(!!checked)}
                    aria-label={row.productName}
                  />
                </DocumentLineTableCell>
              ) : null}
              <DocumentLineTableCell className={cn(documentLineCellClass, "min-w-0")}>
                <div className="flex min-w-0 items-center gap-2">
                  <TruncateText className="w-full min-w-0 flex-1 font-medium">
                    {row.productName}
                  </TruncateText>
                  {row.meta ? (
                    <span className="shrink-0 text-caption text-muted-foreground">{row.meta}</span>
                  ) : null}
                </div>
              </DocumentLineTableCell>
              {showWarehouse ? (
                <DocumentLineTableCell
                  className={cn(documentLineCellClass, "w-(--width-control-warehouse) min-w-0")}
                >
                  <WarehousePicker
                    embedded
                    value={row.warehouse ?? null}
                    error={row.warehouseError}
                    disabled={row.warehouseDisabled}
                    onChange={(warehouse) => row.onWarehouseChange?.(warehouse)}
                  />
                </DocumentLineTableCell>
              ) : null}
              {showQuantity ? (
                <DocumentLineTableCell
                  className={cn(documentLineNumericCellClass, "w-(--width-control-quantity)")}
                >
                  <Input
                    type="number"
                    min={row.quantityMin ?? 1}
                    max={row.quantityMax}
                    dir="ltr"
                    inputSize="compact-md"
                    inputMode="decimal"
                    className="px-2 text-end tabular-nums"
                    disabled={row.quantityDisabled}
                    value={row.quantity ?? ""}
                    onChange={(event) => {
                      const raw = event.target.valueAsNumber || row.quantityMin || 0;
                      const capped =
                        typeof row.quantityMax === "number" ? Math.min(raw, row.quantityMax) : raw;
                      row.onQuantityChange?.(capped);
                    }}
                  />
                </DocumentLineTableCell>
              ) : null}
            </DocumentLineTableRow>
          ))
        )}
      </DocumentLineTableBody>
    </DocumentLineTable>
  );
}
