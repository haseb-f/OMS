"use client";

import { useState, type ButtonHTMLAttributes } from "react";
import { Package } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { ProductCreateDialog } from "@/components/business/product-create-dialog";
import { productsService, type ProductRow } from "@/services/products-service";
import {
  useProductCategories,
  useSuppliers,
  useTaxes,
  useUnits,
  useWarehouses,
} from "@/hooks/use-reference-data";
import { cachedLookup, invalidateLookups } from "@/lib/lookup-cache";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

export const CREATE_PRODUCT_PERMISSION = "products.create";

/**
 * Inline "New product" from a document: the create wizard (its reference
 * data loads only once opened), then activation — new products start as
 * Draft and a document line needs an ACTIVE one — so `onReady` receives a
 * product the caller can line immediately, without losing the document.
 */
export function InlineProductCreate({
  open,
  onOpenChange,
  initialName,
  onReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onReady: (product: ProductRow) => void;
}) {
  const { t } = useLocale();
  const categories = useProductCategories();
  const units = useUnits();
  const taxes = useTaxes();
  const suppliers = useSuppliers();
  const warehouses = useWarehouses();
  return (
    <ProductCreateDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Package}
      categories={categories}
      units={units}
      taxes={taxes}
      suppliers={suppliers}
      warehouses={warehouses}
      initialName={initialName}
      onCreated={(product) => {
        invalidateLookups("products:");
        onOpenChange(false);
        const ready =
          product.status === "ACTIVE"
            ? Promise.resolve(product)
            : productsService.activate(product.id);
        ready
          .then(onReady)
          .catch((error: unknown) =>
            toast.error(
              error instanceof ApiError ? error.message : t("docFlow.products.activateFailed"),
            ),
          );
      }}
    />
  );
}

export function ProductPicker({
  value,
  onChange,
  disabled,
  className,
  embedded = false,
  triggerProps,
  inventoryOnly,
  sellableOnly = true,
  purchasableOnly = false,
  investmentEligibleOnly = false,
  allowCreate = true,
}: {
  value: ProductRow | null | undefined;
  onChange: (product: ProductRow) => void;
  disabled?: boolean;
  className?: string;
  /** Fill the parent cell — used inside document line-item tables. */
  embedded?: boolean;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  /** Inventory movement pickers (Transfer/Adjustment/Opening) — only products a stock movement can legally apply to (ADR-0013). */
  inventoryOnly?: boolean;
  /**
   * Sales/convert pickers default to sellable ACTIVE products. Pass false for
   * purchasing (with purchasableOnly) or generic ACTIVE catalog browsing.
   */
  sellableOnly?: boolean;
  /** Purchasing pickers — only products that can be purchased. */
  purchasableOnly?: boolean;
  /** Investment Opportunity Product picker — only products opted in via `availableForInvestmentOpportunities` (Investor Engine Milestone 4, Part B). */
  investmentEligibleOnly?: boolean;
  /** Offer "Create new product" inside the list for users allowed to create products. */
  allowCreate?: boolean;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const canCreate =
    allowCreate &&
    !inventoryOnly &&
    !investmentEligibleOnly &&
    hasPermission(CREATE_PRODUCT_PERMISSION);

  return (
    <>
      <EntityCombobox
        value={value ?? null}
        onChange={(product) => {
          if (product) onChange(product);
        }}
        onSearch={async (search) => {
          const params = {
            search: search || undefined,
            pageSize: 25,
            sortBy: "displayName",
            sortOrder: "asc" as const,
            ...(inventoryOnly ? { isInventoryItem: true } : {}),
            ...(purchasableOnly && !inventoryOnly ? { isPurchasable: true } : {}),
            ...(sellableOnly && !inventoryOnly && !purchasableOnly ? { isSellable: true } : {}),
            ...(investmentEligibleOnly ? { investmentEligible: true } : {}),
          };
          const result = await cachedLookup(`products:${JSON.stringify(params)}`, () =>
            productsService.catalog(params),
          );
          return result.items;
        }}
        getId={(product) => product.id}
        getTitle={(product) => product.displayName || product.name}
        getSubtitle={(product) => {
          if (inventoryOnly) return product.sku;
          const price = purchasableOnly ? product.purchasePrice : product.salesPrice;
          return price ? formatMoney(price) : product.sku;
        }}
        getSearchText={(product) =>
          `${product.sku} ${product.barcode ?? ""} ${product.internalName} ${product.name}`
        }
        subtitleDir="ltr"
        placeholder={t("sales.editor.grid.selectProduct")}
        searchPlaceholder={t("sales.editor.grid.productSearchPlaceholder")}
        loadingText={t("sales.editor.grid.loadingProducts")}
        emptyText={
          investmentEligibleOnly
            ? t("docFlow.products.noInvestmentEligible")
            : t("sales.editor.grid.noActiveProducts")
        }
        noMatchText={t("sales.editor.grid.noMatchingProducts")}
        errorText={t("sales.editor.grid.productsLoadError")}
        disabled={disabled}
        icon={<Package className="size-3.5 shrink-0 text-muted-foreground" />}
        triggerProps={triggerProps}
        triggerClassName={cn(!embedded && "max-w-(--width-picker-product)", className)}
        createAction={
          canCreate
            ? {
                label: t("docFlow.products.createNew"),
                onSelect: (search) => {
                  setCreateName(search);
                  setCreateOpen(true);
                },
              }
            : undefined
        }
      />
      {canCreate && createOpen ? (
        <InlineProductCreate
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={createName}
          onReady={onChange}
        />
      ) : null}
    </>
  );
}
