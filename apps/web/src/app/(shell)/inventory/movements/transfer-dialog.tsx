"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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

interface TransferLine {
  key: number;
  productId: string;
  quantity: string;
}

let lineKeySeq = 0;
const emptyLine = (): TransferLine => ({ key: lineKeySeq++, productId: "", quantity: "" });

/** TASK-029 — Stock Transfer as its own dedicated entry point: From/To Warehouse + one or more Product/Quantity lines, one shared document number. */
export function TransferDialog({
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

  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()]);
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
    setSourceWarehouseId("");
    setDestinationWarehouseId("");
    setLines([emptyLine()]);
    setNotes("");
  };

  const updateLine = (key: number, patch: Partial<TransferLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };
  const addLine = () => setLines((current) => [...current, emptyLine()]);
  const removeLine = (key: number) =>
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.key !== key) : current,
    );

  const sameWarehouse = !!sourceWarehouseId && sourceWarehouseId === destinationWarehouseId;
  const validLines = useMemo(
    () => lines.filter((line) => line.productId && Number(line.quantity) > 0),
    [lines],
  );
  const isValid =
    !!sourceWarehouseId &&
    !!destinationWarehouseId &&
    !sameWarehouse &&
    validLines.length === lines.length &&
    validLines.length > 0;

  const submit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      await inventoryService.transfer({
        sourceWarehouseId,
        destinationWarehouseId,
        lines: validLines.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
        })),
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
      size="lg"
      title={t("inventory.transfer.title")}
      description={t("inventory.transfer.description")}
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
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("inventory.createMovement.sourceWarehouse")}</Label>
            <Select value={sourceWarehouseId || undefined} onValueChange={setSourceWarehouseId}>
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
            <Label>{t("inventory.createMovement.destinationWarehouse")}</Label>
            <Select
              value={destinationWarehouseId || undefined}
              onValueChange={setDestinationWarehouseId}
            >
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
        </div>
        {sameWarehouse && (
          <p className="text-caption text-destructive">
            {t("inventory.transfer.sameWarehouseError")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label>{t("inventory.transfer.lines")}</Label>
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2">
                <Select
                  value={line.productId || undefined}
                  onValueChange={(value) => updateLine(line.key, { productId: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("inventory.fields.product")} />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.sku} — {product.displayName || product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  dir="ltr"
                  min={1}
                  step={1}
                  value={line.quantity}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  placeholder={t("inventory.fields.quantity")}
                  className="w-32 shrink-0"
                />
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length === 1}
                  aria-label={t("common.remove")}
                >
                  <Trash2 className="size-3.5" />
                </EnterpriseButton>
              </div>
            ))}
          </div>
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
            className="w-fit"
          >
            <Plus className="size-3.5" />
            {t("inventory.transfer.addLine")}
          </EnterpriseButton>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("products.openingBalance.notes")}</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
