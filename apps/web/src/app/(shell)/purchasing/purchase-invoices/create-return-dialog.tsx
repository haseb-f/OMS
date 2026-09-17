"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { DocumentLineReviewTable } from "@/components/documents/document-line-review-table";
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
        partnerId: invoice.partnerId,
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
      size="lg"
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
      <DocumentLineReviewTable
        showSelect
        isLoading={isLoadingSummary}
        rows={invoice.items.map((item) => {
          const remaining = remainingFor(item.id, item.quantity);
          const returned = remainingById[item.id]?.returnedQuantity ?? 0;
          const fullyReturned = remaining <= 0;
          return {
            id: item.id,
            productName: item.product?.displayName || item.product?.name || "—",
            meta: fullyReturned
              ? t("purchasing.invoices.createReturn.fullyReturned")
              : returned > 0
                ? `${t("purchasing.invoices.createReturn.receivedQuantity")}: ${item.quantity} · ${t("purchasing.invoices.createReturn.alreadyReturned")}: ${returned}`
                : `${t("purchasing.invoices.createReturn.receivedQuantity")}: ${item.quantity}`,
            selected: !fullyReturned && (included[item.id] ?? false),
            selectDisabled: fullyReturned || isLoadingSummary,
            onSelectedChange: (selected) =>
              setIncluded((prev) => ({ ...prev, [item.id]: selected })),
            quantity: quantities[item.id] ?? Math.max(1, remaining),
            quantityMin: 1,
            quantityMax: remaining,
            quantityDisabled: !included[item.id] || fullyReturned || isLoadingSummary,
            onQuantityChange: (quantity) =>
              setQuantities((prev) => ({ ...prev, [item.id]: quantity })),
          };
        })}
      />
    </EnterpriseModal>
  );
}
