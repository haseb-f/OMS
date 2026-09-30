"use client";

import { Archive } from "lucide-react";
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
 * The Archive action every document list adds to `EnterpriseDataTable`'s
 * bulk strip. Print/Export of the selection are built into the table itself
 * ("Print selected" / "Export selected"), so they are never repeated here.
 */
export function SalesListBulkActions({
  onArchive,
  archiveDisabled,
  labels,
}: {
  onArchive: () => void;
  archiveDisabled?: boolean;
  labels: { archive: string };
}) {
  return (
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
  );
}
