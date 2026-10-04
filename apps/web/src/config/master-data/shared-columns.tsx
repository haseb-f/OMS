"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/business/status-badge";
import type { ColumnType } from "@/components/shared/data-table";
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

/** The Active / Archived pill — exported so a Grid card shows the exact badge the table does. */
export function ActiveArchivedBadge({ deletedAt }: { deletedAt?: string | null }) {
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
    meta: {
      titleKey: "common.status",
      // Declared (not inferred) so the Grid card draws it as a status badge (R9).
      type: "status",
      displayValue: (row, t) => t(row.deletedAt ? "common.archived" : "common.active"),
    },
    accessorFn: (row) => (row.deletedAt ? "archived" : "active"),
    cell: ({ row }) => <ActiveArchivedBadge deletedAt={row.original.deletedAt} />,
    enableSorting: false,
  };
}

/**
 * A plain text column reading a string field, with a translated header.
 * `type` is the semantic column type; leave it out and the table infers one
 * from the id. Pass it whenever the inference would be wrong — the Grid card
 * (R9) orders its slots by type: the first `name` column becomes the card
 * title, a `code` its reference, `money` + `date` the key-figure line.
 */
export function textColumn<T>(
  id: string,
  messageKey: MessageKey,
  accessor: (row: T) => string | null | undefined,
  type?: ColumnType,
): ColumnDef<T, unknown> {
  return {
    id,
    meta: type ? { titleKey: messageKey, type } : { titleKey: messageKey },
    accessorFn: (row) => accessor(row) ?? "—",
    cell: (info) => info.getValue() as string,
  };
}
