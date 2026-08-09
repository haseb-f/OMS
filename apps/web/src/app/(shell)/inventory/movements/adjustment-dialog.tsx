"use client";

import { useEffect, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
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
import { createMasterDataService } from "@/services/master-data-service";
import { productsService, type ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

type Direction = "INCREASE" | "DECREASE";

const REASONS = ["DAMAGED", "LOST", "FOUND", "EXPIRED", "CORRECTION", "OTHER"] as const;

/** TASK-029 — Inventory Adjustment as its own dedicated entry point: Increase/Decrease + required Reason. */
export function AdjustmentDialog({
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

  const [direction, setDirection] = useState<Direction>("INCREASE");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number] | "">("");
  const [customReason, setCustomReason] = useState("");
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
    setDirection("INCREASE");
    setProductId("");
    setWarehouseId("");
    setQuantity("");
    setReason("");
    setCustomReason("");
    setNotes("");
  };

  const resolvedReason = reason === "OTHER" ? customReason.trim() : reason;
  const isValid =
    !!productId && !!warehouseId && !!quantity && Number(quantity) > 0 && !!resolvedReason;

  const submit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      const signedQuantity = direction === "INCREASE" ? Number(quantity) : -Number(quantity);
      await inventoryService.adjustment({
        productId,
        warehouseId,
        quantity: signedQuantity,
        reason: resolvedReason,
        notes: notes || undefined,
      });
      toast.success(t("inventory.createMovement.success"));
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
      title={t("inventory.adjustment.title")}
      description={t("inventory.adjustment.description")}
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
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("inventory.adjustment.direction")}</Label>
            <Select value={direction} onValueChange={(value) => setDirection(value as Direction)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INCREASE">{t("inventory.adjustment.increase")}</SelectItem>
                <SelectItem value="DECREASE">{t("inventory.adjustment.decrease")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("inventory.fields.quantity")}</Label>
            <Input
              inputSize="sm"
              type="number"
              dir="ltr"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("inventory.fields.product")}</Label>
            <Select value={productId || undefined} onValueChange={setProductId}>
              <SelectTrigger size="sm" className="w-full">
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
          <div className="flex flex-col gap-1.5">
            <Label>{t("masterData.fields.warehouse")}</Label>
            <Select value={warehouseId || undefined} onValueChange={setWarehouseId}>
              <SelectTrigger size="sm" className="w-full">
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              {t("inventory.adjustment.reason")} <span className="text-destructive">*</span>
            </Label>
            <Select
              value={reason || undefined}
              onValueChange={(value) => setReason(value as (typeof REASONS)[number])}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`inventory.adjustment.reasons.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("products.openingBalance.notes")}</Label>
            <Input
              inputSize="sm"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        {reason === "OTHER" && (
          <Input
            inputSize="sm"
            value={customReason}
            onChange={(event) => setCustomReason(event.target.value)}
            placeholder={t("inventory.adjustment.reasonPlaceholder")}
          />
        )}
      </div>
    </EnterpriseModal>
  );
}
