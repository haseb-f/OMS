"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LayoutList, SlidersHorizontal, StickyNote, Trash2 } from "lucide-react";
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
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ProductPicker } from "@/components/business/product-picker";
import { ProductBrowserDialog } from "@/components/business/product-browser-dialog";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { AccountPicker } from "@/components/business/account-picker";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyInput } from "@/components/shared/money-input";
import { useTaxes } from "@/hooks/use-reference-data";
import { useIsMobile } from "@/hooks/use-mobile";
import { useElementWidth } from "@/hooks/use-element-width";
import { CreateOperationTotals } from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import type { ProductRow } from "@/services/products-service";
import type { ChartOfAccountRow, WarehouseRow } from "@/config/master-data/entities";
import { previewSalesLine } from "./sales-line-preview-math";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

export type LineTreatment = "STANDARD" | "FIXED_ASSET" | "PREPAID_EXPENSE";

export interface ProductLineItemsGridLine {
  /** Client-side row identity (React key + keyboard-nav target) — never a document/DB id at this layer. */
  id: string;
  product: ProductRow | null;
  /** Optional free-text note under the product — e.g. `SalesInvoiceItem.description`. */
  description: string | null;
  warehouse: WarehouseRow | null;
  quantity: number;
  unitPrice: number;
  /**
   * `priceMode="lineAmount"` only — the amount agreed for the whole line
   * (Store Orders / Lead conversion), independent of quantity. `null`
   * means not entered yet; it is never silently treated as 0.
   */
  lineAmount?: number | null;
  discountPercent: number;
  taxId: string | null;
  /**
   * The line's OWN unit — a saved line item has its own independent
   * `unitId` (`SalesQuotationItem.unitId` et al.), not necessarily
   * re-derivable from `product.unit`.
   */
  unitId: string | null;
  unitName: string | null;
  /** Purchase Invoice only — how the line is recognized when the invoice posts. */
  treatment?: LineTreatment;
  assetUsefulLifeMonths?: number | null;
  assetDepreciationMethod?: "STRAIGHT_LINE" | "DECLINING_BALANCE" | null;
  /** yyyy-mm-dd — first depreciation / recognition month. */
  scheduleStartDate?: string | null;
  prepaidMonths?: number | null;
  prepaidExpenseAccount?: ChartOfAccountRow | null;
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
    lineAmount: null,
    discountPercent: 0,
    taxId: null,
    unitId: null,
    unitName: null,
    treatment: "STANDARD",
  };
}

export type LinePriceMode = "unit" | "lineAmount";

/** The price the user entered for a line — unit price, or the agreed line amount. */
export function linePrice(line: ProductLineItemsGridLine, mode: LinePriceMode = "unit"): number {
  return mode === "lineAmount" ? (line.lineAmount ?? 0) : line.unitPrice;
}

/** A product line whose required price is blank or not greater than 0. */
export function isLinePriceMissing(
  line: ProductLineItemsGridLine,
  mode: LinePriceMode = "unit",
): boolean {
  if (!line.product) return false;
  const price = linePrice(line, mode);
  return !Number.isFinite(price) || price <= 0;
}

/** Columns of the table layout, as width tokens — the product column is the flexible one. */
function requiredTableWidth(columns: string[]): number {
  const style = getComputedStyle(document.documentElement);
  return ["--width-control-product-min", ...columns].reduce(
    (sum, token) => sum + (Number.parseFloat(style.getPropertyValue(token)) || 0),
    0,
  );
}

/** API payload fields for a line's fixed-asset / prepaid treatment. */
export function lineTreatmentPayload(line: ProductLineItemsGridLine) {
  const treatment = line.treatment ?? "STANDARD";
  if (treatment === "FIXED_ASSET") {
    return {
      treatment,
      assetUsefulLifeMonths: line.assetUsefulLifeMonths ?? undefined,
      assetDepreciationMethod: line.assetDepreciationMethod ?? "STRAIGHT_LINE",
      scheduleStartDate: line.scheduleStartDate ?? undefined,
    };
  }
  if (treatment === "PREPAID_EXPENSE") {
    return {
      treatment,
      prepaidMonths: line.prepaidMonths ?? undefined,
      prepaidExpenseAccountId: line.prepaidExpenseAccount?.id,
      scheduleStartDate: line.scheduleStartDate ?? undefined,
    };
  }
  return { treatment };
}

