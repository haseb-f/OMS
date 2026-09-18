"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Play } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { textColumn } from "@/config/master-data/shared-columns";
import { StatusBadge } from "@/components/business/status-badge";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import type { RowAction } from "@/components/shared/data-table";
import {
  prepaidExpensesService,
  type PrepaidExpenseRow,
} from "@/services/prepaid-expenses-service";
import { apiClient, ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import { useUserContext } from "@/providers/user-context";

const schema = z.object({
  name: z.string().min(1),
  amount: z.number().min(0.01),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  totalPeriods: z.number().min(1),
  expenseAccountId: z.string().min(1),
  receivingAccountId: z.string().min(1),
  notes: z.string().optional().or(z.literal("")),
});

const defaultValues = {
  name: "",
  amount: 0,
  startDate: "",
  endDate: "",
  totalPeriods: 1,
  expenseAccountId: "",
  receivingAccountId: "",
  notes: "",
};

function PrepaidStatusCell({ status }: { status: PrepaidExpenseRow["status"] }) {
  const { t } = useLocale();
  const tone = status === "ACTIVE" ? "success" : status === "COMPLETED" ? "info" : "neutral";
  return (
    <StatusBadge label={t(`accounting.lifecycleStatus.${status}` as MessageKey)} tone={tone} />
  );
}

const columns: ColumnDef<PrepaidExpenseRow, unknown>[] = [
  textColumn("prepaidNumber", "accounting.prepaid.fields.prepaidNumber", (r) => r.prepaidNumber),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("amount", "masterData.expenses.fields.amount", (r) =>
    Number(r.amount).toLocaleString(),
  ),
  textColumn("startDate", "accounting.prepaid.fields.startDate", (r) => formatDate(r.startDate)),
  textColumn("endDate", "accounting.prepaid.fields.endDate", (r) => formatDate(r.endDate)),
  textColumn("totalPeriods", "accounting.prepaid.fields.totalPeriods", (r) =>
    String(r.totalPeriods),
  ),
  textColumn("recognizedAmount", "accounting.prepaid.fields.recognizedAmount", (r) =>
    Number(r.recognizedAmount ?? 0).toLocaleString(),
  ),
  {
    id: "status",
    accessorFn: (row) => row.status,
    meta: { titleKey: "accounting.prepaid.fields.status" },
    cell: ({ row }) => <PrepaidStatusCell status={row.original.status} />,
  },
];

function PrepaidExpensesPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [receivingAccounts, setReceivingAccounts] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [tableKey, setTableKey] = useState(0);
  const [activateTarget, setActivateTarget] = useState<PrepaidExpenseRow | null>(null);
  const [recognizeOpen, setRecognizeOpen] = useState(false);
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
        name: "startDate",
        label: "accounting.prepaid.fields.startDate",
        type: "date",
        required: true,
      },
      { name: "endDate", label: "accounting.prepaid.fields.endDate", type: "date", required: true },
      {
        name: "totalPeriods",
        label: "accounting.prepaid.fields.totalPeriods",
        type: "number",
        required: true,
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
          label: `${account.code} — ${account.name}`,
        })),
      },
      { name: "notes", label: "masterData.fields.notes", type: "textarea" },
    ],
    [receivingAccounts],
  );

  const reload = () => setTableKey((value) => value + 1);

  const handleActivate = async () => {
    if (!activateTarget) return;
    setBusy(true);
    try {
      await prepaidExpensesService.activate(activateTarget.id);
      toast.success(t("accounting.prepaid.toasts.activated"));
      setActivateTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const handleRecognize = async () => {
    setBusy(true);
    try {
      const result = await prepaidExpensesService.recognize({});
      toast.success(t("accounting.prepaid.toasts.recognized", { count: result.postedCount }));
      setRecognizeOpen(false);
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
        extraActions={
          hasPermission("prepaid-expenses.edit") ? (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setRecognizeOpen(true)}
            >
              {t("accounting.prepaid.recognize")}
            </EnterpriseButton>
          ) : undefined
        }
        extraRowActions={(entity): RowAction[] => [
          {
            key: "activate",
            label: t("accounting.prepaid.activate"),
            icon: Play,
            hidden: entity.status !== "DRAFT" || Boolean(entity.deletedAt),
            onSelect: () => setActivateTarget(entity),
          },
        ]}
      />
      <ConfirmationDialog
        open={Boolean(activateTarget)}
        onOpenChange={(open) => {
          if (!open) setActivateTarget(null);
        }}
        title={t("accounting.prepaid.activate")}
        confirmLabel={t("accounting.prepaid.activate")}
        isConfirming={busy}
        onConfirm={() => void handleActivate()}
      />
      <ConfirmationDialog
        open={recognizeOpen}
        onOpenChange={setRecognizeOpen}
        title={t("accounting.prepaid.recognize")}
        confirmLabel={t("accounting.prepaid.recognize")}
        isConfirming={busy}
        onConfirm={() => void handleRecognize()}
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
