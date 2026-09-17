"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { DocumentLineReviewTable } from "@/components/documents/document-line-review-table";
import {
  salesReturnsService,
  type SalesReturnFormPayload,
  type SalesReturnableSummaryItem,
} from "@/services/sales-returns-service";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Sales Invoice → Sales Return creation (TASK-048) — the ONLY way a Sales
 * Return is ever created; there is no standalone "+ New" for Returns.
 * Fetches `returnableSummary` when opened so already-returned quantities
 * are visible and each line's quantity input is capped at what's actually
 * still remaining (invoiced minus already returned across other returns,
 * not just the original invoiced amount) — the backend's own
 * `assertReturnableQuantity` remains the final source of truth, this is
 * just proactive UI instead of a rejected-submit surprise. A fully
 * returned line (remaining = 0) can't be selected at all.
 */
export function CreateReturnDialog({
  open,
  onOpenChange,
  invoice,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: SalesInvoiceRow;
  onCreated: (salesReturn: { id: string; returnNumber: string }) => void;
}) {
  const { t } = useLocale();
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(invoice.items.map((item) => [item.id, item.quantity])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [remainingById, setRemainingById] = useState<Record<string, SalesReturnableSummaryItem>>(
    {},
  );

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingSummary(true);
    salesReturnsService
      .returnableSummary(invoice.id)
      .then((summary) => {
        const byId = Object.fromEntries(
          summary.items.map((item) => [item.salesInvoiceItemId, item]),
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
      toast.error(t("sales.invoices.createReturn.noLinesSelected"));
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: SalesReturnFormPayload = {
        partnerId: invoice.partnerId,
        salesInvoiceId: invoice.id,
        items: selectedLines.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId,
          unitId: item.unitId,
          quantity: quantities[item.id] ?? item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          taxId: item.taxId ?? undefined,
          salesInvoiceItemId: item.id,
        })),
      };
      const salesReturn = await salesReturnsService.create(payload);
      toast.success(t("sales.invoices.createReturn.success"));
      onOpenChange(false);
      onCreated(salesReturn);
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
      title={t("sales.invoices.createReturn.title")}
      description={t("sales.invoices.createReturn.description")}
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
            {t("sales.invoices.createReturn.confirm")}
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
              ? t("sales.invoices.createReturn.fullyReturned")
              : returned > 0
                ? `${t("sales.invoices.createReturn.invoicedQuantity")}: ${item.quantity} · ${t("sales.invoices.createReturn.alreadyReturned")}: ${returned}`
                : `${t("sales.invoices.createReturn.invoicedQuantity")}: ${item.quantity}`,
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
