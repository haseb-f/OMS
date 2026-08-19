"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  projectsColumns,
  projectsFormFields,
  projectsSchema,
  projectsDefaultValues,
  projectsExportColumns,
  projectRowLabel,
  type ProjectRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<ProjectRow>("/projects");

export default function ProjectsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.projects.title"
      descriptionKey="masterData.projects.description"
      tableId="projects"
      service={service}
      columns={projectsColumns}
      exportColumnKeys={projectsExportColumns}
      formFields={projectsFormFields}
      schema={projectsSchema}
      defaultValues={projectsDefaultValues}
      permissionPrefix="masterdata.projects"
      rowLabel={projectRowLabel}
    />
  );
}
