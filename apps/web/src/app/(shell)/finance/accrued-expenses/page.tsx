"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Check, Wallet } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { textColumn } from "@/config/master-data/shared-columns";
import { StatusBadge } from "@/components/business/status-badge";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RowAction } from "@/components/shared/data-table";
import {
  accruedExpensesService,
  type AccruedExpenseRow,
} from "@/services/accrued-expenses-service";
import { apiClient, ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

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
];

function AccruedExpensesPageContent() {
  const { t } = useLocale();
  const [receivingAccounts, setReceivingAccounts] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [tableKey, setTableKey] = useState(0);
  const [recognizeTarget, setRecognizeTarget] = useState<AccruedExpenseRow | null>(null);
  const [settleTarget, setSettleTarget] = useState<AccruedExpenseRow | null>(null);
  const [settleAccountId, setSettleAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient
      .get<
        | { id: string; code: string; name: string }[]
        | { items: { id: string; code: string; name: string }[] }
      >("/receiving-accounts")
      .then((result) => setReceivingAccounts(Array.isArray(result) ? result : (result.items ?? [])))
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
          label: `${account.code} — ${account.name}`,
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
            <label className="text-caption text-muted-foreground">
              {t("accounting.accruals.fields.receivingAccount")}
            </label>
            <Select value={settleAccountId || undefined} onValueChange={setSettleAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {receivingAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
