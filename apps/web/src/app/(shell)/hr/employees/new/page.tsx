"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard } from "@/components/ui/card";
import {
  MasterDataForm,
  type MasterDataFormField,
} from "@/components/master-data/master-data-form";
import {
  CompensationLinesEditor,
  type CompensationLineDraft,
} from "@/components/hr/compensation-lines-editor";
import { employeesService } from "@/services/employees-service";
import { HR_ROLE_PRESET_KEYS } from "@/config/hr/role-presets";
import {
  useDepartments,
  useJobTitles,
  useSalesTeams,
  useEmployees,
} from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { cn } from "@/lib/utils";

const wizardSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  hireDate: z.string().optional().or(z.literal("")),
  departmentId: z.string().optional().or(z.literal("")),
  jobTitleId: z.string().optional().or(z.literal("")),
  salesTeamId: z.string().optional().or(z.literal("")),
  managerEmployeeId: z.string().optional().or(z.literal("")),
  compEffectiveFrom: z.string().optional().or(z.literal("")),
  compBasicSalary: z.number().optional(),
  compKpiMaxPay: z.number().optional(),
  compNotes: z.string().optional().or(z.literal("")),
  createLoginAccount: z.boolean().optional(),
  loginEmail: z.string().optional().or(z.literal("")),
  role: z.string().optional().or(z.literal("")),
  username: z.string().optional().or(z.literal("")),
});

type WizardValues = z.infer<typeof wizardSchema>;

const STEP_KEYS = ["basic", "work", "compensation", "account"] as const;
const STEP_FIELDS: Record<(typeof STEP_KEYS)[number], (keyof WizardValues)[]> = {
  basic: ["name", "mobile", "email", "hireDate"],
  work: ["departmentId", "jobTitleId", "salesTeamId", "managerEmployeeId"],
  compensation: ["compEffectiveFrom", "compBasicSalary", "compKpiMaxPay", "compNotes"],
  account: ["createLoginAccount", "loginEmail", "role", "username"],
};

export default function NewEmployeePage() {
  const { t } = useLocale();
  const router = useRouter();
  const departments = useDepartments();
  const jobTitles = useJobTitles();
  const salesTeams = useSalesTeams();
  const employees = useEmployees();

  const [stepIndex, setStepIndex] = useState(0);
  const [lines, setLines] = useState<CompensationLineDraft[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<WizardValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      name: "",
      mobile: "",
      email: "",
      hireDate: "",
      departmentId: "",
      jobTitleId: "",
      salesTeamId: "",
      managerEmployeeId: "",
      compEffectiveFrom: "",
      compBasicSalary: undefined,
      compKpiMaxPay: undefined,
      compNotes: "",
      createLoginAccount: false,
      loginEmail: "",
      role: "",
      username: "",
    },
  });

  const createLoginAccount = form.watch("createLoginAccount");

  const stepFieldsConfig: Record<(typeof STEP_KEYS)[number], MasterDataFormField[]> = useMemo(
    () => ({
      basic: [
        { name: "name", label: "hr.employees.fields.name", type: "text", required: true },
        { name: "mobile", label: "hr.employees.fields.mobile", type: "text" },
        { name: "email", label: "hr.employees.fields.email", type: "text" },
        { name: "hireDate", label: "hr.employees.fields.hireDate", type: "date" },
      ],
      work: [
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
          options: employees.map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.name}` })),
        },
      ],
      compensation: [
        { name: "compEffectiveFrom", label: "hr.compensation.fields.effectiveFrom", type: "date" },
        { name: "compBasicSalary", label: "hr.compensation.fields.basicSalary", type: "number" },
        { name: "compKpiMaxPay", label: "hr.compensation.fields.kpiMaxPay", type: "number" },
        { name: "compNotes", label: "hr.compensation.fields.notes", type: "textarea" },
      ],
      account: [
        {
          name: "createLoginAccount",
          label: "hr.employees.wizard.createLoginAccount",
          type: "boolean",
        },
        ...(createLoginAccount
          ? ([
              {
                name: "loginEmail",
                label: "hr.employees.wizard.loginEmail",
                type: "text",
                required: true,
              },
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
            ] as MasterDataFormField[])
          : []),
      ],
    }),
    [departments, jobTitles, salesTeams, employees, createLoginAccount, t],
  );

  const step = STEP_KEYS[stepIndex];
  const isLastStep = stepIndex === STEP_KEYS.length - 1;

  const goNext = async () => {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (!valid) return;
    if (step === "compensation") {
      const basicSalary = form.getValues("compBasicSalary");
      if (basicSalary && !form.getValues("compEffectiveFrom")) {
        form.setError("compEffectiveFrom", { message: t("hr.employees.errors.enterSalary") });
        return;
      }
    }
    setStepIndex((i) => Math.min(i + 1, STEP_KEYS.length - 1));
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const hasCompensation = !!values.compBasicSalary && !!values.compEffectiveFrom;
      const payload = {
        name: values.name,
        mobile: values.mobile || undefined,
        email: values.email || undefined,
        hireDate: values.hireDate || undefined,
        departmentId: values.departmentId || undefined,
        jobTitleId: values.jobTitleId || undefined,
        salesTeamId: values.salesTeamId || undefined,
        managerEmployeeId: values.managerEmployeeId || undefined,
        compensation: hasCompensation
          ? {
              effectiveFrom: values.compEffectiveFrom!,
              basicSalary: values.compBasicSalary!,
              kpiMaxPay: values.compKpiMaxPay || undefined,
              notes: values.compNotes || undefined,
              lines: lines
                .filter((line) => line.payrollComponentId && line.amount !== undefined)
                .map((line) => ({
                  payrollComponentId: line.payrollComponentId,
                  amount: line.amount!,
                })),
            }
          : undefined,
        createLoginAccount: values.createLoginAccount || undefined,
        account: values.createLoginAccount
          ? {
              loginEmail: values.loginEmail!,
              role: values.role!,
              username: values.username || undefined,
            }
          : undefined,
      };
      const employee = await employeesService.create(payload);
      toast.success(t("hr.employees.toasts.created"));
      router.push(`/hr/employees/${employee.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <PageWorkspace title={t("hr.employees.wizard.title")}>
      <EnterpriseCard className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
        <div className="flex items-center gap-2">
          {STEP_KEYS.map((key, index) => (
            <div key={key} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-medium",
                  index < stepIndex
                    ? "bg-primary text-primary-foreground"
                    : index === stepIndex
                      ? "border border-primary text-primary"
                      : "border border-border text-muted-foreground",
                )}
              >
                {index < stepIndex ? <Check className="size-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  "text-caption",
                  index === stepIndex ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`hr.employees.wizard.steps.${key}`)}
              </span>
              {index < STEP_KEYS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        <MasterDataForm form={form} fields={stepFieldsConfig[step]} sectionTitle="" columns={2} />

        {step === "compensation" && (
          <div className="flex flex-col gap-2">
            <p className="text-caption text-muted-foreground">
              {t("hr.employees.wizard.skipCompensation")}
            </p>
            <CompensationLinesEditor lines={lines} onChange={setLines} />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={stepIndex === 0}
          >
            {t("hr.employees.wizard.back")}
          </EnterpriseButton>
          {isLastStep ? (
            <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSubmitting}>
              {t("hr.employees.wizard.finish")}
            </EnterpriseButton>
          ) : (
            <EnterpriseButton type="button" onClick={() => void goNext()}>
              {t("hr.employees.wizard.next")}
            </EnterpriseButton>
          )}
        </div>
      </EnterpriseCard>
    </PageWorkspace>
  );
}
