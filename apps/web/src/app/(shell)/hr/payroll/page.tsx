"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import {
  MasterDataForm,
  type MasterDataFormField,
} from "@/components/master-data/master-data-form";
import { buildPayrollRunsColumns } from "@/config/hr/payroll";
import { payrollService, type PayrollRunRow } from "@/services/payroll-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const createRunSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "YYYY-MM" }),
});
type CreateRunValues = z.infer<typeof createRunSchema>;

export default function PayrollRunsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("hr.payroll.create");

  const [rows, setRows] = useState<PayrollRunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await payrollService.list());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildPayrollRunsColumns(t), [t]);

  const form = useForm<CreateRunValues>({
    resolver: zodResolver(createRunSchema),
    defaultValues: { period: "" },
  });

  useEffect(() => {
    if (!createOpen) return;
    form.reset({ period: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen]);

  const formFields: MasterDataFormField[] = [
    {
      name: "period",
      label: "hr.payroll.fields.period",
      type: "text",
      required: true,
      placeholder: "YYYY-MM",
    },
  ];

  const save = form.handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      const run = await payrollService.createRun(values.period);
      toast.success(t("hr.payroll.toasts.created"));
      setCreateOpen(false);
      router.push(`/hr/payroll/${run.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  });

  const exportKeys = columns.map((column) => column.id!);
  const toExportRow = (row: PayrollRunRow) =>
    Object.fromEntries(columns.map((column) => [column.id!, getColumnDisplayValue(column, row)]));

  return (
    <PageWorkspace
      title={t("hr.payroll.title")}
      description={t("hr.payroll.description")}
      actions={
        canCreate && (
          <EnterpriseButton type="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("hr.payroll.createNew")}
          </EnterpriseButton>
        )
      }
    >
      <EnterpriseDataTable
        tableId="payroll-runs"
        printTitle={t("hr.payroll.title")}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/hr/payroll/${row.id}`}
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) => exportRowsToCsv(rows.map(toExportRow), keys, "payroll-runs.csv")}
      />

      <EnterpriseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        size="md"
        title={t("hr.payroll.createNew")}
        description={t("hr.payroll.title")}
        isDirty={form.formState.isDirty}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={() => void save()} disabled={isSaving}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <MasterDataForm
          form={form}
          fields={formFields}
          sectionTitle={t("hr.payroll.title")}
          columns={2}
        />
      </EnterpriseModal>
    </PageWorkspace>
  );
}
