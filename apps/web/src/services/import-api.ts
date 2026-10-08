import {
  createImportJobsService,
  importJobsService,
  type ImportJobsApi,
} from "./import-jobs-service";
import {
  createImportMappingTemplatesService,
  importMappingTemplatesService,
  type ImportMappingTemplatesApi,
} from "./import-mapping-templates-service";
import {
  createImportTypesService,
  importTypesService,
  type ImportTypeDefinition,
  type ImportTypesApi,
} from "./import-types-service";

/**
 * R15 (D15-16) — one import endpoint family: company users go through the
 * Import Center, agent users through the agent portal. Both reach the same
 * server workspace (type permission, own jobs, manual-entry rules), so the
 * one import wizard takes the family as a prop instead of a second wizard.
 */
export interface ImportApi {
  /** Who the endpoints serve — also the client cache key of the type list. */
  scope: "company" | "agent";
  jobs: ImportJobsApi;
  templates: ImportMappingTemplatesApi;
  types: ImportTypesApi;
}

export const COMPANY_IMPORT_API: ImportApi = {
  scope: "company",
  jobs: importJobsService,
  templates: importMappingTemplatesService,
  types: importTypesService,
};

const AGENT_IMPORTS_BASE = "/agent-portal/imports";

export const AGENT_IMPORT_API: ImportApi = {
  scope: "agent",
  jobs: createImportJobsService(`${AGENT_IMPORTS_BASE}/jobs`),
  templates: createImportMappingTemplatesService(`${AGENT_IMPORTS_BASE}/jobs`),
  types: createImportTypesService(AGENT_IMPORTS_BASE),
};

/**
 * The template of a type: the sales template (Leads / Store Orders — only the
 * user's columns, headers in `lang`, a sample row) or the full administrator
 * template. Returns the file to save.
 */
export async function fetchImportTemplate(
  api: ImportApi,
  typeDef: ImportTypeDefinition,
  lang: "ar" | "en",
): Promise<{ blob: Blob; fileName: string }> {
  const baseName = typeDef.type.toLowerCase().replace(/_/g, "-");
  if (typeDef.salesFields?.length) {
    return {
      blob: await api.types.downloadSalesTemplate(typeDef.type, lang),
      fileName: `${baseName}-import-${lang}.xlsx`,
    };
  }
  return {
    blob: await importTypesService.downloadTemplate(typeDef.type),
    fileName: `${baseName}-import-template.xlsx`,
  };
}
