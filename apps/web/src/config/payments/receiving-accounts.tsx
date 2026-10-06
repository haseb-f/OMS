import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { StatusBadge } from "@/components/business/status-badge";
import { statusColumn, textColumn } from "@/config/master-data/shared-columns";
import { useLocale } from "@/providers/locale-provider";

/**
 * Receiving accounts (R13 D1) — WHERE the money arrives (bank, cash box, wallet): the destination
 * a settlement or receipt debits. A tab of the Payment Methods area; destinations, not methods.
 */
export interface ReceivingAccountRow {
  id: string;
  name: string;
  code: string;
  chartOfAccountId: string;
  chartOfAccount?: { id: string; code: string; name: string } | null;
  currencyId: string | null;
  currency?: { id: string; code: string; name: string } | null;
  notes: string | null;
  isActive: boolean;
  isDefault: boolean;
  deletedAt: string | null;
}

function ReceivingAccountDefaultCell({ row }: { row: ReceivingAccountRow }) {
  const { t } = useLocale();
  return row.isDefault ? (
    <StatusBadge label={t("paymentReconciliation.methodsArea.default")} tone="info" />
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export const receivingAccountsColumns: ColumnDef<ReceivingAccountRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code, "code"),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn(
    "chartOfAccount",
    "paymentReconciliation.methodsArea.fields.destinationAccount",
    (r) => (r.chartOfAccount ? `${r.chartOfAccount.code} — ${r.chartOfAccount.name}` : null),
    "default",
  ),
  textColumn("currency", "masterData.fields.currency", (r) => r.currency?.code, "default"),
  {
    id: "isDefault",
    meta: {
      titleKey: "paymentReconciliation.methodsArea.default",
      type: "default",
      displayValue: (row, t) =>
        row.isDefault ? t("paymentReconciliation.methodsArea.default") : "—",
    },
    accessorFn: (row) => (row.isDefault ? "default" : ""),
    cell: ({ row }) => <ReceivingAccountDefaultCell row={row.original} />,
    enableSorting: false,
  },
  statusColumn<ReceivingAccountRow>(),
];

/** The page passes the live currency list and the translated "generated automatically" hint. */
export function receivingAccountsFormFields(
  currencyOptions: { value: string; label: string }[],
  codePlaceholder: string,
): MasterDataFormField[] {
  return [
    { name: "name", label: "masterData.fields.name", type: "text", required: true },
    {
      name: "code",
      label: "masterData.fields.code",
      type: "text",
      placeholder: codePlaceholder,
    },
    {
      name: "chartOfAccountId",
      label: "paymentReconciliation.methodsArea.fields.destinationAccount",
      type: "account",
      required: true,
      postingOnly: true,
    },
    {
      name: "currencyId",
      label: "masterData.fields.currency",
      type: "select",
      options: currencyOptions,
    },
    {
      name: "isDefault",
      label: "paymentReconciliation.methodsArea.fields.isDefaultDestination",
      type: "boolean",
    },
    { name: "isActive", label: "masterData.fields.isActive", type: "boolean" },
    { name: "notes", label: "masterData.fields.notes", type: "textarea", span: "full" },
  ];
}

export const receivingAccountsSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().or(z.literal("")),
  chartOfAccountId: z.string().uuid(),
  currencyId: z.string().optional().or(z.literal("")),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().or(z.literal("")),
});

export const receivingAccountsDefaultValues = {
  name: "",
  code: "",
  chartOfAccountId: "",
  currencyId: "",
  isDefault: false,
  isActive: true,
  notes: "",
};

export const receivingAccountsToFormValues = (row: ReceivingAccountRow) => ({
  name: row.name,
  code: row.code,
  chartOfAccountId: row.chartOfAccountId,
  currencyId: row.currencyId ?? "",
  isDefault: row.isDefault,
  isActive: row.isActive,
  notes: row.notes ?? "",
});

export const receivingAccountsExportColumns = ["code", "name", "chartOfAccount", "currency"];
export const receivingAccountRowLabel = (row: ReceivingAccountRow) => `${row.code} — ${row.name}`;
