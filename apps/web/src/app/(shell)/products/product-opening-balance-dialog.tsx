"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
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
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("products.openingBalance.title")}</DialogTitle>
          <DialogDescription>
            {product?.displayName} — {t("products.openingBalance.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("products.openingBalance.warehouse")}</Label>
            <Select value={warehouseId || undefined} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("products.openingBalance.quantity")}</Label>
            <Input
              type="number"
              dir="ltr"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("products.openingBalance.averageCost")}</Label>
            <Input
              type="number"
              dir="ltr"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("products.openingBalance.notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
