"use client";

import { useState } from "react";
import { ArrowRightCircle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import type { WarehouseRow } from "@/config/master-data/entities";
import {
  salesQuotationsService,
  type SalesQuotationRow,
} from "@/services/sales-quotations-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Quotation → Sales Order conversion (TASK-043 §6/§10/§15) — the ONLY thing
 * this dialog collects is what a Quotation genuinely doesn't have (a
 * Warehouse per line, since a quote commits nothing) plus an optional
 * quantity override. Everything else — pricing, discount, tax, totals — is
 * carried over and recomputed by the existing backend
 * `SalesOrdersService.createFromQuotation` flow; nothing is duplicated here.
 */
export function ConvertToOrderDialog({
  open,
  onOpenChange,
  quotation,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotation: SalesQuotationRow;
  onConverted: (order: { id: string; orderNumber: string }) => void;
}) {
  const { t } = useLocale();
  const [warehouses, setWarehouses] = useState<Record<string, WarehouseRow | null>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const missingWarehouse = quotation.items.some((item) => !warehouses[item.id]);

  const handleConfirm = async () => {
    if (missingWarehouse) {
      toast.error(t("sales.editor.grid.warehouseRequired"));
      return;
    }
    setIsSubmitting(true);
    try {
      const order = await salesQuotationsService.convertToOrder(quotation.id, {
        items: quotation.items.map((item) => ({
          quotationItemId: item.id,
          warehouseId: warehouses[item.id]!.id,
          quantity:
            quantities[item.id] && quantities[item.id] !== item.quantity
              ? quantities[item.id]
              : undefined,
        })),
      });
      toast.success(t("sales.quotations.convertToOrder.success"));
      onOpenChange(false);
      onConverted(order);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      icon={ArrowRightCircle}
      title={t("sales.quotations.convertToOrder.title")}
      description={t("sales.quotations.convertToOrder.description")}
      size="md"
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
          <EnterpriseButton type="button" disabled={isSubmitting} onClick={handleConfirm}>
            {t("sales.quotations.convertToOrder.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        {quotation.items.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
            <p className="text-sm font-medium">
              {item.product?.displayName || item.product?.name || "—"}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-caption text-muted-foreground">
                  {t("sales.editor.grid.quantity")}
                </label>
                <Input
                  type="number"
                  min={1}
                  dir="ltr"
                  inputSize="compact-md"
                  className="min-w-(--width-control-quantity)"
                  value={quantities[item.id] ?? item.quantity}
                  onChange={(event) =>
                    setQuantities((prev) => ({
                      ...prev,
                      [item.id]: event.target.valueAsNumber || item.quantity,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-caption text-muted-foreground">
                  {t("sales.editor.grid.warehouse")}
                </label>
                <WarehousePicker
                  value={warehouses[item.id] ?? null}
                  onChange={(warehouse) =>
                    setWarehouses((prev) => ({ ...prev, [item.id]: warehouse }))
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </EnterpriseModal>
  );
}
