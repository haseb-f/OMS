import { apiClient } from "./api-client";

export interface PermissionActionDef {
  action: string;
  name: string;
}

export interface PermissionModuleDef {
  key: string;
  labelKey: string;
  actions: PermissionActionDef[];
}

/** TASK-060 — the Permission Matrix's entire data source, generated server-side from the single-source-of-truth catalog (`permission-catalog.ts`). */
export const permissionsService = {
  getCatalog: () => apiClient.get<PermissionModuleDef[]>("/permissions/catalog"),
};
