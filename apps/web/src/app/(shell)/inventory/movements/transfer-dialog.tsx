"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { ProductPicker } from "@/components/business/product-picker";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { inventoryService } from "@/services/inventory-service";
import type { ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";

interface TransferLine {
  key: number;
  product: ProductRow | null;
  quantity: string;
}

let lineKeySeq = 0;
const emptyLine = (): TransferLine => ({ key: lineKeySeq++, product: null, quantity: "" });

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

  const [sourceWarehouse, setSourceWarehouse] = useState<WarehouseRow | null>(null);
  const [destinationWarehouse, setDestinationWarehouse] = useState<WarehouseRow | null>(null);
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setSourceWarehouse(null);
    setDestinationWarehouse(null);
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

  const sameWarehouse =
    !!sourceWarehouse && !!destinationWarehouse && sourceWarehouse.id === destinationWarehouse.id;
  const validLines = useMemo(
    () => lines.filter((line) => line.product && Number(line.quantity) > 0),
    [lines],
  );
  const isValid =
    !!sourceWarehouse &&
    !!destinationWarehouse &&
    !sameWarehouse &&
    validLines.length === lines.length &&
    validLines.length > 0;

  const submit = async () => {
    if (!isValid || !sourceWarehouse || !destinationWarehouse) return;
    setIsSubmitting(true);
    try {
      await inventoryService.transfer({
        sourceWarehouseId: sourceWarehouse.id,
        destinationWarehouseId: destinationWarehouse.id,
        lines: validLines.map((line) => ({
          productId: line.product!.id,
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
            <WarehousePicker value={sourceWarehouse} onChange={setSourceWarehouse} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("inventory.createMovement.destinationWarehouse")}</Label>
            <WarehousePicker value={destinationWarehouse} onChange={setDestinationWarehouse} />
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
                <ProductPicker
                  value={line.product}
                  onChange={(product) => updateLine(line.key, { product })}
                  inventoryOnly
                  className="w-full"
                />
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