/** Same en-US numerals as every money column (`formatMoney`) — a browser-locale format rendered Arabic digits on the client but Latin on the server (hydration mismatch). */
function formatLineTotal(value: number) {
  return formatMoney(value);
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function toIsoDate(date: Date | null): string | null {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Per-line options: free-text note and — on purchase invoices, for
 * non-stock products — whether the line is capitalized as a fixed asset or
 * deferred as a prepaid expense (progressive disclosure: hidden until a
 * user opens the line options).
 */
function LineOptions({
  line,
  disabled,
  showTreatment,
  onChange,
}: {
  line: ProductLineItemsGridLine;
  disabled?: boolean;
  showTreatment: boolean;
  onChange: (patch: Partial<ProductLineItemsGridLine>) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const treatment = line.treatment ?? "STANDARD";
  const hasNote = Boolean(line.description?.trim());
  const flagged = hasNote || treatment !== "STANDARD";
  const Icon = showTreatment ? SlidersHorizontal : StickyNote;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled && !flagged}
          title={t(showTreatment ? "docFlow.lines.options" : "sales.editor.grid.lineNote")}
          aria-label={t(showTreatment ? "docFlow.lines.options" : "sales.editor.grid.lineNote")}
          className={cn("size-8 shrink-0", flagged ? "text-primary" : "text-muted-foreground")}
        >
          <Icon className="size-3.5" />
        </EnterpriseButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xs p-3"
      >
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted-foreground">
            {t("sales.editor.grid.lineNote")}
          </label>
          <Textarea
            rows={2}
            disabled={disabled}
            placeholder={t("sales.editor.grid.descriptionPlaceholder")}
            value={line.description ?? ""}
            onChange={(event) => onChange({ description: event.target.value || null })}
          />
        </div>
        {showTreatment ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <label htmlFor={`${fieldId}-treatment`} className="text-caption text-muted-foreground">
              {t("docFlow.lines.treatment")}
            </label>
            <Select
              value={treatment}
              disabled={disabled}
              onValueChange={(value) => onChange({ treatment: value as LineTreatment })}
            >
              <SelectTrigger id={`${fieldId}-treatment`} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDARD">{t("docFlow.lines.treatments.STANDARD")}</SelectItem>
                <SelectItem value="FIXED_ASSET">
                  {t("docFlow.lines.treatments.FIXED_ASSET")}
                </SelectItem>
                <SelectItem value="PREPAID_EXPENSE">
                  {t("docFlow.lines.treatments.PREPAID_EXPENSE")}
                </SelectItem>
              </SelectContent>
            </Select>
            {treatment === "FIXED_ASSET" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("docFlow.lines.usefulLife")}
                  </label>
                  <Input
                    type="number"
                    min={1}
                    dir="ltr"
                    inputMode="numeric"
                    inputSize="sm"
                    disabled={disabled}
                    value={line.assetUsefulLifeMonths ?? ""}
                    onChange={(event) =>
                      onChange({ assetUsefulLifeMonths: event.target.valueAsNumber || null })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${fieldId}-method`}
                    className="text-caption text-muted-foreground"
                  >
                    {t("docFlow.lines.method")}
                  </label>
                  <Select
                    value={line.assetDepreciationMethod ?? "STRAIGHT_LINE"}
                    disabled={disabled}
                    onValueChange={(value) =>
                      onChange({
                        assetDepreciationMethod: value as "STRAIGHT_LINE" | "DECLINING_BALANCE",
                      })
                    }
                  >
                    <SelectTrigger id={`${fieldId}-method`} size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STRAIGHT_LINE">
                        {t("docFlow.lines.methods.STRAIGHT_LINE")}
                      </SelectItem>
                      <SelectItem value="DECLINING_BALANCE">
                        {t("docFlow.lines.methods.DECLINING_BALANCE")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
            {treatment === "PREPAID_EXPENSE" ? (
              <div className="grid grid-cols-1 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("docFlow.lines.prepaidMonths")}
                  </label>
                  <Input
                    type="number"
                    min={1}
                    dir="ltr"
                    inputMode="numeric"
                    inputSize="sm"
                    disabled={disabled}
                    value={line.prepaidMonths ?? ""}
                    onChange={(event) =>
                      onChange({ prepaidMonths: event.target.valueAsNumber || null })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("docFlow.lines.expenseAccount")}
                  </label>
                  <AccountPicker
                    value={line.prepaidExpenseAccount ?? null}
                    postingOnly
                    accountType="EXPENSE"
                    disabled={disabled}
                    onChange={(account) => onChange({ prepaidExpenseAccount: account })}
                  />
                </div>
              </div>
            ) : null}
            {treatment !== "STANDARD" ? (
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("docFlow.lines.startDate")}
                </label>
                <EnterpriseDatePicker
                  value={toDate(line.scheduleStartDate)}
                  disabled={disabled}
                  onChange={(date) => onChange({ scheduleStartDate: toIsoDate(date) })}
                />
                <p className="text-caption text-muted-foreground">
                  {t(
                    treatment === "FIXED_ASSET"
                      ? "docFlow.lines.assetHint"
                      : "docFlow.lines.prepaidHint",
                  )}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Canonical editable product line-items table for Sales + Purchasing
 * documents (and any other transactional form with product lines).
 *
 * Desktop: one horizontal row per product —
 * Product | Warehouse | Qty | Unit | Unit Price | Discount | Tax | Line Total | Actions.
 * Phone — or any container too narrow for the table's columns (a dialog,
 * a tablet): one stacked card per product with full-width, touch-sized
 * fields, so a document is completed without zooming or sideways scrolling.
 *
 * `priceMode="lineAmount"` edits one agreed amount per line (Store Orders)
 * instead of a unit price; `requirePrice` + `showErrors` flag every product
 * line whose price is blank or not greater than 0, inline.
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
  enableLineTreatment = false,
  title,
  priceMode = "unit",
  requirePrice = false,
  showErrors = false,
  totalLabel,
  currencyCode,
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
  /** Purchase invoices: allow capitalizing / deferring non-stock lines. */
  enableLineTreatment?: boolean;
  /** Section heading rendered in the lines toolbar, beside "Browse products". */
  title?: ReactNode;
  /** "lineAmount": the price field is the agreed amount for the whole line. */
  priceMode?: LinePriceMode;
  /** Every product line needs a price greater than 0 (validated when `showErrors`). */
  requirePrice?: boolean;
  /** Show validation for required fields — set once the user tries to submit. */
  showErrors?: boolean;
  /** When set, an order-total row is shown under the lines. */
  totalLabel?: string;
  currencyCode?: string;
}) {
  const { t } = useLocale();
  const taxes = useTaxes();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(containerRef);
  const [browseOpen, setBrowseOpen] = useState(false);
  const warehouseColumn = showWarehouse ?? requireWarehouse;
  const lineAmountMode = priceMode === "lineAmount";
  const priceLabel =
    unitPriceLabel ??
    t(lineAmountMode ? "sales.editor.grid.agreedAmount" : "sales.editor.grid.unitPrice");
  const tableColumns = [
    warehouseColumn && "--width-control-warehouse",
    "--width-control-quantity",
    showUnit && "--width-control-unit",
    "--width-control-price",
    showDiscount && "--width-control-discount",
    showTax && "--width-control-tax",
    !lineAmountMode && "--width-control-line-total",
    "--width-control-actions",
  ].filter((token): token is string => Boolean(token));
  const stacked =
    isMobile || (containerWidth !== null && containerWidth < requiredTableWidth(tableColumns));

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

  const productPatch = (product: ProductRow): Partial<ProductLineItemsGridLine> => {
    const catalogPrice = purchasableOnly ? product.purchasePrice : product.salesPrice;
    return {
      product,
      // An agreed line amount is what the customer agreed to — never a catalogue price.
      unitPrice: catalogPrice && !lineAmountMode ? Number(catalogPrice) : 0,
      taxId: product.taxId ?? null,
      unitId: product.unitId,
      unitName: product.unit?.name ?? null,
      treatment: "STANDARD",
    };
  };

  const selectProduct = (id: string, product: ProductRow) => {
    updateLine(id, productPatch(product));
  };

  /** Browse dialog: fill the trailing empty row(s), then append the rest. */
  const addProducts = (products: ProductRow[]) => {
    const filled = lines.filter((line) => line.product !== null);
    const lastWarehouse = [...filled].reverse().find((line) => line.warehouse)?.warehouse ?? null;
    const added = products.map((product) => ({
      ...createEmptyLine(),
      ...productPatch(product),
      warehouse: lastWarehouse,
    }));
    onChange([...filled, ...added, createEmptyLine()]);
  };

  const taxRateById = useMemo(
    () => new Map(taxes.map((tax) => [tax.id, Number(tax.rate)])),
    [taxes],
  );
  const taxInclusiveById = useMemo(
    () => new Map(taxes.map((tax) => [tax.id, Boolean(tax.inclusive)])),
    [taxes],
  );

  const priceInvalid = (line: ProductLineItemsGridLine) =>
    requirePrice && showErrors && isLinePriceMissing(line, priceMode);
  const anyPriceInvalid = lines.some(priceInvalid);

  /** Blank stays blank (null) in line-amount mode, so it can never be sent as 0. */
  const priceValue = (line: ProductLineItemsGridLine) =>
    lineAmountMode ? (line.lineAmount ?? "") : line.unitPrice;
  const priceChange = (line: ProductLineItemsGridLine, raw: string, valueAsNumber: number) =>
    updateLine(
      line.id,
      lineAmountMode
        ? { lineAmount: raw === "" || Number.isNaN(valueAsNumber) ? null : valueAsNumber }
        : { unitPrice: valueAsNumber || 0 },
    );

  const lineTotalFor = (line: ProductLineItemsGridLine) =>
    lineAmountMode ? (line.lineAmount ?? 0) : previewFor(line).lineTotal;
  const previewFor = (line: ProductLineItemsGridLine) =>
    previewSalesLine({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: showDiscount ? line.discountPercent : 0,
      taxRatePercent: showTax && line.taxId ? taxRateById.get(line.taxId) : undefined,
      taxInclusive: showTax && line.taxId ? taxInclusiveById.get(line.taxId) : undefined,
    });

  const orderTotal = lines.reduce((sum, line) => sum + (line.product ? lineTotalFor(line) : 0), 0);

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

  const showOptions = (line: ProductLineItemsGridLine) =>
    Boolean(line.product) && (showDescription || enableLineTreatment);
  const treatmentAllowed = (line: ProductLineItemsGridLine) =>
    enableLineTreatment && Boolean(line.product) && !line.product?.isInventoryItem;

  const footer = (
    <DocumentLineTableAddFooter
      disabled={disabled}
      label={t("sales.editor.grid.addLine")}
      onClick={() => onChange([...lines, createEmptyLine()])}
    />
  );

  // The expanded picker sits above the lines — visible without scrolling
  // past a long document, on phones and desktop alike.
  const toolbar = (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
      {title ? <h2 className="text-card-title font-heading">{title}</h2> : <span />}
      {disabled ? null : (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          className={cn("gap-1.5", isMobile && "h-10")}
          data-testid="browse-products"
          onClick={() => setBrowseOpen(true)}
        >
          <LayoutList className="size-3.5" />
          {t("docFlow.products.browse")}
        </EnterpriseButton>
      )}
    </div>
  );

  const taxOptions = useMemo(
    () =>
      taxes.map((tax) => ({
        value: tax.id,
        label: `${tax.code} (${Number(tax.rate)}%)`,
        searchText: tax.name,
      })),
    [taxes],
  );

  // Cleared ("") is "no tax" (null), as the old "__none__" row was. Table
  // cells render the ghost trigger; the keyboard grid focuses it through the
  // cell's own data-row/data-col.
  const taxSelect = (line: ProductLineItemsGridLine, inCell?: boolean) => (
    <SearchableSelect
      value={line.taxId ?? ""}
      disabled={disabled}
      onValueChange={(value) => updateLine(line.id, { taxId: value || null })}
      options={taxOptions}
      allowClear
      variant={inCell ? "ghost" : "default"}
      // Mobile line cards size every control like their neighbours (h-10).
      className={cn(isMobile && !inCell && "h-10")}
      placeholder={t("sales.editor.grid.noTax")}
      aria-label={t("sales.editor.grid.tax")}
    />
  );

  const browser = (
    <ProductBrowserDialog
      open={browseOpen}
      onOpenChange={setBrowseOpen}
      mode={purchasableOnly ? "purchase" : "sales"}
      onAdd={addProducts}
    />
  );

  const priceError = anyPriceInvalid ? (
    <p role="alert" className="text-caption text-destructive" data-testid="line-price-error">
      {t(lineAmountMode ? "docFlow.lines.amountRequired" : "docFlow.lines.priceRequired")}
    </p>
  ) : null;

  const totals = totalLabel ? (
    <CreateOperationTotals
      rows={[
        {
          label: totalLabel,
          value: <MoneyValue value={orderTotal} currency={currencyCode} />,
          emphasis: "strong",
        },
      ]}
    />
  ) : null;

  if (stacked) {
    return (
      <div ref={containerRef} className="flex min-w-0 flex-col gap-2">
        {toolbar}
        {lines.map((line, index) => {
          const preview = previewFor(line);
          const quantityInvalid = line.product !== null && line.quantity <= 0;
          const warehouseInvalid = requireWarehouse && line.product !== null && !line.warehouse;
          return (
            <div
              key={line.id}
              data-testid="document-line"
              className="flex flex-col gap-2 rounded-sm border border-border bg-card p-2.5"
            >
              <div className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-center text-caption text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <ProductPicker
                  embedded
                  className="h-10 min-w-0 flex-1"
                  value={line.product}
                  disabled={disabled}
                  sellableOnly={sellableOnly}
                  purchasableOnly={purchasableOnly}
                  onChange={(product) => selectProduct(line.id, product)}
                />
                {showOptions(line) ? (
                  <LineOptions
                    line={line}
                    disabled={disabled}
                    showTreatment={treatmentAllowed(line)}
                    onChange={(patch) => updateLine(line.id, patch)}
                  />
                ) : null}
                <IconActionButton
                  label={t("common.remove")}
                  disabled={disabled}
                  onClick={() => removeLine(line.id)}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </IconActionButton>
              </div>
              {line.product ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-muted-foreground">
                        {t("sales.editor.grid.quantity")}
                        {showUnit && (line.unitName ?? line.product.unit?.name)
                          ? ` · ${line.unitName ?? line.product.unit?.name}`
                          : ""}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        dir="ltr"
                        inputMode="decimal"
                        aria-invalid={quantityInvalid || undefined}
                        className={cn(
                          "h-10 text-end tabular-nums",
                          quantityInvalid && "border-destructive",
                        )}
                        value={line.quantity}
                        disabled={disabled}
                        onChange={(event) =>
                          updateLine(line.id, { quantity: event.target.valueAsNumber || 0 })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-muted-foreground">
                        {priceLabel}
                        {requirePrice ? <span className="text-destructive"> *</span> : null}
                      </span>
                      <MoneyInput
                        className={cn("h-10", priceInvalid(line) && "border-destructive")}
                        aria-invalid={priceInvalid(line) || undefined}
                        aria-required={requirePrice || undefined}
                        placeholder="0.00"
                        value={priceValue(line)}
                        disabled={disabled}
                        onChange={(event) =>
                          priceChange(line, event.target.value, event.target.valueAsNumber)
                        }
                      />
                    </label>
                    {showDiscount ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-caption text-muted-foreground">
                          {t("sales.editor.grid.discount")} %
                        </span>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          dir="ltr"
                          inputMode="decimal"
                          className="h-10 text-end tabular-nums"
                          value={line.discountPercent}
                          disabled={disabled}
                          onChange={(event) =>
                            updateLine(line.id, {
                              discountPercent: event.target.valueAsNumber || 0,
                            })
                          }
                        />
                      </label>
                    ) : null}
                    {showTax ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-caption text-muted-foreground">
                          {t("sales.editor.grid.tax")}
                        </span>
                        {taxSelect(line)}
                      </div>
                    ) : null}
                    {warehouseColumn ? (
                      <div className="col-span-2 flex flex-col gap-1">
                        <span className="text-caption text-muted-foreground">
                          {t("sales.editor.grid.warehouse")}
                        </span>
                        <WarehousePicker
                          embedded
                          value={line.warehouse}
                          disabled={disabled}
                          error={warehouseInvalid}
                          onChange={(warehouse) => updateLine(line.id, { warehouse })}
                        />
                      </div>
                    ) : null}
                  </div>
                  {priceInvalid(line) ? (
                    <p className="text-caption text-destructive">
                      {t(
                        lineAmountMode
                          ? "docFlow.lines.amountRequired"
                          : "docFlow.lines.priceRequired",
                      )}
                    </p>
                  ) : null}
                  {lineAmountMode ? null : (
                    <div className="flex items-center justify-between border-t border-border pt-1.5">
                      <span className="text-caption text-muted-foreground">
                        {line.treatment && line.treatment !== "STANDARD"
                          ? t(`docFlow.lines.treatments.${line.treatment}`)
                          : t("sales.editor.grid.lineTotal")}
                      </span>
                      <span dir="ltr" className="text-body font-semibold tabular-nums">
                        {formatLineTotal(preview.lineTotal)}
                      </span>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          );
        })}
        <div className="overflow-hidden rounded-sm border border-border">{footer}</div>
        {totals}
        {browser}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-w-0 flex-col gap-2">
      {toolbar}
      {/* Stacked cards take over below the columns' combined width, so the
          table never needs a minimum width (or a sideways scroll) of its own. */}
      <DocumentLineTable minWidthClass="min-w-0" footer={footer}>
        <colgroup>
          <col />
          {warehouseColumn ? <col className="w-(--width-control-warehouse)" /> : null}
          <col className="w-(--width-control-quantity)" />
          {showUnit ? <col className="w-(--width-control-unit)" /> : null}
          <col className="w-(--width-control-price)" />
          {showDiscount ? <col className="w-(--width-control-discount)" /> : null}
          {showTax ? <col className="w-(--width-control-tax)" /> : null}
          {lineAmountMode ? null : <col className="w-(--width-control-line-total)" />}
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
              {priceLabel}
              {requirePrice ? <span className="text-destructive"> *</span> : null}
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
            {lineAmountMode ? null : (
              <DocumentLineTableHead
                className={cn(documentLineNumericHeadClass, "w-(--width-control-line-total)")}
              >
                {t("sales.editor.grid.lineTotal")}
              </DocumentLineTableHead>
            )}
            <DocumentLineTableHead
              className={cn(documentLineHeadClass, "w-(--width-control-actions)")}
            />
          </DocumentLineTableRow>
        </DocumentLineTableHeader>
        <DocumentLineTableBody>
          {lines.map((line, rowIndex) => {
            const preview = previewFor(line);
            const quantityInvalid = line.product !== null && line.quantity <= 0;
            const warehouseInvalid = requireWarehouse && line.product !== null && !line.warehouse;
            let col = 0;
            const productCol = col++;
            const warehouseCol = warehouseColumn ? col++ : -1;
            const qtyCol = col++;
            const priceCol = col++;
            const discountCol = showDiscount ? col++ : -1;
            const taxCol = showTax ? col++ : -1;

            return (
              <DocumentLineTableRow
                key={line.id}
                data-testid="document-line"
                className="hover:bg-muted/40"
              >
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
                    {showOptions(line) ? (
                      <LineOptions
                        line={line}
                        disabled={disabled}
                        showTreatment={treatmentAllowed(line)}
                        onChange={(patch) => updateLine(line.id, patch)}
                      />
                    ) : null}
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
                    className={cn("px-2", priceInvalid(line) && "border-destructive")}
                    aria-label={priceLabel}
                    aria-invalid={priceInvalid(line) || undefined}
                    aria-required={requirePrice || undefined}
                    placeholder="0.00"
                    value={priceValue(line)}
                    disabled={disabled}
                    onKeyDown={(event) => handleArrowNav(event, rowIndex, priceCol)}
                    onChange={(event) =>
                      priceChange(line, event.target.value, event.target.valueAsNumber)
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
                          updateLine(line.id, { discountPercent: event.target.valueAsNumber || 0 })
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
                    {taxSelect(line, true)}
                  </DocumentLineTableCell>
                )}
                {lineAmountMode ? null : (
                  <DocumentLineTableCell
                    className={cn(
                      documentLineNumericCellClass,
                      "w-(--width-control-line-total) font-medium tabular-nums",
                    )}
                    dir="ltr"
                  >
                    {formatLineTotal(preview.lineTotal)}
                  </DocumentLineTableCell>
                )}
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
      {priceError}
      {totals}
      {browser}
    </div>
  );
}
