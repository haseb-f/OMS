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
}: {
  value: ProductRow | null | undefined;
  onChange: (product: ProductRow) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={(product) => {
        if (product) onChange(product);
      }}
      onSearch={async (search) => {
        const result = await productsService.list({
          search: search || undefined,
          pageSize: 8,
          status: "ACTIVE",
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
      emptyText={t("sales.customers.picker.noResults")}
      disabled={disabled}
      icon={<Package className="size-4 shrink-0 text-muted-foreground" />}
      triggerClassName={cn("max-w-(--width-picker-product)", className)}
    />
  );
}
