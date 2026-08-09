import { apiClient } from "./api-client";
import { createMasterDataService } from "./master-data-service";

export type CustomerSourceValue =
  "MANUAL" | "WEBSITE" | "SALLA" | "API" | "IMPORT" | "GOOGLE_SHEETS" | "LEAD_CONVERSION" | "OTHER";

export type CustomerStatusValue = "ACTIVE" | "INACTIVE";

export interface CustomerRow {
  id: string;
  customerNumber: string;
  name: string;
  commercialName: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  taxNumber: string | null;
  commercialRegistration: string | null;
  customerGroupId: string | null;
  customerGroup: { id: string; code: string; name: string } | null;
  currencyId: string | null;
  paymentTermId: string | null;
  paymentTerm: { id: string; code: string; name: string; days: number | null } | null;
  creditLimit: string | null;
  countryId: string | null;
  country: { id: string; code: string; name: string } | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  status: CustomerStatusValue;
  source: CustomerSourceValue;
  /** Confirmed/closed Sales Invoices minus confirmed/closed Sales Returns — receivables only, not yet net of Payments. */
  balance: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface CustomerFormPayload {
  name: string;
  commercialName?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  taxNumber?: string;
  commercialRegistration?: string;
  customerGroupId?: string;
  currencyId?: string;
  paymentTermId?: string;
  creditLimit?: number;
  countryId?: string;
  city?: string;
  address?: string;
  notes?: string;
  status?: CustomerStatusValue;
  source?: CustomerSourceValue;
}

/**
 * The one Customer API client every Sales document and the Customer module
 * itself calls through. `createMasterDataService` covers list/get/create/
 * update/archive/restore/activity — Customer's `/customers` routes were
 * built to match that exact shape (TASK-038), so no adapter is needed here,
 * only the two Customer-specific business operations layered on top.
 */
export const customersService = {
  // Single type param — `create`/`update` stay structurally compatible with
  // `MasterDataPage`'s loosely-typed `Record<string, unknown>` form values,
  // same as every other entity's `createMasterDataService<Entity>(...)` call.
  ...createMasterDataService<CustomerRow>("/customers"),
  /** Reuses an existing Customer by phone/email if one matches, otherwise creates a new one — never duplicates. Strictly typed, unlike `create` above, since callers (the Picker's Quick Create, Lead conversion) always know the full payload up front. */
  findOrCreate: (dto: CustomerFormPayload) =>
    apiClient.post<{ customer: CustomerRow; created: boolean }>("/customers/find-or-create", dto),
};
