import { Copy, Undo2 } from "lucide-react";
import type { DocumentAction } from "@/components/documents/document-action-bar";
import type { MessageKey } from "@/i18n/translate";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Duplicate / Return to Draft — the same two secondary actions on every
 * commercial document. Duplicate always makes a new Draft (new number,
 * business fields only); Return to Draft is offered only in the statuses the
 * API accepts for that document and always states what it will undo.
 */
export function lifecycleActions<TContext>({
  t,
  documentLabel,
  canCreate,
  canEdit,
  returnToDraftStatuses,
  onDuplicate,
  onReturnToDraft,
}: {
  t: Translate;
  /** e.g. "Sales Invoice INV-2026-000184". */
  documentLabel: string;
  canCreate: boolean;
  canEdit: boolean;
  returnToDraftStatuses: string[];
  onDuplicate: () => Promise<void>;
  onReturnToDraft: () => Promise<void>;
}): DocumentAction<TContext>[] {
  const actions: DocumentAction<TContext>[] = [];
  if (canCreate) {
    actions.push({
      key: "duplicate",
      label: t("docFlow.lifecycle.duplicate"),
      icon: Copy,
      confirm: {
        title: t("docFlow.lifecycle.duplicateTitle"),
        description: t("docFlow.lifecycle.duplicateDescription", { document: documentLabel }),
        confirmLabel: t("docFlow.lifecycle.duplicate"),
      },
      onAction: onDuplicate,
    });
  }
  if (canEdit && returnToDraftStatuses.length > 0) {
    actions.push({
      key: "returnToDraft",
      label: t("docFlow.lifecycle.returnToDraft"),
      icon: Undo2,
      visibleForStatuses: returnToDraftStatuses,
      confirm: {
        title: t("docFlow.lifecycle.returnToDraftTitle"),
        description: t("docFlow.lifecycle.returnToDraftDescription", { document: documentLabel }),
        confirmLabel: t("docFlow.lifecycle.returnToDraft"),
        tone: "warning",
      },
      onAction: onReturnToDraft,
    });
  }
  return actions;
}
