"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { z } from "zod";
import { Check, Wallet } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import { textColumn } from "@/config/master-data/shared-columns";
import { StatusBadge } from "@/components/business/status-badge";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { SearchableSelect } from "@/components/shared/searchable-select";
import type { RowAction } from "@/components/shared/data-table";
import {
  accruedExpensesService,
  type AccruedExpenseRow,
} from "@/services/accrued-expenses-service";
import { ApiError } from "@/services/api-client";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** `/receiving-accounts` rows carry `code` at runtime; `ReceivingAccountOption` does not declare it. */
type ReceivingAccountWithCode = ReceivingAccountOption & { code?: string };

const receivingAccountLabel = (account: ReceivingAccountWithCode) =>
  account.code ? `${account.code} — ${account.name}` : account.name;

const schema = z.object({
  name: z.string().min(1),
  amount: z.number().min(0.01),
  recognitionDate: z.string().min(1),
  expenseAccountId: z.string().min(1),
  receivingAccountId: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

const defaultValues = {
  name: "",
  amount: 0,
  recognitionDate: "",
  expenseAccountId: "",
  receivingAccountId: "",
  notes: "",
};

function AccrualStatusCell({ status }: { status: AccruedExpenseRow["status"] }) {
  const { t } = useLocale();
  const tone = status === "SETTLED" ? "success" : status === "RECOGNIZED" ? "warning" : "neutral";
  return (
    <StatusBadge label={t(`accounting.lifecycleStatus.${status}` as MessageKey)} tone={tone} />
  );
}

const columns: ColumnDef<AccruedExpenseRow, unknown>[] = [
  textColumn("accrualNumber", "accounting.accruals.fields.accrualNumber", (r) => r.accrualNumber),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("amount", "masterData.expenses.fields.amount", (r) =>
    Number(r.amount).toLocaleString(),
  ),
  textColumn("recognitionDate", "accounting.accruals.fields.recognitionDate", (r) =>
    formatDate(r.recognitionDate),
  ),
  textColumn("expenseAccount", "accounting.accruals.fields.expenseAccount", (r) =>
    r.expenseAccount ? `${r.expenseAccount.code} — ${r.expenseAccount.name}` : null,
  ),
  {
    id: "status",
    accessorFn: (row) => row.status,
    meta: { titleKey: "accounting.accruals.fields.status" },
    cell: ({ row }) => <AccrualStatusCell status={row.original.status} />,
  },
  {
    id: "journal",
    meta: { titleKey: "accounting.journalEntries.fields.viewJournalEntry" },
    cell: ({ row }) =>
      row.original.status === "DRAFT" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <JournalTraceCell sourceType="ACCRUED_EXPENSE" sourceId={row.original.id} expected />
      ),
  },
];

function AccruedExpensesPageContent() {
  const { t } = useLocale();
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountWithCode[]>([]);
  const [tableKey, setTableKey] = useState(0);
  const [recognizeTarget, setRecognizeTarget] = useState<AccruedExpenseRow | null>(null);
  const [settleTarget, setSettleTarget] = useState<AccruedExpenseRow | null>(null);
  const [settleAccountId, setSettleAccountId] = useState("");
  const settleAccountFieldId = useId();
  const [busy, setBusy] = useState(false);

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
        required: true,
      },
      {
        name: "recognitionDate",
        label: "accounting.accruals.fields.recognitionDate",
        type: "date",
        required: true,
      },
      {
        name: "expenseAccountId",
        label: "accounting.accruals.fields.expenseAccount",
        type: "account",
        postingOnly: true,
        required: true,
      },
      {
        name: "receivingAccountId",
        label: "accounting.accruals.fields.receivingAccount",
        type: "select",
        options: receivingAccounts.map((account) => ({
          value: account.id,
          label: receivingAccountLabel(account),
        })),
      },
      { name: "notes", label: "masterData.fields.notes", type: "textarea" },
    ],
    [receivingAccounts],
  );

  const reload = () => setTableKey((value) => value + 1);

  const handleRecognize = async () => {
    if (!recognizeTarget) return;
    setBusy(true);
    try {
      await accruedExpensesService.recognize(recognizeTarget.id);
      toast.success(t("accounting.accruals.toasts.recognized"));
      setRecognizeTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const handleSettle = async () => {
    if (!settleTarget || !settleAccountId) return;
    setBusy(true);
    try {
      await accruedExpensesService.settle(settleTarget.id, {
        receivingAccountId: settleAccountId,
      });
      toast.success(t("accounting.accruals.toasts.settled"));
      setSettleTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <MasterDataPage
        key={tableKey}
        titleKey="accounting.accruals.title"
        descriptionKey="accounting.accruals.description"
        tableId="accrued-expenses"
        service={accruedExpensesService}
        columns={columns}
        exportColumnKeys={["accrualNumber", "name", "amount", "recognitionDate"]}
        formFields={formFields}
        schema={schema}
        defaultValues={defaultValues}
        permissionPrefix="accrued-expenses"
        rowLabel={(row) => `${row.accrualNumber} — ${row.name}`}
        defaultSortBy="createdAt"
        defaultSortOrder="desc"
        disableArchiveRestore
        extraRowActions={(entity): RowAction[] => [
          {
            key: "recognize",
            label: t("accounting.accruals.recognize"),
            icon: Check,
            hidden: entity.status !== "DRAFT" || Boolean(entity.deletedAt),
            onSelect: () => setRecognizeTarget(entity),
          },
          {
            key: "settle",
            label: t("accounting.accruals.settle"),
            icon: Wallet,
            hidden: entity.status !== "RECOGNIZED" || Boolean(entity.deletedAt),
            onSelect: () => {
              setSettleAccountId(entity.receivingAccountId ?? receivingAccounts[0]?.id ?? "");
              setSettleTarget(entity);
            },
          },
        ]}
      />
      <ConfirmationDialog
        open={Boolean(recognizeTarget)}
        onOpenChange={(open) => {
          if (!open) setRecognizeTarget(null);
        }}
        title={t("accounting.accruals.recognize")}
        confirmLabel={t("accounting.accruals.recognize")}
        isConfirming={busy}
        onConfirm={() => void handleRecognize()}
      />
      <ConfirmationDialog
        open={Boolean(settleTarget)}
        onOpenChange={(open) => {
          if (!open) setSettleTarget(null);
        }}
        title={t("accounting.accruals.settle")}
        extra={
          <div className="flex flex-col gap-1.5 px-6">
            <label htmlFor={settleAccountFieldId} className="text-caption text-muted-foreground">
              {t("accounting.accruals.fields.receivingAccount")}
            </label>
            <SearchableSelect
              id={settleAccountFieldId}
              value={settleAccountId}
              onValueChange={setSettleAccountId}
              options={receivingAccounts.map((account) => ({
                value: account.id,
                label: receivingAccountLabel(account),
              }))}
            />
          </div>
        }
        confirmLabel={t("accounting.accruals.settle")}
        confirmDisabled={!settleAccountId}
        isConfirming={busy}
        onConfirm={() => void handleSettle()}
      />
    </>
  );
}

export default function AccruedExpensesPage() {
  return (
    <PermissionGate permission="accrued-expenses.view">
      <AccruedExpensesPageContent />
    </PermissionGate>
  );
}
