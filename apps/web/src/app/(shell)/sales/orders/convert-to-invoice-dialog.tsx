"use client";

import { useState } from "react";
import { ArrowRightCircle } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
      size="md"
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
      <div className="flex flex-col gap-3">
        {invoiceableItems.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("sales.orders.convertToInvoice.noRemainingLines")}
          </p>
        )}
        {invoiceableItems.map((item) => {
          const remaining = item.quantity - item.deliveredQuantity;
          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3"
            >
              <Checkbox
                checked={included[item.id] ?? false}
                onCheckedChange={(checked) =>
                  setIncluded((prev) => ({ ...prev, [item.id]: !!checked }))
                }
              />
              <p className="min-w-40 flex-1 text-sm font-medium">
                {item.product?.displayName || item.product?.name || "—"}
              </p>
              <span className="text-caption text-muted-foreground">
                {t("sales.orders.convertToInvoice.remaining")}: {remaining}
              </span>
              <Input
                type="number"
                min={1}
                max={remaining}
                dir="ltr"
                inputSize="compact-md"
                className="min-w-(--width-control-quantity)"
                disabled={!included[item.id]}
                value={quantities[item.id] ?? remaining}
                onChange={(event) =>
                  setQuantities((prev) => ({
                    ...prev,
                    [item.id]: event.target.valueAsNumber || remaining,
                  }))
                }
              />
            </div>
          );
        })}
      </div>
    </EnterpriseModal>
  );
}
