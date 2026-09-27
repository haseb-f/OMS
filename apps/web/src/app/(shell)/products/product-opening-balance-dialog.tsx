"use client";

import { useId, useMemo, useState } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useLocale } from "@/providers/locale-provider";
import { toast, reportApiError } from "@/lib/toast";
import { inventoryService } from "@/services/inventory-service";
import type { ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";

/**
 * TASK-028 Part 5 — "Create opening inventory balance" action from the
 * post-create success dialog. Thin wrapper around the existing
 * `POST /inventory/opening-balance` business operation (Inventory
 * Foundation, ADR-0013) — no new inventory logic, just a quick entry point
 * so a new Stockable/Purchase-Only product's starting quantity doesn't
 * require leaving Products to find it.
 */
export function ProductOpeningBalanceDialog({
  open,
  onOpenChange,
  product,
  warehouses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductRow | null;
  warehouses: WarehouseRow[];
}) {
  const { t } = useLocale();
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fieldId = useId();
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

  const reset = () => {
    setWarehouseId("");
    setQuantity("");
    setUnitCost("");
    setNotes("");
  };

  const submit = async () => {
    if (!product || !warehouseId || !quantity) return;
    setIsSubmitting(true);
    try {
      await inventoryService.openingBalance({
        productId: product.id,
        warehouseId,
        quantity: Number(quantity),
        notes: notes || undefined,
        unitCost: unitCost ? Number(unitCost) : undefined,
      });
      toast.success(t("products.openingBalance.success"));
      reset();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
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
      size="sm"
      title={t("products.openingBalance.title")}
      description={
        <>
          {product?.displayName} — {t("products.openingBalance.description")}
        </>
      }
      bodyClassName="flex flex-col gap-4"
      footer={
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={submit}
            disabled={isSubmitting || !warehouseId || !quantity}
          >
            {t("products.openingBalance.submit")}
          </EnterpriseButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-warehouse`}>{t("products.openingBalance.warehouse")}</Label>
          <SearchableSelect
            id={`${fieldId}-warehouse`}
            value={warehouseId}
            onValueChange={setWarehouseId}
            options={warehouseOptions}
            placeholder={t("products.openingBalance.warehouse")}
            subtitleDir="ltr"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-quantity`}>{t("products.openingBalance.quantity")}</Label>
          <Input
            id={`${fieldId}-quantity`}
            type="number"
            dir="ltr"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-unitCost`}>{t("products.openingBalance.averageCost")}</Label>
          <Input
            id={`${fieldId}-unitCost`}
            type="number"
            dir="ltr"
            min={0}
            step="0.01"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-notes`}>{t("products.openingBalance.notes")}</Label>
          <Input id={`${fieldId}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
