"use client";

import { Package } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { productsService, type ProductRow } from "@/services/products-service";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export function ProductPicker({
  value,
  onChange,
  disabled,
  className,
  inventoryOnly,
  sellableOnly = true,
  purchasableOnly = false,
}: {
  value: ProductRow | null | undefined;
  onChange: (product: ProductRow) => void;
  disabled?: boolean;
  className?: string;
  /** Inventory movement pickers (Transfer/Adjustment/Opening) — only products a stock movement can legally apply to (ADR-0013). */
  inventoryOnly?: boolean;
  /**
   * Sales/convert pickers default to sellable ACTIVE products. Pass false for
   * purchasing (with purchasableOnly) or generic ACTIVE catalog browsing.
   */
  sellableOnly?: boolean;
  /** Purchasing pickers — only products that can be purchased. */
  purchasableOnly?: boolean;
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={(product) => {
        if (product) onChange(product);
      }}
      onSearch={async (search) => {
        const result = await productsService.catalog({
          search: search || undefined,
          pageSize: 25,
          sortBy: "displayName",
          sortOrder: "asc",
          ...(inventoryOnly ? { isInventoryItem: true } : {}),
          ...(purchasableOnly && !inventoryOnly ? { isPurchasable: true } : {}),
          ...(sellableOnly && !inventoryOnly && !purchasableOnly ? { isSellable: true } : {}),
        });
        return result.items;
      }}
      getId={(product) => product.id}
      getTitle={(product) => product.displayName || product.name}
      getSubtitle={(product) =>
        [product.sku, product.salesPrice ? formatMoney(product.salesPrice) : null]
          .filter(Boolean)
          .join(" · ")
      }
      getSearchText={(product) =>
        `${product.sku} ${product.barcode ?? ""} ${product.internalName} ${product.name}`
      }
      subtitleDir="ltr"
      placeholder={t("sales.editor.grid.selectProduct")}
      searchPlaceholder={t("sales.editor.grid.productSearchPlaceholder")}
      loadingText={t("sales.editor.grid.loadingProducts")}
      emptyText={t("sales.editor.grid.noActiveProducts")}
      noMatchText={t("sales.editor.grid.noMatchingProducts")}
      errorText={t("sales.editor.grid.productsLoadError")}
      disabled={disabled}
      icon={<Package className="size-3.5 shrink-0 text-muted-foreground" />}
      triggerClassName={cn("max-w-(--width-picker-product)", className)}
    />
  );
}
