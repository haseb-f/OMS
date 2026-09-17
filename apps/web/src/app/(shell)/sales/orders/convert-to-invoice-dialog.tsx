"use client";

import { useState } from "react";
import { ArrowRightCircle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { DocumentLineReviewTable } from "@/components/documents/document-line-review-table";
import { salesOrdersService, type SalesOrderRow } from "@/services/sales-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Sales Order → Sales Invoice conversion (TASK-043 §7/§10/§15) — partial-
 * quantity aware, matching the existing backend
 * `SalesOrdersService.convertToInvoice` → `SalesInvoicesService.createFromOrder`
 * flow. Every line defaults to fully invoicing whatever remains undelivered
 * (ordered − already delivered) so the common case — invoice the whole
 * order — is a single click; partial invoicing is just unchecking/adjusting
 * a line. No inventory or pricing math happens here.
 */
export function ConvertToInvoiceDialog({
  open,
  onOpenChange,
  order,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: SalesOrderRow;
  onConverted: (invoice: { id: string; invoiceNumber: string }) => void;
}) {
  const { t } = useLocale();
  const invoiceableItems = order.items.filter((item) => item.quantity - item.deliveredQuantity > 0);

  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(invoiceableItems.map((item) => [item.id, true])),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      invoiceableItems.map((item) => [item.id, item.quantity - item.deliveredQuantity]),
    ),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedLines = invoiceableItems.filter((item) => included[item.id]);

  const handleConfirm = async () => {
    if (selectedLines.length === 0) {
      toast.error(t("sales.orders.convertToInvoice.noLinesSelected"));
      return;
    }
    setIsSubmitting(true);
    try {
      const invoice = await salesOrdersService.convertToInvoice(order.id, {
        items: selectedLines.map((item) => ({
          salesOrderItemId: item.id,
          quantity: quantities[item.id] ?? item.quantity - item.deliveredQuantity,
        })),
      });
      toast.success(t("sales.orders.convertToInvoice.success"));
      onOpenChange(false);
      onConverted(invoice);
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
      title={t("sales.orders.convertToInvoice.title")}
      description={t("sales.orders.convertToInvoice.description")}
      size="lg"
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
          <EnterpriseButton type="button" disabled={isSubmitting} onClick={handleConfirm}>
            {t("sales.orders.convertToInvoice.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <DocumentLineReviewTable
        showSelect
        empty={t("sales.orders.convertToInvoice.noRemainingLines")}
        rows={invoiceableItems.map((item) => {
          const remaining = item.quantity - item.deliveredQuantity;
          return {
            id: item.id,
            productName: item.product?.displayName || item.product?.name || "—",
            meta: `${t("sales.orders.convertToInvoice.remaining")}: ${remaining}`,
            selected: included[item.id] ?? false,
            onSelectedChange: (selected) =>
              setIncluded((prev) => ({ ...prev, [item.id]: selected })),
            quantity: quantities[item.id] ?? remaining,
            quantityMin: 1,
            quantityMax: remaining,
            quantityDisabled: !included[item.id],
            onQuantityChange: (quantity) =>
              setQuantities((prev) => ({ ...prev, [item.id]: quantity })),
          };
        })}
      />
    </EnterpriseModal>
  );
}
