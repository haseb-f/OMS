"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  departmentsColumns,
  departmentsFormFields,
  departmentsSchema,
  departmentsDefaultValues,
  departmentsExportColumns,
  departmentRowLabel,
  type DepartmentRow,
} from "@/config/master-data/entities";
import { useDepartments } from "@/hooks/use-reference-data";

const service = createMasterDataService<DepartmentRow>("/departments");

export default function DepartmentsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.departments.title"
      descriptionKey="masterData.departments.description"
      tableId="departments"
      service={service}
      columns={departmentsColumns}
      exportColumnKeys={departmentsExportColumns}
      formFields={departmentsFormFields}
      schema={departmentsSchema}
      defaultValues={departmentsDefaultValues}
      permissionPrefix="masterdata.departments"
      rowLabel={departmentRowLabel}
      defaultSortBy="sortOrder"
      onRecordsChanged={() => useDepartments.invalidate()}
    />
  );
}
