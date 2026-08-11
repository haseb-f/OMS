"use client";

import { Download, Printer } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";

/**
 * Store Orders list bulk-actions row (rendered inside `EnterpriseDataTable`'s
 * `bulkActions` slot) — Print/Export only, mirroring `SalesListBulkActions`'s
 * pattern. No bulk archive/delete here — a Store Order's lifecycle isn't
 * managed the same way a Sales Order is.
 */
export function StoreOrdersBulkActions({
  onPrint,
  onExport,
  labels,
}: {
  onPrint: () => void;
  onExport: () => void;
  labels: { print: string; export: string };
}) {
  return (
    <>
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
