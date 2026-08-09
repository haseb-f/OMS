import { apiClient } from "./api-client";
import { createMasterDataService } from "./master-data-service";
import type { WarehouseLocationRow } from "@/config/master-data/entities";

/**
 * Warehouses Locations — the generic Master Data CRUD factory plus one
 * extra read: the full, unpaginated set for one warehouse, which the
 * Locations tree page assembles into parent/child client-side.
 */
export const warehouseLocationsService = {
  ...createMasterDataService<WarehouseLocationRow>("/warehouse-locations"),
  listByWarehouse: (warehouseId: string) =>
    apiClient.get<WarehouseLocationRow[]>(`/warehouse-locations/by-warehouse/${warehouseId}`),
};
