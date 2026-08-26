"use client";

import { Download, Printer, Truck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";

/**
 * Store Orders list bulk-actions row (rendered inside `EnterpriseDataTable`'s
 * `bulkActions` slot) — Print/Export, plus the order-specific "Change
 * Shipping Status" bulk action (TASK-064) when the caller both wires it up
 * and the current user holds `shipping.manage` (the same server-enforced
 * permission the individual per-order action requires — this button is a
 * convenience hide, never the real gate). No bulk archive/delete here — a
 * Store Order's lifecycle isn't managed the same way a Sales Order is.
 */
export function StoreOrdersBulkActions({
  onPrint,
  onExport,
  onChangeShippingStatus,
  canChangeShippingStatus,
  labels,
}: {
  onPrint: () => void;
  onExport: () => void;
  onChangeShippingStatus?: () => void;
  canChangeShippingStatus?: boolean;
  labels: { print: string; export: string; changeShippingStatus?: string };
}) {
  return (
    <>
      {canChangeShippingStatus && onChangeShippingStatus && (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onChangeShippingStatus}
        >
          <Truck className="size-3.5" />
          {labels.changeShippingStatus}
        </EnterpriseButton>
      )}
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onPrint}
      >
        <Printer className="size-3.5" />
        {labels.print}
      </EnterpriseButton>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onExport}
      >
        <Download className="size-3.5" />
        {labels.export}
      </EnterpriseButton>
    </>
  );
}
