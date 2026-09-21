"use client";

import { useState } from "react";
import { ArrowRightCircle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { DocumentLineReviewTable } from "@/components/documents/document-line-review-table";
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
  // Smart default: each order line starts from the quotation line's own
  // warehouse, so accepting the conversion is a single click.
  const [warehouses, setWarehouses] = useState<Record<string, WarehouseRow | null>>(() =>
    Object.fromEntries(quotation.items.map((item) => [item.id, item.warehouse ?? null])),
  );
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
      size="lg"
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
      <DocumentLineReviewTable
        showWarehouse
        rows={quotation.items.map((item) => ({
          id: item.id,
          productName: item.product?.displayName || item.product?.name || "—",
          quantity: quantities[item.id] ?? item.quantity,
          quantityMin: 1,
          onQuantityChange: (quantity) =>
            setQuantities((prev) => ({ ...prev, [item.id]: quantity })),
          warehouse: warehouses[item.id] ?? null,
          warehouseError: !warehouses[item.id],
          onWarehouseChange: (warehouse) =>
            setWarehouses((prev) => ({ ...prev, [item.id]: warehouse })),
        }))}
      />
    </EnterpriseModal>
  );
}
