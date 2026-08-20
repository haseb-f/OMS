"use client";

import { useEffect, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { inventoryService } from "@/services/inventory-service";
import { createMasterDataService } from "@/services/master-data-service";
import { productsService, type ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

/** TASK-029 — Opening Inventory as its own dedicated entry point (Warehouse/Product/Quantity/Unit Cost/Notes), separate from the generic Adjustment/Transfer flows. */
export function OpeningInventoryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    productsService
      .list({ pageSize: 200 })
      .then((result) => setProducts(result.items.filter((product) => product.isInventoryItem)))
      .catch(() => setProducts([]));
    warehousesService
      .list({ pageSize: 200 })
      .then((result) => setWarehouses(result.items))
      .catch(() => setWarehouses([]));
  }, [open]);

  const reset = () => {
    setProductId("");
    setWarehouseId("");
    setQuantity("");
    setUnitCost("");
    setNotes("");
  };

  const isValid = !!productId && !!warehouseId && !!quantity && Number(quantity) > 0;

  const submit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      await inventoryService.openingBalance({
        productId,
        warehouseId,
        quantity: Number(quantity),
        unitCost: unitCost ? Number(unitCost) : undefined,
        notes: notes || undefined,
      });
      toast.success(t("inventory.openingInventory.success"));
      reset();
      onOpenChange(false);
      onCreated();
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
      title={t("inventory.openingInventory.title")}
      description={t("inventory.openingInventory.description")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSubmitting}
          submitDisabled={!isValid}
        />
      )}
    >
      <CreateOperationLayout>
        <ModalSection title={t("inventory.openingInventory.title")} columns={2}>
          <div className="flex flex-col gap-1">
            <Label>{t("inventory.fields.product")}</Label>
            <Select value={productId || undefined} onValueChange={setProductId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.sku} — {product.displayName || product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
            <Label>{t("products.openingBalance.quantity")}</Label>
            <Input
              type="number"
              dir="ltr"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("products.openingBalance.averageCost")}</Label>
            <Input
              type="number"
              dir="ltr"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
            />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>{t("products.openingBalance.notes")}</Label>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </ModalSection>
        <CreateOperationSummary
          title={t("common.summary")}
          rows={[
            {
              label: t("inventory.fields.product"),
              value:
                products.find((product) => product.id === productId)?.displayName ||
                products.find((product) => product.id === productId)?.name ||
                "—",
            },
            {
              label: t("masterData.fields.warehouse"),
              value: warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? "—",
            },
            {
              label: t("products.openingBalance.quantity"),
              value: <span dir="ltr">{quantity || "—"}</span>,
            },
          ]}
        />
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
