"use client";

import { useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/shared/money-input";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { ProductPicker } from "@/components/business/product-picker";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { inventoryService } from "@/services/inventory-service";
import type { ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";

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

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setProduct(null);
    setWarehouse(null);
    setQuantity("");
    setUnitCost("");
    setNotes("");
  };

  const isValid = !!product && !!warehouse && !!quantity && Number(quantity) > 0;

  const submit = async () => {
    if (!isValid || !product || !warehouse) return;
    setIsSubmitting(true);
    try {
      await inventoryService.openingBalance({
        productId: product.id,
        warehouseId: warehouse.id,
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
            <ProductPicker value={product} onChange={setProduct} inventoryOnly className="w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("masterData.fields.warehouse")}</Label>
            <WarehousePicker value={warehouse} onChange={setWarehouse} />
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
            <MoneyInput value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
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
              value: product?.displayName || product?.name || "—",
            },
            {
              label: t("masterData.fields.warehouse"),
              value: warehouse?.name ?? "—",
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
