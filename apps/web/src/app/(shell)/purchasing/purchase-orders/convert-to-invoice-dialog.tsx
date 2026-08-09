"use client";

import { useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import type { WarehouseRow } from "@/config/master-data/entities";
import { purchaseOrdersService, type PurchaseOrderRow } from "@/services/purchase-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Goods Receipt — mirrors `sales/orders/convert-to-invoice-dialog.tsx`'s
 * role but far simpler: every PO line converts as-is (no per-line
 * selection, PurchaseOrderItem has no partial-receipt tracking), so the
 * only input needed is the one destination warehouse for the whole receipt
 * (PurchaseOrderItem has no warehouse column at all, ADR-0015).
 */
export function ConvertToInvoiceDialog({
  open,
  onOpenChange,
  order,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PurchaseOrderRow;
  onConverted: (invoice: { id: string; invoiceNumber: string }) => void;
}) {
  const { t } = useLocale();
  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!warehouse) {
      toast.error(t("sales.editor.grid.warehouseRequired"));
      return;
    }
    setIsSubmitting(true);
    try {
      const invoice = await purchaseOrdersService.convertToInvoice(order.id, warehouse.id);
      toast.success(t("purchasing.orders.convertToInvoice.success"));
      onConverted(invoice);
      onOpenChange(false);
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
      size="md"
      title={t("purchasing.orders.convertToInvoice.title")}
      description={t("purchasing.orders.convertToInvoice.description")}
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
          <EnterpriseButton type="button" onClick={submit} disabled={isSubmitting}>
            {t("purchasing.orders.convertToInvoice.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-caption text-muted-foreground">
          {t("purchasing.orders.convertToInvoice.warehouse")}
        </label>
        <WarehousePicker value={warehouse} onChange={setWarehouse} disabled={isSubmitting} />
      </div>
    </EnterpriseModal>
  );
}
