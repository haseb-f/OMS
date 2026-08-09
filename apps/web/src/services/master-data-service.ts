import { apiClient } from "./api-client";

export interface MasterDataListResult<TEntity> {
  items: TEntity[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MasterDataListParams {
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  includeArchived?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface MasterDataActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

function buildQueryString(params: MasterDataListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * One factory behind every Master Data entity's API calls (Companies,
 * Branches, Warehouses, ...) — each entity page calls
 * `createMasterDataService<Entity>("/warehouses")` instead of hand-writing
 * list/get/create/update/archive/restore/activity six times over.
 */
export function createMasterDataService<
  TEntity,
  TCreateDto = Partial<TEntity>,
  TUpdateDto = Partial<TEntity>,
>(basePath: string) {
  return {
    list: (params: MasterDataListParams = {}) =>
      apiClient.get<MasterDataListResult<TEntity>>(`${basePath}${buildQueryString(params)}`),
    get: (id: string) => apiClient.get<TEntity>(`${basePath}/${id}`),
    create: (dto: TCreateDto) => apiClient.post<TEntity>(basePath, dto),
    update: (id: string, dto: TUpdateDto) => apiClient.patch<TEntity>(`${basePath}/${id}`, dto),
    archive: (id: string) => apiClient.post<TEntity>(`${basePath}/${id}/archive`),
    restore: (id: string) => apiClient.post<TEntity>(`${basePath}/${id}/restore`),
    activity: (id: string) =>
      apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
  };
}
