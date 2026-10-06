"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import { textColumn } from "@/config/master-data/shared-columns";
import { formatAmount } from "@/lib/money";
import { StatusBadge } from "@/components/business/status-badge";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  prepaidExpensesService,
  type PrepaidExpenseRow,
} from "@/services/prepaid-expenses-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { useLocale } from "@/providers/locale-provider";
import { useProcessDueSchedules } from "@/hooks/use-process-due-schedules";
import { formatDate } from "@/lib/date";
import { prepaidStatusTone } from "@/config/finance/schedule-status";
import type { MessageKey } from "@/i18n/translate";
import { useUserContext } from "@/providers/user-context";

/** `/receiving-accounts` rows carry `code` at runtime; `ReceivingAccountOption` does not declare it. */
type ReceivingAccountWithCode = ReceivingAccountOption & { code?: string };

const receivingAccountLabel = (account: ReceivingAccountWithCode) =>
  account.code ? `${account.code} — ${account.name}` : account.name;

const schema = z.object({
  name: z.string().min(1),
  amount: z.number().min(0.01),
  startDate: z.string().min(1),
  totalPeriods: z.number().min(1),
  expenseAccountId: z.string().min(1),
  receivingAccountId: z.string().min(1),
  notes: z.string().optional().or(z.literal("")),
});

const defaultValues = {
  name: "",
  amount: undefined as unknown as number, // new, unset → the field stays empty (placeholder "0.00"), never a 0 to delete
  startDate: "",
  totalPeriods: 1,
  expenseAccountId: "",
  receivingAccountId: "",
  notes: "",
};

function PrepaidStatusCell({ status }: { status: PrepaidExpenseRow["status"] }) {
  const { t } = useLocale();
  const tone = prepaidStatusTone[status];
  return (
    <StatusBadge label={t(`accounting.lifecycleStatus.${status}` as MessageKey)} tone={tone} />
  );
}

const columns: ColumnDef<PrepaidExpenseRow, unknown>[] = [
  textColumn(
    "prepaidNumber",
    "accounting.prepaid.fields.prepaidNumber",
    (r) => r.prepaidNumber,
    "code",
  ),
  textColumn("name", "masterData.fields.name", (r) => r.name, "name"),
  {
    ...textColumn("amount", "masterData.expenses.fields.amount", (r) => formatAmount(r.amount)),
    meta: { titleKey: "masterData.expenses.fields.amount", type: "money" },
  },
  textColumn(
    "startDate",
    "accounting.prepaid.fields.startDate",
    (r) => formatDate(r.startDate),
    "date",
  ),
  textColumn("endDate", "accounting.prepaid.fields.endDate", (r) => formatDate(r.endDate), "date"),
  // A count of periods (the id contains "period", which would infer `date`).
  textColumn(
    "totalPeriods",
    "accounting.prepaid.fields.totalPeriods",
    (r) => String(r.totalPeriods),
    "number",
  ),
  {
    ...textColumn("recognizedAmount", "accounting.prepaid.fields.recognizedAmount", (r) =>
      formatAmount(r.recognizedAmount ?? 0),
    ),
    meta: { titleKey: "accounting.prepaid.fields.recognizedAmount", type: "money" },
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    meta: {
      titleKey: "accounting.prepaid.fields.status",
      type: "status",
      displayValue: (row, t) => t(`accounting.lifecycleStatus.${row.status}` as MessageKey),
    },
    cell: ({ row }) => <PrepaidStatusCell status={row.original.status} />,
  },
  {
    id: "journal",
    meta: { titleKey: "accounting.journalEntries.fields.viewJournalEntry", type: "default" },
    cell: ({ row }) =>
      row.original.status === "DRAFT" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <JournalTraceCell sourceType="PREPAID_EXPENSE" sourceId={row.original.id} expected />
      ),
  },
];

function PrepaidExpensesPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountWithCode[]>([]);
  const [tableKey, setTableKey] = useState(0);
  const [recognizeOpen, setRecognizeOpen] = useState(false);

  useEffect(() => {
    // Session-cached, active-only list (shared with every other receiving-account picker).
    receivingAccountsService
      .list()
      .then((rows) => setReceivingAccounts(rows as ReceivingAccountWithCode[]))
      .catch(() => setReceivingAccounts([]));
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      { name: "name", label: "masterData.fields.name", type: "text", required: true },
      {
        name: "amount",
        label: "masterData.expenses.fields.amount",
        type: "number",
        money: true,
        required: true,
      },
      {
        name: "startDate",
        label: "accounting.prepaid.fields.startDate",
        type: "date",
        required: true,
      },
      {
        name: "totalPeriods",
        label: "accounting.prepaid.fields.totalPeriods",
        type: "number",
        required: true,
        // The end date is derived (start + periods − 1 day), never typed.
        description: t("assetSchedules.fields.endDateDerived"),
      },
      {
        name: "expenseAccountId",
        label: "accounting.prepaid.fields.expenseAccount",
        type: "account",
        postingOnly: true,
        required: true,
      },
      {
        name: "receivingAccountId",
        label: "accounting.prepaid.fields.receivingAccount",
        type: "select",
        required: true,
        options: receivingAccounts.map((account) => ({
          value: account.id,
          label: receivingAccountLabel(account),
        })),
      },
      { name: "notes", label: "masterData.fields.notes", type: "textarea" },
    ],
    [receivingAccounts, t],
  );

  const processDue = useProcessDueSchedules("prepaid", () => setTableKey((value) => value + 1));

  return (
    <>
      <MasterDataPage
        key={tableKey}
        titleKey="accounting.prepaid.title"
        descriptionKey="accounting.prepaid.description"
        tableId="prepaid-expenses"
        service={prepaidExpensesService}
        columns={columns}
        exportColumnKeys={["prepaidNumber", "name", "amount", "startDate", "endDate"]}
        formFields={formFields}
        schema={schema}
        defaultValues={defaultValues}
        permissionPrefix="prepaid-expenses"
        rowLabel={(row) => `${row.prepaidNumber} — ${row.name}`}
        defaultSortBy="createdAt"
        defaultSortOrder="desc"
        disableArchiveRestore
        headerSecondary={[
          {
            key: "recognize",
            label: t("accounting.prepaid.recognize"),
            hidden: !hasPermission("prepaid-expenses.edit"),
            onSelect: () => setRecognizeOpen(true),
          },
        ]}
        getRowHref={(row) => `/finance/prepaid-expenses/${row.id}`}
      />
      <ConfirmationDialog
        open={recognizeOpen}
        onOpenChange={setRecognizeOpen}
        title={t("accounting.prepaid.recognize")}
        description={t("assetSchedules.dialogs.processDueDescription")}
        confirmLabel={t("accounting.prepaid.recognize")}
        isConfirming={processDue.busy}
        onConfirm={() => void processDue.run().then(() => setRecognizeOpen(false))}
      />
    </>
  );
}

export default function PrepaidExpensesPage() {
  return (
    <PermissionGate permission="prepaid-expenses.view">
      <PrepaidExpensesPageContent />
    </PermissionGate>
  );
}
