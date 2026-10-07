"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  jobTitlesColumns,
  jobTitlesSchema,
  jobTitlesDefaultValues,
  jobTitlesExportColumns,
  jobTitleRowLabel,
  type JobTitleRow,
} from "@/config/master-data/job-titles";
import { useDepartments, useJobTitles } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { JobTitlePermissionsModal } from "@/components/settings/job-title-permissions-modal";

const service = createMasterDataService<JobTitleRow>("/job-titles");

export default function JobTitlesPage() {
  const { t } = useLocale();
  const departments = useDepartments();
  const { hasPermission } = useUserContext();
  // R14 W2 — "الصلاحيات الافتراضية" (job-title permission template).
  const [permissionsTarget, setPermissionsTarget] = useState<JobTitleRow | null>(null);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      { name: "name", label: "masterData.fields.name", type: "text", required: true },
      { name: "nameEn", label: "masterData.fields.nameEn", type: "text" },
      {
        name: "departmentId",
        label: "masterData.jobTitles.department",
        type: "select",
        placeholder: t("masterData.jobTitles.noDepartment"),
        options: departments.map((d) => ({ value: d.id, label: d.name })),
      },
      { name: "sortOrder", label: "masterData.fields.sortOrder", type: "number" },
      { name: "isActive", label: "masterData.fields.isActive", type: "boolean" },
      { name: "description", label: "masterData.fields.description", type: "textarea" },
    ],
    [departments, t],
  );

  return (
    <>
      <MasterDataPage
        onRecordsChanged={() => useJobTitles.invalidate()}
        titleKey="masterData.jobTitles.title"
        descriptionKey="masterData.jobTitles.description"
        tableId="job-titles"
        service={service}
        columns={jobTitlesColumns}
        exportColumnKeys={jobTitlesExportColumns}
        formFields={formFields}
        schema={jobTitlesSchema}
        defaultValues={jobTitlesDefaultValues}
        permissionPrefix="masterdata.job-titles"
        rowLabel={jobTitleRowLabel}
        defaultSortBy="sortOrder"
        extraRowActions={(row) => [
          {
            key: "default-permissions",
            label: t("permissionTemplates.jobTitle.action"),
            icon: ShieldCheck,
            hidden: !hasPermission("masterdata.job-titles.view") || Boolean(row.deletedAt),
            onSelect: () => setPermissionsTarget(row),
          },
        ]}
      />
      <JobTitlePermissionsModal
        jobTitle={permissionsTarget}
        onOpenChange={(open) => {
          if (!open) setPermissionsTarget(null);
        }}
      />
    </>
  );
}
