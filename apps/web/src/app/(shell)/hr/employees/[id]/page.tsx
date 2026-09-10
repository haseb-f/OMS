"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Archive, FileText, Pencil, Plus, RotateCcw, UserPlus } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RowActionsMenu } from "@/components/shared/data-table";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import {
  MasterDataForm,
  type MasterDataFormField,
} from "@/components/master-data/master-data-form";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import {
  CompensationLinesEditor,
  type CompensationLineDraft,
} from "@/components/hr/compensation-lines-editor";
import {
  employeesService,
  type EmployeeRow,
  type CompensationRevisionRow,
} from "@/services/employees-service";
import type { MasterDataActivityEntry } from "@/services/master-data-service";
import {
  useDepartments,
  useJobTitles,
  useSalesTeams,
  useEmployees,
} from "@/hooks/use-reference-data";
import { HR_ROLE_PRESET_KEYS } from "@/config/hr/role-presets";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, formatDateTime } from "@/lib/date";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

const employeeEditSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  hireDate: z.string().optional().or(z.literal("")),
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "TERMINATED"]),
  departmentId: z.string().optional().or(z.literal("")),
  jobTitleId: z.string().optional().or(z.literal("")),
  salesTeamId: z.string().optional().or(z.literal("")),
  managerEmployeeId: z.string().optional().or(z.literal("")),
});
type EmployeeEditValues = z.infer<typeof employeeEditSchema>;

const compensationSchema = z.object({
  effectiveFrom: z.string().min(1),
  basicSalary: z.number().min(0),
  kpiMaxPay: z.number().optional(),
  notes: z.string().optional().or(z.literal("")),
});
type CompensationValues = z.infer<typeof compensationSchema>;

const accountSchema = z.object({
  loginEmail: z.string().email(),
  role: z.string().min(1),
  username: z.string().optional().or(z.literal("")),
});
type AccountValues = z.infer<typeof accountSchema>;

