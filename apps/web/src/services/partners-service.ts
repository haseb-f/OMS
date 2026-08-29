import { apiClient } from "./api-client";
import { createMasterDataService, type MasterDataActivityEntry } from "./master-data-service";

export type PartnerRoleValue = "CUSTOMER" | "SUPPLIER" | "EMPLOYEE" | "OWNER" | "OTHER";
export type PartnerEntityTypeValue = "PERSON" | "ORGANIZATION";
export type PartnerStatusValue = "ACTIVE" | "INACTIVE";
export type PartnerSourceValue =
  "MANUAL" | "WEBSITE" | "SALLA" | "API" | "IMPORT" | "GOOGLE_SHEETS" | "LEAD_CONVERSION" | "OTHER";

export interface PartnerRoleAssignmentRow {
  id: string;
  role: PartnerRoleValue;
  createdAt: string;
}

export interface CustomerProfileRow {
  id: string;
  customerGroupId: string | null;
  customerGroup: { id: string; code: string; name: string } | null;
  paymentTermId: string | null;
  paymentTerm: { id: string; code: string; name: string; days: number | null } | null;
  creditLimit: string | null;
  defaultReceivableAccountId: string | null;
}

export interface SupplierProfileRow {
  id: string;
  supplierGroupId: string | null;
  supplierGroup: { id: string; code: string; name: string } | null;
  /** No closed set of values — free-text, selected from the Payment Terms master list. */
  paymentTerm: string | null;
  creditLimit: string | null;
  isPreferred: boolean;
  defaultPayableAccountId: string | null;
  defaultExpenseAccountId: string | null;
}

export interface EmployeeProfileRow {
  id: string;
  userId: string | null;
  jobTitleId: string | null;
  jobTitle: { id: string; name: string } | null;
}

/**
 * Unified Partner Architecture — the single canonical counterparty identity
 * (replaces `CustomerRow`/`SupplierRow`). Customers/Suppliers pages are
 * role-filtered views over this same registry (spec sections 9/10).
 */
export interface PartnerRow {
  id: string;
  partnerNumber: string;
  name: string;
  legalName: string | null;
  commercialName: string | null;
  entityType: PartnerEntityTypeValue;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  taxNumber: string | null;
  commercialRegistration: string | null;
  currencyId: string | null;
  currency: { id: string; code: string; name: string } | null;
  countryId: string | null;
  country: { id: string; code: string; name: string } | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  status: PartnerStatusValue;
  source: PartnerSourceValue;
  roles: PartnerRoleAssignmentRow[];
  customerProfile: CustomerProfileRow | null;
  supplierProfile: SupplierProfileRow | null;
  employeeProfile: EmployeeProfileRow | null;
  /** Confirmed/closed Sales Invoices minus confirmed/closed Sales Returns minus CONFIRMED Customer Receipt allocations — independent from `payableBalance`, never netted (spec sections 25/26). */
  receivableBalance: number;
  payableBalance: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface PartnerFormPayload {
  name: string;
  legalName?: string;
  commercialName?: string;
  entityType?: PartnerEntityTypeValue;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  taxNumber?: string;
  commercialRegistration?: string;
  currencyId?: string;
  countryId?: string;
  city?: string;
  address?: string;
  notes?: string;
  status?: PartnerStatusValue;
  source?: PartnerSourceValue;
  roles?: PartnerRoleValue[];
  customerProfile?: { customerGroupId?: string; paymentTermId?: string; creditLimit?: number };
  supplierProfile?: {
    supplierGroupId?: string;
    paymentTerm?: string;
    creditLimit?: number;
    isPreferred?: boolean;
  };
  employeeProfile?: { userId?: string; jobTitleId?: string };
}

const base = createMasterDataService<PartnerRow>("/partners");

/**
 * The one Partner API client every Sales/Purchasing document, the Partners
 * module, and the role-filtered Customers/Suppliers pages all call through
 * (replaces `customersService` + `suppliersService`).
 */
export const partnersService = {
  ...base,
  /** Reuses an existing Partner by phone/mobile/email/tax number if one matches and adds `role` if it doesn't already hold it; otherwise creates a new Partner with just that role. Never duplicates. */
  findOrCreateWithRole: (role: PartnerRoleValue, dto: PartnerFormPayload) =>
    apiClient.post<{ partner: PartnerRow; created: boolean }>("/partners/find-or-create", {
      ...dto,
      role,
    }),
  assignRole: (id: string, role: PartnerRoleValue) =>
    apiClient.post<PartnerRow>(`/partners/${id}/roles`, { role }),
  removeRole: (id: string, role: PartnerRoleValue) =>
    apiClient.delete<PartnerRow>(`/partners/${id}/roles/${role}`),
  activity: (id: string): Promise<MasterDataActivityEntry[]> =>
    apiClient.get<MasterDataActivityEntry[]>(`/partners/${id}/activity`),
};

/**
 * Role-scoped wrapper for `MasterDataPage` — Customers/Suppliers pages pass
 * this so `create()` always assigns the right role automatically, with no
 * role picker exposed to the user (spec section 9/10: "Creating a Customer
 * should: Create Partner + Assign CUSTOMER role").
 */
export function createRoleScopedPartnerService(role: PartnerRoleValue) {
  return {
    ...base,
    create: (dto: Record<string, unknown>) =>
      base.create({ ...dto, roles: [role] } as unknown as Partial<PartnerRow>),
  };
}
