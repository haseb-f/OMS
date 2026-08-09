"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  purchaseReturnsService,
  type PurchaseReturnFormPayload,
  type PurchaseReturnableSummaryItem,
} from "@/services/purchase-returns-service";
import type { PurchaseInvoiceRow } from "@/services/purchase-invoices-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Purchase Invoice → Purchase Return creation (TASK-048) — the ONLY way a
 * Purchase Return is ever created; there is no standalone "+ New" for
 * Returns. Mirrors `sales/invoices/create-return-dialog.tsx` exactly:
 * fetches `returnableSummary` when opened so already-returned quantities
 * are visible and each line's quantity input is capped at what's actually
 * still remaining, not just the original received amount. The backend's
 * own `assertReturnableQuantity` remains the final source of truth.
 */
export function CreateReturnDialog({
  open,
  onOpenChange,
  invoice,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: PurchaseInvoiceRow;
  onCreated: (purchaseReturn: { id: string; returnNumber: string }) => void;
}) {
  const { t } = useLocale();
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(invoice.items.map((item) => [item.id, item.quantity])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [remainingById, setRemainingById] = useState<Record<string, PurchaseReturnableSummaryItem>>(
    {},
  );

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingSummary(true);
    purchaseReturnsService
      .returnableSummary(invoice.id)
      .then((summary) => {
        const byId = Object.fromEntries(
          summary.items.map((item) => [item.purchaseInvoiceItemId, item]),
        );
        setRemainingById(byId);
        setQuantities(
          Object.fromEntries(
            invoice.items.map((item) => [
              item.id,
              Math.max(1, byId[item.id]?.remainingQuantity ?? item.quantity),
            ]),
          ),
        );
      })
      .catch(() => setRemainingById({}))
      .finally(() => setIsLoadingSummary(false));
  }, [open, invoice.id, invoice.items]);

  const remainingFor = (itemId: string, fallback: number) =>
    remainingById[itemId]?.remainingQuantity ?? fallback;

  const selectedLines = invoice.items.filter((item) => included[item.id]);

  const handleConfirm = async () => {
    if (selectedLines.length === 0) {
      toast.error(t("purchasing.invoices.createReturn.noLinesSelected"));
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: PurchaseReturnFormPayload = {
        supplierId: invoice.supplierId,
        purchaseInvoiceId: invoice.id,
        items: selectedLines.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId,
          unitId: item.unitId,
          quantity: quantities[item.id] ?? item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          taxId: item.taxId ?? undefined,
          purchaseInvoiceItemId: item.id,
        })),
      };
      const purchaseReturn = await purchaseReturnsService.create(payload);
      toast.success(t("purchasing.invoices.createReturn.success"));
      onOpenChange(false);
      onCreated(purchaseReturn);
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
      icon={Undo2}
      title={t("purchasing.invoices.createReturn.title")}
      description={t("purchasing.invoices.createReturn.description")}
      size="md"
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={isSubmitting || isLoadingSummary}
            onClick={handleConfirm}
          >
            {t("purchasing.invoices.createReturn.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        {invoice.items.map((item) => {
          const remaining = remainingFor(item.id, item.quantity);
          const returned = remainingById[item.id]?.returnedQuantity ?? 0;
          const fullyReturned = remaining <= 0;
          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3"
            >
              <Checkbox
                checked={!fullyReturned && (included[item.id] ?? false)}
                disabled={fullyReturned || isLoadingSummary}
                onCheckedChange={(checked) =>
                  setIncluded((prev) => ({ ...prev, [item.id]: !!checked }))
                }
              />
              <p className="min-w-40 flex-1 text-sm font-medium">
                {item.product?.displayName || item.product?.name || "—"}
              </p>
              <span className="text-caption text-muted-foreground">
                {t("purchasing.invoices.createReturn.receivedQuantity")}: {item.quantity}
                {returned > 0 && (
                  <>
                    {" · "}
                    {t("purchasing.invoices.createReturn.alreadyReturned")}: {returned}
                  </>
                )}
                {fullyReturned && (
                  <>
                    {" · "}
                    <span className="text-destructive">
                      {t("purchasing.invoices.createReturn.fullyReturned")}
                    </span>
                  </>
                )}
              </span>
              <Input
                type="number"
                min={1}
                max={remaining}
                dir="ltr"
                inputSize="compact-md"
                className="min-w-(--width-control-quantity)"
                disabled={!included[item.id] || fullyReturned || isLoadingSummary}
                value={quantities[item.id] ?? Math.max(1, remaining)}
                onChange={(event) => {
                  const raw = event.target.valueAsNumber || 1;
                  setQuantities((prev) => ({ ...prev, [item.id]: Math.min(raw, remaining) }));
                }}
              />
            </div>
          );
        })}
      </div>
    </EnterpriseModal>
  );
}
