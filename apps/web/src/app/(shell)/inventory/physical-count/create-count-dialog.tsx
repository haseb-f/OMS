"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  physicalCountService,
  type PhysicalCountDetailRow,
} from "@/services/physical-count-service";
import { createMasterDataService } from "@/services/master-data-service";
import { productsService, type ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

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
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    warehousesService
      .list({ pageSize: 200 })
      .then((result) => setWarehouses(result.items))
      .catch(() => setWarehouses([]));
    productsService
      .list({ pageSize: 500 })
      .then((result) => {
        const items = result.items.filter((product) => product.isInventoryItem);
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

  const filteredProducts = useMemo(() => {
    if (!search) return products;
    const query = search.toLowerCase();
    return products.filter(
      (product) =>
        product.sku.toLowerCase().includes(query) ||
        (product.displayName || product.name).toLowerCase().includes(query),
    );
  }, [products, search]);

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
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
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
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label>{t("masterData.fields.warehouse")}</Label>
          <Select value={warehouseId || undefined} onValueChange={setWarehouseId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("table.filterPlaceholder")}
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
          <Label>{t("products.openingBalance.notes")}</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