function formatMoney(value: string | number) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const departments = useDepartments();
  const jobTitles = useJobTitles();
  const salesTeams = useSalesTeams();
  const allEmployees = useEmployees();

  const canEdit = hasPermission("hr.employees.edit");
  const canArchive = hasPermission("hr.employees.archive");
  const canViewCompensation = hasPermission("hr.compensation.view");
  const canRecordCompensation = hasPermission("hr.compensation.create");

  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activity, setActivity] = useState<MasterDataActivityEntry[] | null>(null);
  const [compensationHistory, setCompensationHistory] = useState<CompensationRevisionRow[] | null>(
    null,
  );

  const [editOpen, setEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [compensationOpen, setCompensationOpen] = useState(false);
  const [compensationLines, setCompensationLines] = useState<CompensationLineDraft[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);

  useBreadcrumbLabel(employee?.name ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setEmployee(await employeesService.get(params.id));
    } catch {
      setEmployee(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    employeesService
      .activity(params.id)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [params.id]);

  useEffect(() => {
    if (!canViewCompensation) return;
    employeesService
      .compensationHistory(params.id)
      .then(setCompensationHistory)
      .catch(() => setCompensationHistory([]));
  }, [params.id, canViewCompensation, compensationOpen]);

  const editForm = useForm<EmployeeEditValues>({
    resolver: zodResolver(employeeEditSchema),
    defaultValues: {
      name: "",
      mobile: "",
      email: "",
      hireDate: "",
      employmentStatus: "ACTIVE",
      departmentId: "",
      jobTitleId: "",
      salesTeamId: "",
      managerEmployeeId: "",
    },
  });

  useEffect(() => {
    if (!editOpen || !employee) return;
    editForm.reset({
      name: employee.name,
      mobile: employee.mobile ?? "",
      email: employee.email ?? "",
      hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "",
      employmentStatus: employee.employmentStatus,
      departmentId: employee.department?.id ?? "",
      jobTitleId: employee.jobTitle?.id ?? "",
      salesTeamId: employee.salesTeam?.id ?? "",
      managerEmployeeId: employee.manager?.id ?? "",
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [editOpen, employee]);

  const compensationForm = useForm<CompensationValues>({
    resolver: zodResolver(compensationSchema),
    defaultValues: { effectiveFrom: "", basicSalary: 0, kpiMaxPay: 0, notes: "" },
  });

  useEffect(() => {
    if (!compensationOpen) return;
    compensationForm.reset({ effectiveFrom: "", basicSalary: 0, kpiMaxPay: 0, notes: "" });
    setCompensationLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compensationOpen]);

  const accountForm = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { loginEmail: "", role: "", username: "" },
  });

  useEffect(() => {
    if (!accountOpen || !employee) return;
    accountForm.reset({ loginEmail: employee.email ?? "", role: "", username: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountOpen, employee]);

  const editFields: MasterDataFormField[] = [
    { name: "name", label: "hr.employees.fields.name", type: "text", required: true },
    { name: "mobile", label: "hr.employees.fields.mobile", type: "text" },
    { name: "email", label: "hr.employees.fields.email", type: "text" },
    { name: "hireDate", label: "hr.employees.fields.hireDate", type: "date" },
    {
      name: "employmentStatus",
      label: "hr.employees.fields.employmentStatus",
      type: "select",
      options: (["ACTIVE", "INACTIVE", "TERMINATED"] as const).map((value) => ({
        value,
        label: t(`hr.employees.status.${value}`),
      })),
    },
    {
      name: "departmentId",
      label: "hr.employees.fields.department",
      type: "select",
      placeholder: t("hr.employees.fields.noDepartment"),
      options: departments.map((d) => ({ value: d.id, label: d.name })),
    },
    {
      name: "jobTitleId",
      label: "hr.employees.fields.jobTitle",
      type: "select",
      placeholder: t("hr.employees.fields.noJobTitle"),
      options: jobTitles.map((j) => ({ value: j.id, label: j.name })),
    },
    {
      name: "salesTeamId",
      label: "hr.employees.fields.salesTeam",
      type: "select",
      placeholder: t("hr.employees.fields.noSalesTeam"),
      options: salesTeams.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      name: "managerEmployeeId",
      label: "hr.employees.fields.manager",
      type: "select",
      placeholder: t("hr.employees.fields.noManager"),
      options: allEmployees
        .filter((e) => e.id !== employee?.id)
        .map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.name}` })),
    },
  ];

  const compensationFields: MasterDataFormField[] = [
    {
      name: "effectiveFrom",
      label: "hr.compensation.fields.effectiveFrom",
      type: "date",
      required: true,
    },
    {
      name: "basicSalary",
      label: "hr.compensation.fields.basicSalary",
      type: "number",
      required: true,
    },
    { name: "kpiMaxPay", label: "hr.compensation.fields.kpiMaxPay", type: "number" },
    { name: "notes", label: "hr.compensation.fields.notes", type: "textarea" },
  ];

  const accountFields: MasterDataFormField[] = [
    { name: "loginEmail", label: "hr.employees.wizard.loginEmail", type: "text", required: true },
    {
      name: "role",
      label: "hr.employees.wizard.role",
      type: "select",
      required: true,
      options: HR_ROLE_PRESET_KEYS.map((key) => ({
        value: key,
        label: t(`hr.employees.wizard.roles.${key}`),
      })),
    },
    { name: "username", label: "hr.employees.wizard.username", type: "text" },
  ];

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!employee) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const saveEdit = editForm.handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      await employeesService.update(employee.id, {
        name: values.name,
        mobile: values.mobile || undefined,
        email: values.email || undefined,
        hireDate: values.hireDate || undefined,
        employmentStatus: values.employmentStatus,
        departmentId: values.departmentId || undefined,
        jobTitleId: values.jobTitleId || undefined,
        salesTeamId: values.salesTeamId || undefined,
        managerEmployeeId: values.managerEmployeeId || undefined,
      });
      toast.success(t("hr.employees.toasts.updated"));
      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  });

  const saveCompensation = compensationForm.handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      await employeesService.recordCompensation(employee.id, {
        effectiveFrom: values.effectiveFrom,
        basicSalary: values.basicSalary,
        kpiMaxPay: values.kpiMaxPay || undefined,
        notes: values.notes || undefined,
        lines: compensationLines
          .filter((line) => line.payrollComponentId && line.amount !== undefined)
          .map((line) => ({ payrollComponentId: line.payrollComponentId, amount: line.amount! })),
      });
      toast.success(t("hr.employees.toasts.compensationSaved"));
      setCompensationOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  });

  const saveAccount = accountForm.handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      await employeesService.createAccount(employee.id, values);
      toast.success(t("hr.employees.toasts.accountCreated"));
      setAccountOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  });

  const confirmArchive = async () => {
    setIsMutating(true);
    try {
      await employeesService.archive(employee.id);
      toast.success(t("hr.employees.toasts.archived"));
      setArchiveOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmRestore = async () => {
    setIsMutating(true);
    try {
      await employeesService.restore(employee.id);
      toast.success(t("hr.employees.toasts.restored"));
      setRestoreOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const timelineEntries: TimelineEntry[] = (activity ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type.includes("ARCHIVED")
      ? "rejected"
      : entry.type.includes("CREATED")
        ? "done"
        : "pending",
  }));

  const currentRevision = compensationHistory?.[0] ?? null;

  return (
    <DetailWorkspace
      title={employee.name}
      subtitle={employee.employeeCode}
      status={
        <StatusBadge
          label={t(`hr.employees.status.${employee.employmentStatus}` as MessageKey)}
          tone={
            employee.employmentStatus === "ACTIVE"
              ? "success"
              : employee.employmentStatus === "TERMINATED"
                ? "destructive"
                : "neutral"
          }
        />
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !canEdit || !!employee.deletedAt,
              onSelect: () => setEditOpen(true),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !canArchive || !!employee.deletedAt,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setArchiveOpen(true),
            },
            {
              key: "restore",
              label: t("common.restore"),
              icon: RotateCcw,
              hidden: !canArchive || !employee.deletedAt,
              onSelect: () => setRestoreOpen(true),
            },
          ]}
        />
      }
    >
      <EntityTabs
        tabs={[
          {
            value: "general",
            label: t("hr.employees.profile.tabs.general"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField label={t("hr.employees.fields.mobile")} value={employee.mobile} />
                  <DetailField label={t("hr.employees.fields.email")} value={employee.email} />
                  <DetailField
                    label={t("hr.employees.fields.hireDate")}
                    value={
                      employee.hireDate ? (
                        <SemanticValue kind="date">{formatDate(employee.hireDate)}</SemanticValue>
                      ) : undefined
                    }
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "work",
            label: t("hr.employees.profile.tabs.work"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("hr.employees.fields.department")}
                    value={employee.department?.name}
                  />
                  <DetailField
                    label={t("hr.employees.fields.jobTitle")}
                    value={employee.jobTitle?.name}
                  />
                  <DetailField
                    label={t("hr.employees.fields.salesTeam")}
                    value={employee.salesTeam?.name}
                  />
                  <DetailField
                    label={t("hr.employees.fields.manager")}
                    value={
                      employee.manager
                        ? `${employee.manager.employeeCode} — ${employee.manager.name}`
                        : undefined
                    }
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          ...(canViewCompensation
            ? [
                {
                  value: "compensation",
                  label: t("hr.employees.profile.tabs.compensation"),
                  content: (
                    <DetailSection>
                      <div className="flex flex-col gap-4">
                        {canRecordCompensation && (
                          <EnterpriseButton
                            type="button"
                            size="sm"
                            className="self-start"
                            onClick={() => setCompensationOpen(true)}
                          >
                            <Plus />
                            {t("hr.employees.profile.addRevision")}
                          </EnterpriseButton>
                        )}
                        {currentRevision && (
                          <div>
                            <p className="mb-2 text-caption font-medium text-muted-foreground">
                              {t("hr.employees.profile.currentCompensation")}
                            </p>
                            <DetailFieldGrid>
                              <DetailField
                                label={t("hr.compensation.fields.basicSalary")}
                                value={formatMoney(currentRevision.basicSalary)}
                              />
                              <DetailField
                                label={t("hr.compensation.fields.kpiMaxPay")}
                                value={formatMoney(currentRevision.kpiMaxPay)}
                              />
                              <DetailField
                                label={t("hr.compensation.fields.effectiveFrom")}
                                value={formatDate(currentRevision.effectiveFrom)}
                              />
                            </DetailFieldGrid>
                            {currentRevision.lines.length > 0 && (
                              <div className="mt-3 flex flex-col gap-1.5">
                                {currentRevision.lines.map((line) => (
                                  <div
                                    key={line.id}
                                    className="flex items-center justify-between border-b border-border pb-1.5 text-body"
                                  >
                                    <span>{line.payrollComponent.nameAr}</span>
                                    <span className="font-medium">{formatMoney(line.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {!currentRevision && (
                          <p className="text-caption text-muted-foreground">
                            {t("hr.employees.profile.noCompensation")}
                          </p>
                        )}
                        {compensationHistory && compensationHistory.length > 1 && (
                          <div>
                            <p className="mb-2 text-caption font-medium text-muted-foreground">
                              {t("hr.employees.profile.compensationHistory")}
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {compensationHistory.slice(1).map((revision) => (
                                <div
                                  key={revision.id}
                                  className="flex items-center justify-between border-b border-border pb-1.5 text-body text-muted-foreground"
                                >
                                  <span>{formatDate(revision.effectiveFrom)}</span>
                                  <span>{formatMoney(revision.basicSalary)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </DetailSection>
                  ),
                },
              ]
            : []),
          {
            value: "account",
            label: t("hr.employees.profile.tabs.account"),
            content: (
              <DetailSection>
                {employee.userId ? (
                  <DetailFieldGrid>
                    <DetailField
                      label={t("hr.employees.profile.account.hasAccount")}
                      value={employee.userEmail}
                    />
                  </DetailFieldGrid>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-caption text-muted-foreground">
                      {t("hr.employees.profile.account.noAccount")}
                    </p>
                    {canEdit && (
                      <EnterpriseButton
                        type="button"
                        size="sm"
                        className="self-start"
                        onClick={() => setAccountOpen(true)}
                      >
                        <UserPlus />
                        {t("hr.employees.profile.account.createAccount")}
                      </EnterpriseButton>
                    )}
                  </div>
                )}
              </DetailSection>
            ),
          },
          {
            value: "activity",
            label: t("hr.employees.profile.tabs.activity"),
            content:
              activity === null ? (
                <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
              ) : timelineEntries.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
              ) : (
                <AuditTimeline entries={timelineEntries} />
              ),
          },
        ]}
      />

      <EnterpriseModal
        open={editOpen}
        onOpenChange={setEditOpen}
        size="lg"
        title={t("common.edit")}
        description={t("hr.employees.title")}
        isDirty={editForm.formState.isDirty}
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
            <EnterpriseButton type="button" onClick={() => void saveEdit()} disabled={isSaving}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <MasterDataForm
          form={editForm}
          fields={editFields}
          sectionTitle={t("common.generalInformation")}
        />
      </EnterpriseModal>

      <EnterpriseModal
        open={compensationOpen}
        onOpenChange={setCompensationOpen}
        size="lg"
        title={t("hr.employees.profile.addRevision")}
        description={t("hr.compensation.title")}
        isDirty={compensationForm.formState.isDirty}
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
            <EnterpriseButton
              type="button"
              onClick={() => void saveCompensation()}
              disabled={isSaving}
            >
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-4">
          <MasterDataForm
            form={compensationForm}
            fields={compensationFields}
            sectionTitle={t("hr.compensation.title")}
          />
          <div>
            <p className="mb-2 text-caption font-medium text-muted-foreground">
              {t("hr.compensation.fields.lines")}
            </p>
            <CompensationLinesEditor lines={compensationLines} onChange={setCompensationLines} />
          </div>
        </div>
      </EnterpriseModal>

      <EnterpriseModal
        open={accountOpen}
        onOpenChange={setAccountOpen}
        size="md"
        title={t("hr.employees.profile.account.createAccount")}
        description={employee.name}
        isDirty={accountForm.formState.isDirty}
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
            <EnterpriseButton type="button" onClick={() => void saveAccount()} disabled={isSaving}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <MasterDataForm
          form={accountForm}
          fields={accountFields}
          sectionTitle={t("hr.employees.profile.tabs.account")}
        />
      </EnterpriseModal>

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmArchive()}
      />
      <ConfirmationDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={t("common.confirmRestoreTitle")}
        description={t("common.confirmRestoreDescription")}
        confirmLabel={t("common.restore")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmRestore()}
      />
    </DetailWorkspace>
  );
}
