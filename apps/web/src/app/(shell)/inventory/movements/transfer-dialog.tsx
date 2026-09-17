"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { ProductPicker } from "@/components/business/product-picker";
import { IconActionButton } from "@/components/shared/icon-action-button";
import {
  DocumentLineTable,
  DocumentLineTableAddFooter,
  DocumentLineTableBody,
  DocumentLineTableCell,
  DocumentLineTableHead,
  DocumentLineTableHeader,
  DocumentLineTableRow,
  documentLineCellClass,
  documentLineHeadClass,
  documentLineNumericCellClass,
  documentLineNumericHeadClass,
} from "@/components/documents/document-line-table";
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
          <DocumentLineTable
            minWidthClass="min-w-[520px]"
            footer={
              <DocumentLineTableAddFooter
                label={t("inventory.transfer.addLine")}
                onClick={addLine}
              />
            }
          >
            <colgroup>
              <col />
              <col className="w-(--width-control-quantity)" />
              <col className="w-(--width-control-actions)" />
            </colgroup>
            <DocumentLineTableHeader>
              <DocumentLineTableRow className="hover:bg-transparent">
                <DocumentLineTableHead className={documentLineHeadClass}>
                  {t("sales.editor.grid.product")}
                </DocumentLineTableHead>
                <DocumentLineTableHead
                  className={`${documentLineNumericHeadClass} w-(--width-control-quantity)`}
                >
                  {t("inventory.fields.quantity")}
                </DocumentLineTableHead>
                <DocumentLineTableHead
                  className={`${documentLineHeadClass} w-(--width-control-actions)`}
                />
              </DocumentLineTableRow>
            </DocumentLineTableHeader>
            <DocumentLineTableBody>
              {lines.map((line) => (
                <DocumentLineTableRow key={line.key} className="hover:bg-muted/40">
                  <DocumentLineTableCell className={`${documentLineCellClass} min-w-0`}>
                    <ProductPicker
                      embedded
                      className="min-w-0 w-full"
                      value={line.product}
                      onChange={(product) => updateLine(line.key, { product })}
                      inventoryOnly
                    />
                  </DocumentLineTableCell>
                  <DocumentLineTableCell
                    className={`${documentLineNumericCellClass} w-(--width-control-quantity)`}
                  >
                    <Input
                      type="number"
                      dir="ltr"
                      min={1}
                      step={1}
                      inputSize="compact-md"
                      inputMode="decimal"
                      className="px-2 text-end tabular-nums"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      placeholder={t("inventory.fields.quantity")}
                    />
                  </DocumentLineTableCell>
                  <DocumentLineTableCell
                    className={`${documentLineCellClass} w-(--width-control-actions)`}
                  >
                    <IconActionButton
                      label={t("common.remove")}
                      disabled={lines.length === 1}
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </IconActionButton>
                  </DocumentLineTableCell>
                </DocumentLineTableRow>
              ))}
            </DocumentLineTableBody>
          </DocumentLineTable>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("products.openingBalance.notes")}</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
