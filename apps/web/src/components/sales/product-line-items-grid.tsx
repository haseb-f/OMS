"use client";

import { useMemo, useRef, type KeyboardEvent } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import {
  DocumentLineTable,
  DocumentLineTableAddFooter,
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
import { IconActionButton } from "@/components/shared/icon-action-button";
import { Input } from "@/components/ui/input";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ProductPicker } from "@/components/business/product-picker";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { MoneyInput } from "@/components/shared/money-input";
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
  /** Optional free-text note under the product — e.g. `SalesInvoiceItem.description`. */
  description: string | null;
  warehouse: WarehouseRow | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxId: string | null;
  /**
   * The line's OWN unit — a saved line item has its own independent
   * `unitId` (`SalesQuotationItem.unitId` et al.), not necessarily
   * re-derivable from `product.unit`.
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

function formatLineTotal(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Canonical editable product line-items table for Sales + Purchasing
 * documents (and any other transactional form with product lines).
 *
 * Each product is one horizontal row on desktop:
 * Product | Warehouse | Qty | Unit | Unit Price | Discount | Tax | Line Total | Actions
 *
 * Line totals are an instant preview only (`previewSalesLine`) — never
 * submitted as an authoritative total.
 */
export function ProductLineItemsGrid({
  lines,
  onChange,
  requireWarehouse = true,
  disabled,
  sellableOnly = true,
  purchasableOnly = false,
  showWarehouse,
  showUnit = true,
  showDiscount = true,
  showTax = true,
  showDescription = true,
  unitPriceLabel,
}: {
  lines: ProductLineItemsGridLine[];
  onChange: (lines: ProductLineItemsGridLine[]) => void;
  /** Order/Invoice/Return require a Warehouse per line; some quotations do not. */
  requireWarehouse?: boolean;
  disabled?: boolean;
  /** Sales default: only sellable ACTIVE products. */
  sellableOnly?: boolean;
  /** Purchasing: only purchasable ACTIVE products. */
  purchasableOnly?: boolean;
  showWarehouse?: boolean;
  showUnit?: boolean;
  showDiscount?: boolean;
  showTax?: boolean;
  showDescription?: boolean;
  unitPriceLabel?: string;
}) {
  const { t } = useLocale();
  const taxes = useTaxes();
  const containerRef = useRef<HTMLDivElement>(null);
  const warehouseColumn = showWarehouse ?? requireWarehouse;

  const updateLine = (id: string, patch: Partial<ProductLineItemsGridLine>) => {
    const index = lines.findIndex((line) => line.id === id);
    if (index === -1) return;
    const updated = { ...lines[index], ...patch };
    const next = lines.map((line) => (line.id === id ? updated : line));

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
    const catalogPrice = purchasableOnly ? product.purchasePrice : product.salesPrice;
    updateLine(id, {
      product,
      unitPrice: catalogPrice ? Number(catalogPrice) : 0,
      taxId: product.taxId ?? null,
      unitId: product.unitId,
      unitName: product.unit?.name ?? null,
    });
  };

  const taxRateById = useMemo(
    () => new Map(taxes.map((tax) => [tax.id, Number(tax.rate)])),
    [taxes],
  );

  const focusCell = (rowIndex: number, colIndex: number) => {
    const root = containerRef.current;
    if (!root) return;
    const cell = root.querySelector<HTMLElement>(
      `[data-row="${rowIndex}"][data-col="${colIndex}"]`,
    );
    if (!cell) return;
    const target = cell.matches("input,button,textarea,[role=combobox]")
      ? cell
      : cell.querySelector<HTMLElement>("input,button,textarea,[role=combobox]");
    target?.focus();
  };

  const handleArrowNav = (event: KeyboardEvent, rowIndex: number, colIndex: number) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (rowIndex === lines.length - 1) {
        onChange([...lines, createEmptyLine()]);
        requestAnimationFrame(() => focusCell(rowIndex + 1, 0));
        return;
      }
      focusCell(rowIndex + 1, colIndex);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const targetRow = event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1;
    if (targetRow < 0 || targetRow >= lines.length) return;
    event.preventDefault();
    focusCell(targetRow, colIndex);
  };

  return (
    <div ref={containerRef} className="min-w-0">
      <DocumentLineTable
        minWidthClass={warehouseColumn ? "min-w-[1080px]" : "min-w-[800px]"}
        footer={
          <DocumentLineTableAddFooter
            disabled={disabled}
            label={t("sales.editor.grid.addLine")}
            onClick={() => onChange([...lines, createEmptyLine()])}
          />
        }
      >
        <colgroup>
          <col />
          {warehouseColumn ? <col className="w-(--width-control-warehouse)" /> : null}
          <col className="w-(--width-control-quantity)" />
          {showUnit ? <col className="w-(--width-control-unit)" /> : null}
          <col className="w-(--width-control-price)" />
          {showDiscount ? <col className="w-(--width-control-discount)" /> : null}
          {showTax ? <col className="w-(--width-control-tax)" /> : null}
          <col className="w-(--width-control-line-total)" />
          <col className="w-(--width-control-actions)" />
        </colgroup>
        <DocumentLineTableHeader>
          <DocumentLineTableRow className="hover:bg-transparent">
            <DocumentLineTableHead className={documentLineHeadClass}>
              {t("sales.editor.grid.product")}
            </DocumentLineTableHead>
            {warehouseColumn && (
              <DocumentLineTableHead
                className={cn(documentLineHeadClass, "w-(--width-control-warehouse)")}
              >
                {t("sales.editor.grid.warehouse")}
              </DocumentLineTableHead>
            )}
            <DocumentLineTableHead
              className={cn(documentLineNumericHeadClass, "w-(--width-control-quantity)")}
            >
              {t("sales.editor.grid.quantity")}
            </DocumentLineTableHead>
            {showUnit && (
              <DocumentLineTableHead
                className={cn(documentLineHeadClass, "w-(--width-control-unit)")}
              >
                {t("sales.editor.grid.unit")}
              </DocumentLineTableHead>
            )}
            <DocumentLineTableHead
              className={cn(documentLineNumericHeadClass, "w-(--width-control-price)")}
            >
              {unitPriceLabel ?? t("sales.editor.grid.unitPrice")}
            </DocumentLineTableHead>
            {showDiscount && (
              <DocumentLineTableHead
                className={cn(documentLineNumericHeadClass, "w-(--width-control-discount)")}
              >
                {t("sales.editor.grid.discount")}
              </DocumentLineTableHead>
            )}
            {showTax && (
              <DocumentLineTableHead
                className={cn(documentLineHeadClass, "w-(--width-control-tax)")}
              >
                {t("sales.editor.grid.tax")}
              </DocumentLineTableHead>
            )}
            <DocumentLineTableHead
              className={cn(documentLineNumericHeadClass, "w-(--width-control-line-total)")}
            >
              {t("sales.editor.grid.lineTotal")}
            </DocumentLineTableHead>
            <DocumentLineTableHead
              className={cn(documentLineHeadClass, "w-(--width-control-actions)")}
            />
          </DocumentLineTableRow>
        </DocumentLineTableHeader>
        <DocumentLineTableBody>
          {lines.map((line, rowIndex) => {
            const preview = previewSalesLine({
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: showDiscount ? line.discountPercent : 0,
              taxRatePercent: showTax && line.taxId ? taxRateById.get(line.taxId) : undefined,
            });
            const quantityInvalid = line.product !== null && line.quantity <= 0;
            const warehouseInvalid = requireWarehouse && line.product !== null && !line.warehouse;
            const hasNote = Boolean(line.description?.trim());
            let col = 0;
            const productCol = col++;
            const warehouseCol = warehouseColumn ? col++ : -1;
            const qtyCol = col++;
            const priceCol = col++;
            const discountCol = showDiscount ? col++ : -1;
            const taxCol = showTax ? col++ : -1;

            return (
              <DocumentLineTableRow key={line.id} className="hover:bg-muted/40">
                <DocumentLineTableCell
                  data-row={rowIndex}
                  data-col={productCol}
                  className={cn(documentLineCellClass, "min-w-0")}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <ProductPicker
                      embedded
                      className="min-w-0 flex-1"
                      value={line.product}
                      disabled={disabled}
                      sellableOnly={sellableOnly}
                      purchasableOnly={purchasableOnly}
                      onChange={(product) => selectProduct(line.id, product)}
                      triggerProps={{
                        title: line.product
                          ? `${line.product.sku} · ${line.product.displayName || line.product.name}`
                          : undefined,
                      }}
                    />
                    {showDescription && line.product && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <EnterpriseButton
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={disabled}
                            title={
                              hasNote
                                ? (line.description ?? undefined)
                                : t("sales.editor.grid.lineNote")
                            }
                            aria-label={t("sales.editor.grid.lineNote")}
                            className={cn(
                              "size-7 shrink-0",
                              hasNote ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            <StickyNote className="size-3.5" />
                          </EnterpriseButton>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 rounded-xs p-2">
                          <label className="mb-1 block text-caption text-muted-foreground">
                            {t("sales.editor.grid.lineNote")}
                          </label>
                          <Textarea
                            rows={3}
                            disabled={disabled}
                            placeholder={t("sales.editor.grid.descriptionPlaceholder")}
                            value={line.description ?? ""}
                            onChange={(event) =>
                              updateLine(line.id, {
                                description: event.target.value || null,
                              })
                            }
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </DocumentLineTableCell>
                {warehouseColumn && (
                  <DocumentLineTableCell
                    data-row={rowIndex}
                    data-col={warehouseCol}
                    className={cn(documentLineCellClass, "w-(--width-control-warehouse) min-w-0")}
                  >
                    <WarehousePicker
                      embedded
                      value={line.warehouse}
                      disabled={disabled}
                      error={warehouseInvalid}
                      onChange={(warehouse) => updateLine(line.id, { warehouse })}
                    />
                  </DocumentLineTableCell>
                )}
                <DocumentLineTableCell
                  className={cn(documentLineNumericCellClass, "w-(--width-control-quantity)")}
                >
                  <Input
                    data-row={rowIndex}
                    data-col={qtyCol}
                    type="number"
                    min={0}
                    dir="ltr"
                    inputSize="compact-md"
                    inputMode="decimal"
                    aria-invalid={quantityInvalid || undefined}
                    className={cn(
                      "px-2 text-end tabular-nums",
                      quantityInvalid && "border-destructive",
                    )}
                    value={line.quantity}
                    disabled={disabled}
                    onKeyDown={(event) => handleArrowNav(event, rowIndex, qtyCol)}
                    onChange={(event) =>
                      updateLine(line.id, { quantity: event.target.valueAsNumber || 0 })
                    }
                  />
                </DocumentLineTableCell>
                {showUnit && (
                  <DocumentLineTableCell
                    className={cn(
                      documentLineCellClass,
                      "w-(--width-control-unit) truncate text-caption text-muted-foreground",
                    )}
                    title={line.unitName ?? line.product?.unit?.name ?? undefined}
                  >
                    {line.unitName ?? line.product?.unit?.name ?? "—"}
                  </DocumentLineTableCell>
                )}
                <DocumentLineTableCell
                  className={cn(documentLineNumericCellClass, "w-(--width-control-price)")}
                >
                  <MoneyInput
                    data-row={rowIndex}
                    data-col={priceCol}
                    align="end"
                    className="px-2"
                    value={line.unitPrice}
                    disabled={disabled}
                    onKeyDown={(event) => handleArrowNav(event, rowIndex, priceCol)}
                    onChange={(event) =>
                      updateLine(line.id, { unitPrice: event.target.valueAsNumber || 0 })
                    }
                  />
                </DocumentLineTableCell>
                {showDiscount && (
                  <DocumentLineTableCell
                    className={cn(documentLineNumericCellClass, "w-(--width-control-discount)")}
                  >
                    <InputGroup className="h-(--control-height-sm)">
                      <InputGroupInput
                        data-row={rowIndex}
                        data-col={discountCol}
                        type="number"
                        min={0}
                        max={100}
                        dir="ltr"
                        inputMode="decimal"
                        className="px-2 text-end tabular-nums"
                        value={line.discountPercent}
                        disabled={disabled}
                        onKeyDown={(event) => handleArrowNav(event, rowIndex, discountCol)}
                        onChange={(event) =>
                          updateLine(line.id, {
                            discountPercent: event.target.valueAsNumber || 0,
                          })
                        }
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText className="text-caption">%</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </DocumentLineTableCell>
                )}
                {showTax && (
                  <DocumentLineTableCell
                    data-row={rowIndex}
                    data-col={taxCol}
                    className={cn(documentLineCellClass, "w-(--width-control-tax) min-w-0")}
                  >
                    <Select
                      value={line.taxId ?? "__none__"}
                      disabled={disabled}
                      onValueChange={(value) =>
                        updateLine(line.id, { taxId: value === "__none__" ? null : value })
                      }
                    >
                      <SelectTrigger
                        data-row={rowIndex}
                        data-col={taxCol}
                        size="sm"
                        className="w-full min-w-0"
                      >
                        <SelectValue placeholder={t("sales.editor.grid.tax")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("sales.editor.grid.noTax")}</SelectItem>
                        {taxes.map((tax) => (
                          <SelectItem key={tax.id} value={tax.id}>
                            {tax.code} ({Number(tax.rate)}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </DocumentLineTableCell>
                )}
                <DocumentLineTableCell
                  className={cn(
                    documentLineNumericCellClass,
                    "w-(--width-control-line-total) font-medium tabular-nums",
                  )}
                  dir="ltr"
                >
                  {formatLineTotal(preview.lineTotal)}
                </DocumentLineTableCell>
                <DocumentLineTableCell
                  className={cn(documentLineCellClass, "w-(--width-control-actions)")}
                >
                  <IconActionButton
                    label={t("common.remove")}
                    disabled={disabled}
                    onClick={() => removeLine(line.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </IconActionButton>
                </DocumentLineTableCell>
              </DocumentLineTableRow>
            );
          })}
        </DocumentLineTableBody>
      </DocumentLineTable>
    </div>
  );
}
