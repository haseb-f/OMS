"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/**
 * Column configs are plain data (module scope, no hooks) so entity config
 * files stay simple — the header's i18n text is resolved at render time by
 * `EnterpriseDataTable` (which reads `column.meta.titleKey` and feeds it to
 * the shared `EnterpriseTableColumnHeader`), not baked in here.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by tanstack's ColumnMeta generic signature
  interface ColumnMeta<TData, TValue> {
    titleKey?: MessageKey;
    /** Hidden until the user turns the column on via Columns. Still exported. */
    defaultHidden?: boolean;
  }
}

function StatusCell({ deletedAt }: { deletedAt?: string | null }) {
  const { t } = useLocale();
  return deletedAt ? (
    <StatusBadge label={t("common.archived")} tone="neutral" />
  ) : (
    <StatusBadge label={t("common.active")} tone="success" />
  );
}

/** Every Master Data entity uses this same Active/Archived pill, derived from `deletedAt` — never a bespoke status column. */
export function statusColumn<T extends { deletedAt?: string | null }>(): ColumnDef<T, unknown> {
  return {
    id: "status",
    meta: { titleKey: "common.status" },
    accessorFn: (row) => (row.deletedAt ? "archived" : "active"),
    cell: ({ row }) => <StatusCell deletedAt={row.original.deletedAt} />,
    enableSorting: false,
  };
}

/** A plain text column reading a string field, with a translated header. */
export function textColumn<T>(
  id: string,
  messageKey: MessageKey,
  accessor: (row: T) => string | null | undefined,
): ColumnDef<T, unknown> {
  return {
    id,
    meta: { titleKey: messageKey },
    accessorFn: (row) => accessor(row) ?? "—",
    cell: (info) => info.getValue() as string,
  };
}
