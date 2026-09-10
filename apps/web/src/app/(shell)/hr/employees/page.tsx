"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { EnterpriseButton } from "@/components/ui/button";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  employeesService,
  type EmployeeRow,
  type UpdateEmployeePayload,
} from "@/services/employees-service";
import {
  buildEmployeesColumns,
  employeesExportColumns,
  employeeRowLabel,
  employeeUpdateSchema,
  employeeUpdateDefaultValues,
} from "@/config/hr/employees";
import {
  useDepartments,
  useJobTitles,
  useSalesTeams,
  useEmployees,
} from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/** Adapts `employeesService`'s narrowly-typed DTOs to `MasterDataPage`'s generic `Record<string, unknown>` service shape — only `update` is ever reached here since `hideCreateButton` routes creation to the wizard instead. */
const listService = {
  ...employeesService,
  create: (dto: Record<string, unknown>) =>
    employeesService.create(dto as unknown as Parameters<typeof employeesService.create>[0]),
  update: (id: string, dto: Record<string, unknown>) =>
    employeesService.update(id, dto as UpdateEmployeePayload),
};

export default function EmployeesPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const departments = useDepartments();
  const jobTitles = useJobTitles();
  const salesTeams = useSalesTeams();
  const employees = useEmployees();

  const columns = useMemo(() => buildEmployeesColumns(t), [t]);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
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
        options: employees.map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.name}` })),
      },
    ],
    [departments, jobTitles, salesTeams, employees, t],
  );

  return (
    <MasterDataPage<EmployeeRow>
      titleKey="hr.employees.title"
      descriptionKey="hr.employees.description"
      tableId="hr-employees"
      service={listService}
      columns={columns}
      exportColumnKeys={employeesExportColumns}
      formFields={formFields}
      schema={employeeUpdateSchema}
      defaultValues={employeeUpdateDefaultValues}
      permissionPrefix="hr.employees"
      rowLabel={employeeRowLabel}
      defaultSortBy="createdAt"
      defaultSortOrder="desc"
      hideCreateButton
      getRowHref={(row) => `/hr/employees/${row.id}`}
      extraActions={
        hasPermission("hr.employees.create") ? (
          <EnterpriseButton type="button" onClick={() => router.push("/hr/employees/new")}>
            <Plus />
            {t("hr.employees.addNew")}
          </EnterpriseButton>
        ) : undefined
      }
    />
  );
}
