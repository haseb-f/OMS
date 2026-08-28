"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductPicker } from "@/components/business/product-picker";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { useTaxes } from "@/hooks/use-reference-data";
import type { ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";
import { previewSalesLine } from "./sales-line-preview-math";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export interface ProductLineItemsGridLine {
  /** Client-side row identity (React key + keyboard-nav target) — never a document/DB id at this layer. */
  id: string;
  product: ProductRow | null;
  /** Optional free-text note under the product — e.g. `SalesInvoiceItem.description` et al., which every line-item table already carries. */
  description: string | null;
  warehouse: WarehouseRow | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxId: string | null;
  /**
   * The line's OWN unit — a saved line item has its own independent
   * `unitId` (`SalesQuotationItem.unitId` et al.), not necessarily
   * re-derivable from `product.unit` (a shallow product include on load
   * won't even carry that nested relation). Auto-populated from the
   * product's own unit when a product is first picked; display always
   * prefers this over `product.unit`.
   */
  unitId: string | null;
  unitName: string | null;
}

let nextRowId = 1;
export function createEmptyLine(): ProductLineItemsGridLine {
  return {
    id: `row-${nextRowId++}`,
    product: null,
    description: null,
    warehouse: null,
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
    taxId: null,
    unitId: null,
    unitName: null,
  };
}

/**
 * Sales Document Editor Foundation (TASK-039) — the ONE editable product
 * line-items grid every Sales document (Quotation/Order/Invoice/Return)
 * will use once built. A real `<table>` (`ui/table.tsx`, the same primitive
 * `EnterpriseDataTable` itself is built on — never a second grid engine),
 * not `EnterpriseDataTable`: that component is a paginated, read-only list
 * viewer, structurally the wrong tool for an editable, unpaginated,
 * add/remove-row form grid.
 *
 * Line totals shown per row are an INSTANT PREVIEW only (`previewSalesLine`
 * — pure client math, mirroring but never replacing the backend's own
 * calculation). Nothing here is ever submitted as an authoritative total;
 * that is `DocumentTotalsFooter`'s contract with whichever document type
 * wires this grid up.
 */
export function ProductLineItemsGrid({
  lines,
  onChange,
  requireWarehouse = true,
  disabled,
  compact = false,
}: {
  lines: ProductLineItemsGridLine[];
  onChange: (lines: ProductLineItemsGridLine[]) => void;
  /** Order/Invoice/Return require a Warehoude per line; Quotation doesn't (see apps/api's SalesLineItemInputDto). */
  requireWarehouse?: boolean;
  disabled?: boolean;
  /**
   * TASK-040 UI redesign, narrowed by TASK-057A: Tax and Unit are ALWAYS
   * visible in the row now (never hidden behind a panel — the Tax column
   * specifically must never move off-row). `compact` only still controls
   * whether Warehouse gets its own always-visible column versus a per-row
   * "More" disclosure, since Warehouse isn't one of the line fields every
   * document type requires (Quotation has none at all).
   */
  compact?: boolean;
}) {
  const { t } = useLocale();
  const taxes = useTaxes();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateLine = (id: string, patch: Partial<ProductLineItemsGridLine>) => {
    const index = lines.findIndex((line) => line.id === id);
    if (index === -1) return;
    const updated = { ...lines[index], ...patch };
    const next = lines.map((line) => (line.id === id ? updated : line));

    // Auto row creation: filling the product on the last row spawns a new blank one.
    const isLastRow = index === lines.length - 1;
    if (isLastRow && patch.product && !lines[index].product) {
      next.push(createEmptyLine());
    }
    onChange(next);
  };

  const removeLine = (id: string) => {
    const next = lines.filter((line) => line.id !== id);
    onChange(next.length > 0 ? next : [createEmptyLine()]);
  };

  const selectProduct = (id: string, product: ProductRow) => {
    updateLine(id, {
      product,
      unitPrice: product.salesPrice ? Number(product.salesPrice) : 0,
      taxId: product.taxId ?? null,
      unitId: product.unitId,
      unitName: product.unit?.name ?? null,
    });
  };

  const taxRateById = useMemo(
    () => new Map(taxes.map((tax) => [tax.id, Number(tax.rate)])),
    [taxes],
  );

  /** Arrow-key spreadsheet-style navigation between rows in the same column — Tab/Shift+Tab already work natively via DOM order. */
  const handleArrowNav = (event: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const targetRow = event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1;
    if (targetRow < 0 || targetRow >= lines.length) return;
    const target = containerRef.current?.querySelector<HTMLElement>(
      `[data-row="${targetRow}"][data-col="${colIndex}"]`,
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  const showWarehouseColumn = requireWarehouse && !compact;
  const showWarehouseToggle = requireWarehouse && compact;
  const columnCount =
    1 + // product
    (showWarehouseColumn ? 1 : 0) +
    1 + // quantity
    1 + // unit
    1 + // unit price
    1 + // discount
    1 + // tax
    1 + // line total
    (showWarehouseToggle ? 1 : 0) +
    1; // actions

  return (
    <div ref={containerRef} className="overflow-x-auto rounded-md border border-border">
      <Table className="w-full table-fixed border-separate border-spacing-0 min-w-[960px]">
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("sales.editor.grid.product")}</TableHead>
            {showWarehouseColumn && (
              <TableHead className="w-48">{t("sales.editor.grid.warehouse")}</TableHead>
            )}
            <TableHead className="w-(--width-control-quantity) text-center">
              {t("sales.editor.grid.quantity")}
            </TableHead>
            <TableHead className="w-24">{t("sales.editor.grid.unit")}</TableHead>
            <TableHead className="w-(--width-control-price) text-center">
              {t("sales.editor.grid.unitPrice")}
            </TableHead>
            <TableHead className="w-(--width-control-discount) text-center">
              {t("sales.editor.grid.discount")}
            </TableHead>
            <TableHead className="w-36">{t("sales.editor.grid.tax")}</TableHead>
            <TableHead className="w-(--width-control-line-total) text-end whitespace-nowrap">
              {t("sales.editor.grid.lineTotal")}
            </TableHead>
            {showWarehouseToggle && <TableHead className="w-10" />}
            <TableHead className="w-(--width-control-actions)" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, rowIndex) => {
            const preview = previewSalesLine({
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent,
              taxRatePercent: line.taxId ? taxRateById.get(line.taxId) : undefined,
            });
            const quantityInvalid = line.product !== null && line.quantity <= 0;
            const warehouseInvalid = requireWarehouse && line.product !== null && !line.warehouse;
            const isExpanded = expandedRows.has(line.id);

            return (
              <Fragment key={line.id}>
                <TableRow>
                  <TableCell
                    data-row={rowIndex}
                    data-col={0}
                    className="align-middle whitespace-normal"
                  >
                    <ProductPicker
                      value={line.product}
                      disabled={disabled}
                      onChange={(product) => selectProduct(line.id, product)}
                    />
                    {line.product && (
                      <Input
                        inputSize="xs"
                        placeholder={t("sales.editor.grid.descriptionPlaceholder")}
                        value={line.description ?? ""}
                        disabled={disabled}
                        className="mt-1 border-transparent bg-transparent px-0 shadow-none focus-visible:border-input focus-visible:bg-card focus-visible:px-2 focus-visible:shadow-xs"
                        onChange={(e) =>
                          updateLine(line.id, { description: e.target.value || null })
                        }
                      />
                    )}
                    {showWarehouseToggle && warehouseInvalid && !isExpanded && (
                      <button
                        type="button"
                        className="mt-1 text-xs font-medium text-destructive underline-offset-2 hover:underline"
                        onClick={() => toggleExpanded(line.id)}
                      >
                        {t("sales.editor.grid.warehouseRequired")}
                      </button>
                    )}
                  </TableCell>
                  {showWarehouseColumn && (
                    <TableCell
                      data-row={rowIndex}
                      data-col={1}
                      className="align-middle whitespace-normal"
                    >
                      <WarehousePicker
                        value={line.warehouse}
                        disabled={disabled}
                        onChange={(warehouse) => updateLine(line.id, { warehouse })}
                      />
                      {warehouseInvalid && (
                        <p className="mt-1 text-xs text-destructive">
                          {t("sales.editor.grid.warehouseRequired")}
                        </p>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="w-(--width-control-quantity) align-middle">
                    <Input
                      data-row={rowIndex}
                      data-col={2}
                      type="number"
                      min={0}
                      dir="ltr"
                      inputSize="compact-md"
                      className={cn("text-center", quantityInvalid && "border-destructive")}
                      value={line.quantity}
                      disabled={disabled}
                      onKeyDown={(e) => handleArrowNav(e, rowIndex, 2)}
                      onChange={(e) =>
                        updateLine(line.id, { quantity: e.target.valueAsNumber || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="align-middle text-caption text-muted-foreground">
                    {line.unitName ?? line.product?.unit?.name ?? "—"}
                  </TableCell>
                  <TableCell className="w-(--width-control-price) align-middle">
                    <Input
                      data-row={rowIndex}
                      data-col={3}
                      type="number"
                      min={0}
                      dir="ltr"
                      inputSize="compact-md"
                      className="text-center"
                      value={line.unitPrice}
                      disabled={disabled}
                      onKeyDown={(e) => handleArrowNav(e, rowIndex, 3)}
                      onChange={(e) =>
                        updateLine(line.id, { unitPrice: e.target.valueAsNumber || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="w-(--width-control-discount) align-middle">
                    <Input
                      data-row={rowIndex}
                      data-col={4}
                      type="number"
                      min={0}
                      max={100}
                      dir="ltr"
                      inputSize="compact-md"
                      className="text-center"
                      value={line.discountPercent}
                      disabled={disabled}
                      onKeyDown={(e) => handleArrowNav(e, rowIndex, 4)}
                      onChange={(e) =>
                        updateLine(line.id, { discountPercent: e.target.valueAsNumber || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="align-middle">
                    <Select
                      value={line.taxId ?? "__none__"}
                      disabled={disabled}
                      onValueChange={(value) =>
                        updateLine(line.id, { taxId: value === "__none__" ? null : value })
                      }
                    >
                      <SelectTrigger data-row={rowIndex} data-col={5} size="sm" className="w-full">
                        <SelectValue placeholder={t("sales.editor.grid.tax")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("sales.editor.grid.noTax")}</SelectItem>
                        {taxes.map((tax) => (
                          <SelectItem key={tax.id} value={tax.id}>
                            {tax.name} ({Number(tax.rate)}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell
                    className="w-(--width-control-line-total) align-middle text-end font-medium"
                    dir="ltr"
                  >
                    {preview.lineTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  {showWarehouseToggle && (
                    <TableCell className="align-middle">
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={t("sales.editor.grid.lineDetails")}
                        aria-expanded={isExpanded}
                        onClick={() => toggleExpanded(line.id)}
                      >
                        <ChevronDown
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </EnterpriseButton>
                    </TableCell>
                  )}
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
                {showWarehouseToggle && isExpanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columnCount} className="whitespace-normal bg-muted/20 py-3">
                      <div className="flex min-w-56 flex-col gap-1.5">
                        <label className="text-caption text-muted-foreground">
                          {t("sales.editor.grid.warehouse")}
                        </label>
                        <WarehousePicker
                          value={line.warehouse}
                          disabled={disabled}
                          onChange={(warehouse) => updateLine(line.id, { warehouse })}
                        />
                        {warehouseInvalid && (
                          <p className="text-xs text-destructive">
                            {t("sales.editor.grid.warehouseRequired")}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <div className="border-t border-border p-2">
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => onChange([...lines, createEmptyLine()])}
        >
          <Plus className="size-3.5" />
          {t("sales.editor.grid.addLine")}
        </EnterpriseButton>
      </div>
    </div>
  );
}
