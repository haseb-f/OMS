"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DocumentLineReviewTable } from "@/components/documents/document-line-review-table";
import {
  purchaseReturnsService,
  type PurchaseReturnFormPayload,
  type PurchaseReturnableSummaryItem,
} from "@/services/purchase-returns-service";
import type { PurchaseInvoiceRow } from "@/services/purchase-invoices-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";

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
  // R13b — capitalized / deferred lines that cannot be returned, with the reason.
  const blockedLines = invoice.items.flatMap((item) => {
    const reason = remainingById[item.id]?.returnBlockedReason;
    return reason
      ? [{ id: item.id, name: item.product?.displayName || item.product?.name || "—", reason }]
      : [];
  });

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
      reportApiError(error, "errors.generic");
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
          const blocked = Boolean(remainingById[item.id]?.returnBlockedReason);
          // A fixed asset is one unit of account — its line is returned whole.
          const wholeLine = Boolean(remainingById[item.id]?.wholeLineOnly);
          return {
            id: item.id,
            productName: item.product?.displayName || item.product?.name || "—",
            meta: fullyReturned
              ? t("purchasing.invoices.createReturn.fullyReturned")
              : blocked
                ? t("assetSchedules.returns.blocked")
                : wholeLine
                  ? t("assetSchedules.returns.wholeLineOnly")
                  : returned > 0
                    ? `${t("purchasing.invoices.createReturn.receivedQuantity")}: ${item.quantity} · ${t("purchasing.invoices.createReturn.alreadyReturned")}: ${returned}`
                    : `${t("purchasing.invoices.createReturn.receivedQuantity")}: ${item.quantity}`,
            selected: !fullyReturned && !blocked && (included[item.id] ?? false),
            selectDisabled: fullyReturned || blocked || isLoadingSummary,
            onSelectedChange: (selected) =>
              setIncluded((prev) => ({ ...prev, [item.id]: selected })),
            quantity: wholeLine ? remaining : (quantities[item.id] ?? Math.max(1, remaining)),
            quantityMin: wholeLine ? remaining : 1,
            quantityMax: remaining,
            quantityDisabled:
              !included[item.id] || fullyReturned || blocked || wholeLine || isLoadingSummary,
            onQuantityChange: (quantity) =>
              setQuantities((prev) => ({ ...prev, [item.id]: quantity })),
          };
        })}
      />
      {blockedLines.length > 0 ? (
        <Alert tone="warning" className="mt-3">
          <AlertTitle>{t("assetSchedules.returns.blocked")}</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {blockedLines.map((line) => (
                <li key={line.id}>
                  <span className="font-medium">{line.name}</span> — {line.reason}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </EnterpriseModal>
  );
}
