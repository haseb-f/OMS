import { apiClient } from "./api-client";
import { createMasterDataService, type MasterDataActivityEntry } from "./master-data-service";

export type SupplierStatusValue = "ACTIVE" | "INACTIVE";

export interface SupplierRow {
  id: string;
  supplierNumber: string;
  code: string;
  name: string;
  commercialName: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  taxNumber: string | null;
  commercialRegistration: string | null;
  currencyId: string | null;
  currency: { id: string; code: string; name: string } | null;
  supplierGroupId: string | null;
  supplierGroup: { id: string; code: string; name: string } | null;
  /** Selected from Payment Terms master data; persisted as the term name. */
  paymentTerm: string | null;
  creditLimit: string | null;
  countryId: string | null;
  country: { id: string; code: string; name: string } | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  status: SupplierStatusValue;
  isPreferred: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface SupplierFormPayload {
  code?: string;
  name: string;
  commercialName?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  taxNumber?: string;
  commercialRegistration?: string;
  currencyId?: string;
  supplierGroupId?: string;
  paymentTerm?: string;
  creditLimit?: number;
  countryId?: string;
  city?: string;
  address?: string;
  notes?: string;
  status?: SupplierStatusValue;
  isPreferred?: boolean;
}

interface SupplierActivityRow {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
}

/**
 * The one Supplier API client every Purchasing document and the Supplier
 * module itself calls through — mirrors `customersService` (TASK-048).
 * `/suppliers` follows the same `{items,total,page,pageSize}` shape as
 * every other paginated list, and now has a real `restore` (TASK-048, so
 * `MasterDataPage`'s built-in un-archive button works) alongside its own
 * `activate` (ADR-0015 — resets Status to Active, distinct from Restore's
 * "clear deletedAt"). The activity route is plural
 * (`/suppliers/:id/activities`, from Suppliers' own dedicated
 * `SupplierActivity` table, ADR-0015) and lacks `entityType`/`entityId`
 * (unlike the shared Master Data activity log), so it's adapted here to
 * satisfy `MasterDataActivityEntry`'s shape for `MasterDataPage` reuse.
 */
export const suppliersService = {
  // Single type param, same as `customersService` — `create`/`update` stay
  // structurally compatible with `MasterDataPage`'s loosely-typed
  // `Record<string, unknown>` form values.
  ...createMasterDataService<SupplierRow>("/suppliers"),
  activity: async (id: string): Promise<MasterDataActivityEntry[]> => {
    const rows = await apiClient.get<SupplierActivityRow[]>(`/suppliers/${id}/activities`);
    return rows.map((row) => ({
      id: row.id,
      entityType: "SUPPLIER",
      entityId: id,
      type: row.type,
      description: row.description,
      metadata: row.metadata,
      createdAt: row.createdAt,
      createdBy: null,
    }));
  },
  activate: (id: string) => apiClient.post<SupplierRow>(`/suppliers/${id}/activate`),
  /** Reuses an existing Supplier by phone/email if one matches, otherwise creates a new one — never duplicates. */
  findOrCreate: (dto: SupplierFormPayload) =>
    apiClient.post<{ supplier: SupplierRow; created: boolean }>("/suppliers/find-or-create", dto),
};
