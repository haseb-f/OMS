"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { SearchInput } from "@/components/shared/search-input";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  physicalCountService,
  type PhysicalCountDetailRow,
} from "@/services/physical-count-service";
import { productsService, type ProductRow } from "@/services/products-service";
import { useWarehouses } from "@/hooks/use-reference-data";
import { cachedLookup } from "@/lib/lookup-cache";
import { filterByArabicSearch } from "@/lib/arabic-search";

/** The products API caps `pageSize` at 200 — page through so no inventory item is silently left out of the count. */
const PRODUCTS_PAGE_SIZE = 200;

async function fetchAllInventoryProducts(): Promise<ProductRow[]> {
  const params = { isInventoryItem: true, pageSize: PRODUCTS_PAGE_SIZE };
  const first = await productsService.list({ ...params, page: 1 });
  const pageCount = Math.ceil(first.total / PRODUCTS_PAGE_SIZE);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      productsService.list({ ...params, page: index + 2 }),
    ),
  );
  return [first, ...rest]
    .flatMap((result) => result.items)
    .filter((product) => product.isInventoryItem);
}

/** TASK-029 — Create Physical Count: pick a Warehouse, optionally narrow which products to count (defaults to every active inventory item). */
export function CreateCountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (count: PhysicalCountDetailRow) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const warehouses = useWarehouses();
  const warehouseOptions = useMemo(
    () =>
      warehouses.map((warehouse) => ({
        value: warehouse.id,
        label: warehouse.name,
        description: warehouse.code,
        searchText: warehouse.code,
      })),
    [warehouses],
  );
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Cached for the lookup TTL, so re-opening the dialog doesn't refetch.
    cachedLookup("products:physical-count:inventory", fetchAllInventoryProducts)
      .then((items) => {
        setProducts(items);
        setSelected(new Set(items.map((product) => product.id)));
      })
      .catch(() => setProducts([]));
  }, [open]);

  const reset = () => {
    setWarehouseId("");
    setSearch("");
    setSelected(new Set(products.map((product) => product.id)));
    setNotes("");
  };

  const filteredProducts = useMemo(
    () =>
      filterByArabicSearch(
        products,
        search,
        (product) => `${product.sku} ${product.displayName || product.name}`,
      ),
    [products, search],
  );

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isValid = !!warehouseId && selected.size > 0;

  const submit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      const count = await physicalCountService.create({
        warehouseId,
        productIds: Array.from(selected),
        notes: notes || undefined,
      });
      toast.success(t("inventory.physicalCount.createdSuccess"));
      reset();
      onOpenChange(false);
      onCreated(count);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      size="md"
      title={t("inventory.physicalCount.createTitle")}
      description={t("inventory.physicalCount.createDescription")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={submit} disabled={isSubmitting || !isValid}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-warehouse`}>{t("masterData.fields.warehouse")}</Label>
          <SearchableSelect
            id={`${fieldId}-warehouse`}
            value={warehouseId}
            onValueChange={setWarehouseId}
            options={warehouseOptions}
            placeholder={t("masterData.fields.warehouse")}
            subtitleDir="ltr"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>
              {t("inventory.physicalCount.productsToCount")} ({selected.size}/{products.length})
            </Label>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelected(
                  selected.size === products.length
                    ? new Set()
                    : new Set(products.map((p) => p.id)),
                )
              }
            >
              {selected.size === products.length ? t("common.deselectAll") : t("common.selectAll")}
            </EnterpriseButton>
          </div>
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("table.filterPlaceholder")}
            className="max-w-none"
          />
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
            {filteredProducts.length === 0 && (
              <p className="p-2 text-caption text-muted-foreground">{t("table.noResults")}</p>
            )}
            {filteredProducts.map((product) => (
              <label
                key={product.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.has(product.id)}
                  onCheckedChange={() => toggle(product.id)}
                />
                <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                  {product.sku}
                </span>
                <span className="text-body">{product.displayName || product.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-notes`}>{t("products.openingBalance.notes")}</Label>
          <Input
            id={`${fieldId}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>
    </EnterpriseModal>
  );
}
