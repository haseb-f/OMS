"use client";

import { useState, type ButtonHTMLAttributes } from "react";
import { Package, Plus } from "lucide-react";
import { CommandItem } from "@/components/ui/command";
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

const CREATE_PRODUCT_PERMISSION = "products.create";

/** Reference data for the create wizard — only mounted once a user opens it. */
function InlineProductCreate({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: ProductRow) => void;
}) {
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
      onCreated={onCreated}
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
        footer={
          canCreate ? (
            <CommandItem value="__create_product__" onSelect={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t("docFlow.products.createNew")}
            </CommandItem>
          ) : undefined
        }
      />
      {canCreate && createOpen ? (
        <InlineProductCreate
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(product) => {
            invalidateLookups("products:");
            setCreateOpen(false);
            // New products start as Draft; a document line needs an active
            // one, so activate it here and select it without losing the form.
            const ready =
              product.status === "ACTIVE"
                ? Promise.resolve(product)
                : productsService.activate(product.id);
            ready
              .then((active) => onChange(active))
              .catch((error: unknown) =>
                toast.error(
                  error instanceof ApiError ? error.message : t("docFlow.products.activateFailed"),
                ),
              );
          }}
        />
      ) : null}
    </>
  );
}
