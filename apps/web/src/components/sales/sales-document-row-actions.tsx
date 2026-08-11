"use client";

import { Archive, Download, Printer } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { RowActionsMenu, type RowAction } from "@/components/shared/data-table";

/**
 * TASK-047 — kept as a re-export so the 21 existing Sales/Purchasing/
 * Finance/Inventory/Settings imports of these names never had to change.
 * The actual implementation now lives in the generic, tableId-agnostic
 * `RowActionsMenu` under `components/shared/data-table` — every new
 * consumer (Master Data, etc.) should import that directly instead of
 * these Sales-named aliases.
 */
export type SalesDocumentRowAction = RowAction;
export const SalesDocumentRowActionsMenu = RowActionsMenu;

/**
 * The one bulk-actions row every Sales document list reuses (Print/Export/
 * Archive) — rendered inside `EnterpriseDataTable`'s `bulkActions` slot,
 * which only appears once at least one row is selected.
 */
export function SalesListBulkActions({
  onPrint,
  onExport,
  onArchive,
  archiveDisabled,
  labels,
}: {
  onPrint: () => void;
  onExport: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  labels: { print: string; export: string; archive: string };
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
      {onArchive && (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={archiveDisabled}
          onClick={onArchive}
        >
          <Archive className="size-3.5" />
          {labels.archive}
        </EnterpriseButton>
      )}
    </>
  );
}
