import { ForbiddenException } from '@nestjs/common';
import { PartnerRoleType } from '@prisma/client';

/**
 * SEC-01 — GET /partners/catalog is the read-only picker every document
 * screen embeds. It is reachable WITHOUT `partners.view`, so it must never
 * become a side door into the full Partner directory. Each permission that
 * unlocks it declares:
 *
 * - `roles`: which Partner roles the screen behind that permission actually
 *   picks (a Product form picks a Supplier, never a Customer). The caller's
 *   allowed set is the union over every permission they hold.
 * - `detail`: whether that screen genuinely reads contact / address /
 *   profile / balance fields from the catalog row (e.g. the Store Order
 *   create dialog copies phone+address; the Sales document editor shows the
 *   customer's receivable balance, credit limit and payment term). Every
 *   other screen only renders id/number/name, so it gets the picker
 *   projection.
 *
 * Derived from the web screens (grep `partnersService.catalog` /
 * `<PartnerPicker role=…>`): keep this map in step with them.
 */
export type PartnerCatalogRoles = readonly PartnerRoleType[] | 'ANY';

export interface PartnerCatalogGrant {
  roles: PartnerCatalogRoles;
  detail: boolean;
}

const CUSTOMER: PartnerCatalogRoles = [PartnerRoleType.CUSTOMER];
const SUPPLIER: PartnerCatalogRoles = [PartnerRoleType.SUPPLIER];

export const PARTNER_CATALOG_SCOPES: Readonly<
  Record<string, PartnerCatalogGrant>
> = {
  // Full Partner directory management — existing semantics.
  'partners.view': { roles: 'ANY', detail: true },

  // Lead conversion creates the customer server-side; no screen under this
  // grant reads a catalog row beyond the picker fields.
  'crm.leads.convert': { roles: CUSTOMER, detail: false },
  // Store Order create dialog copies phone/mobile/email/country/city/address
  // from the picked customer into the order form.
  'store-orders.create': { roles: CUSTOMER, detail: true },
  // No store-order edit screen reads the catalog (the order's own partner
  // relation carries the contact data there).
  'store-orders.edit': { roles: CUSTOMER, detail: false },
  // Sales document editor sidebar: receivable balance, credit limit, payment term.
  'sales.quotations.create': { roles: CUSTOMER, detail: true },
  'sales.orders.create': { roles: CUSTOMER, detail: true },
  'sales.invoices.create': { roles: CUSTOMER, detail: true },
  'sales.returns.create': { roles: CUSTOMER, detail: true },
  // Purchasing document editor renders the supplier name only.
  'purchasing.quotations.create': { roles: SUPPLIER, detail: false },
  'purchasing.orders.create': { roles: SUPPLIER, detail: false },
  'purchasing.invoices.create': { roles: SUPPLIER, detail: false },
  'purchasing.returns.create': { roles: SUPPLIER, detail: false },
  // Journal Entry lines pick any counterparty (role-less search).
  'accounting.journal-entries.create': { roles: 'ANY', detail: false },
  'accounting.journal-entries.edit': { roles: 'ANY', detail: false },
  // Money-movement editors (Customer Receipt / Refund, Supplier Payment).
  'sales.receipts.create': { roles: CUSTOMER, detail: false },
  'sales.receipts.edit': { roles: CUSTOMER, detail: false },
  'sales.refunds.create': { roles: CUSTOMER, detail: false },
  'sales.refunds.edit': { roles: CUSTOMER, detail: false },
  'purchasing.payments.create': { roles: SUPPLIER, detail: false },
  'purchasing.payments.edit': { roles: SUPPLIER, detail: false },
  // Customer Statement + Supplier Statement report tabs.
  'reports.financial.view': {
    roles: [PartnerRoleType.CUSTOMER, PartnerRoleType.SUPPLIER],
    detail: false,
  },
  // Bank Transaction "classify as Supplier Payment" dialog.
  'accounting.bank-transactions.manage': { roles: SUPPLIER, detail: false },
  // Landed Cost provider: any partner may bill it (carrier, customs broker,
  // supplier…) — the server does not restrict the provider's role either.
  'landed-cost.create': { roles: 'ANY', detail: false },
  'landed-cost.edit': { roles: 'ANY', detail: false },
  // Fixed Asset form's Supplier dropdown.
  'masterdata.fixed-assets.create': { roles: SUPPLIER, detail: false },
  'masterdata.fixed-assets.edit': { roles: SUPPLIER, detail: false },
  // Product form's Preferred Supplier picker.
  'products.create': { roles: SUPPLIER, detail: false },
  'products.edit': { roles: SUPPLIER, detail: false },
};

/** Any-of: holding one of these unlocks the catalog (at the scope above). */
export const PARTNER_CATALOG_READ_PERMISSIONS: readonly string[] = Object.keys(
  PARTNER_CATALOG_SCOPES,
);

type RoleSet = ReadonlySet<PartnerRoleType> | 'ANY';

export interface PartnerCatalogScope {
  /** Roles the caller may list at all. */
  roles: RoleSet;
  /** Roles whose rows the caller may see with contact/profile/balance detail. */
  detailRoles: RoleSet;
}

function addRoles(
  target: Set<PartnerRoleType> | 'ANY',
  roles: PartnerCatalogRoles,
): Set<PartnerRoleType> | 'ANY' {
  if (target === 'ANY' || roles === 'ANY') return 'ANY';
  roles.forEach((role) => target.add(role));
  return target;
}

/**
 * The caller's effective catalog scope, or `null` when no held permission
 * unlocks the catalog at all. Super Admin sees everything with detail.
 */
export function resolvePartnerCatalogScope(
  isSuperAdmin: boolean,
  grants: ReadonlySet<string>,
): PartnerCatalogScope | null {
  if (isSuperAdmin) return { roles: 'ANY', detailRoles: 'ANY' };
  let roles: Set<PartnerRoleType> | 'ANY' = new Set();
  let detailRoles: Set<PartnerRoleType> | 'ANY' = new Set();
  let unlocked = false;
  for (const [permission, grant] of Object.entries(PARTNER_CATALOG_SCOPES)) {
    if (!grants.has(permission)) continue;
    unlocked = true;
    roles = addRoles(roles, grant.roles);
    if (grant.detail) detailRoles = addRoles(detailRoles, grant.roles);
  }
  return unlocked ? { roles, detailRoles } : null;
}

/**
 * The role filter the query must run with. A requested role outside the
 * caller's scope is a 403 (never a silently empty list); no requested role
 * means "everything I'm allowed" — so `ids=` lookups obey the same scope.
 * `undefined` = unrestricted.
 */
export function effectiveCatalogRoleFilter(
  requested: readonly PartnerRoleType[] | undefined,
  scope: PartnerCatalogScope,
): PartnerRoleType[] | undefined {
  if (scope.roles === 'ANY')
    return requested?.length ? [...requested] : undefined;
  const allowed = scope.roles;
  if (requested?.length) {
    const denied = requested.filter((role) => !allowed.has(role));
    if (denied.length) {
      throw new ForbiddenException(
        `Your permissions do not allow browsing ${denied.join(', ')} partners.`,
      );
    }
    return [...requested];
  }
  return [...allowed];
}

/** Catalog `sortBy` allowlist — identity columns only (never a contact/balance ordering oracle). */
export const CATALOG_SORTABLE_FIELDS: readonly string[] = [
  'name',
  'partnerNumber',
  'commercialName',
  'createdAt',
];

/** Picker fields only — what every picker renders (and nothing that identifies how to contact the partner or what they owe). */
export interface PartnerPickerRow {
  id: string;
  partnerNumber: string;
  name: string;
  commercialName: string | null;
  status: string;
  roles: { id: string; role: PartnerRoleType; createdAt: Date }[];
  currencyId: string | null;
  currency: { id: string; code: string; name: string } | null;
}

/**
 * CUSTOMER detail block — exactly the fields the detail-authorized customer
 * screens read from a catalog row (grep'd, SEC-03):
 * - Store Order create dialog (`applyCustomer`): phone, mobile, email,
 *   countryId, city, address.
 * - Sales document editor sidebar: receivableBalance,
 *   customerProfile.creditLimit, customerProfile.paymentTerm.name.
 * Never tax number, notes, legal/registration data, other roles' profiles,
 * or the payable balance.
 */
export interface PartnerCustomerDetail {
  phone: string | null;
  mobile: string | null;
  email: string | null;
  countryId: string | null;
  city: string | null;
  address: string | null;
  customerProfile: {
    id: string;
    paymentTermId: string | null;
    paymentTerm: {
      id: string;
      code: string;
      name: string;
      days: number | null;
    } | null;
    creditLimit: unknown;
  } | null;
  receivableBalance: number;
}

export type PartnerCatalogRow = PartnerPickerRow &
  Partial<PartnerCustomerDetail>;

export interface CatalogSourceRow {
  id: string;
  partnerNumber: string;
  name: string;
  commercialName: string | null;
  status: string;
  roles: { id: string; role: PartnerRoleType; createdAt: Date }[];
  currencyId: string | null;
  currency: { id: string; code: string; name: string } | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  countryId?: string | null;
  city?: string | null;
  address?: string | null;
  customerProfile?: {
    id: string;
    paymentTermId?: string | null;
    paymentTerm?: {
      id: string;
      code: string;
      name: string;
      days?: number | null;
    } | null;
    creditLimit?: unknown;
  } | null;
  receivableBalance?: number;
}

/**
 * Contact columns (phone/mobile/email) may be searched only when the caller
 * has detail rights for every role the query can return — otherwise a match
 * would confirm who owns a phone/email the caller is not allowed to see.
 */
export function canSearchContacts(
  role: readonly PartnerRoleType[] | undefined,
  scope: PartnerCatalogScope,
): boolean {
  if (scope.detailRoles === 'ANY') return true;
  const detail = scope.detailRoles;
  if (!role) return false;
  return role.length > 0 && role.every((r) => detail.has(r));
}

function inRoleSet(set: RoleSet, role: PartnerRoleType): boolean {
  return set === 'ANY' || set.has(role);
}

export function toPartnerPickerRow(
  row: CatalogSourceRow,
  visibleRoles: RoleSet = 'ANY',
): PartnerPickerRow {
  return {
    id: row.id,
    partnerNumber: row.partnerNumber,
    name: row.name,
    commercialName: row.commercialName,
    status: row.status,
    roles: row.roles
      .filter(({ role }) => inRoleSet(visibleRoles, role))
      .map(({ id, role, createdAt }) => ({ id, role, createdAt })),
    currencyId: row.currencyId,
    currency: row.currency
      ? {
          id: row.currency.id,
          code: row.currency.code,
          name: row.currency.name,
        }
      : null,
  };
}

function customerDetail(row: CatalogSourceRow): PartnerCustomerDetail {
  const profile = row.customerProfile;
  const term = profile?.paymentTerm;
  return {
    phone: row.phone ?? null,
    mobile: row.mobile ?? null,
    email: row.email ?? null,
    countryId: row.countryId ?? null,
    city: row.city ?? null,
    address: row.address ?? null,
    customerProfile: profile
      ? {
          id: profile.id,
          paymentTermId: profile.paymentTermId ?? null,
          paymentTerm: term
            ? {
                id: term.id,
                code: term.code,
                name: term.name,
                days: term.days ?? null,
              }
            : null,
          creditLimit: profile.creditLimit ?? null,
        }
      : null,
    receivableBalance: row.receivableBalance ?? 0,
  };
}

/**
 * The catalog row the caller may see — always an EXPLICIT projection, never
 * the service row (SEC-03 H1): picker fields, `roles` narrowed to the
 * caller's scope (L4), plus a per-role detail block only when that role is
 * both on the row AND detail-authorized for the caller. Only CUSTOMER has a
 * detail block today; no detail-authorized screen reads supplier/employee/
 * investor fields from the catalog, so those roles add nothing — full
 * records stay behind `GET /partners/:id` (`partners.view`).
 */
export function projectCatalogRow(
  row: CatalogSourceRow,
  scope: PartnerCatalogScope,
): PartnerCatalogRow {
  const picker = toPartnerPickerRow(row, scope.roles);
  const hasRole = (role: PartnerRoleType) =>
    row.roles.some((assignment) => assignment.role === role);
  if (
    hasRole(PartnerRoleType.CUSTOMER) &&
    inRoleSet(scope.roles, PartnerRoleType.CUSTOMER) &&
    inRoleSet(scope.detailRoles, PartnerRoleType.CUSTOMER)
  ) {
    return { ...picker, ...customerDetail(row) };
  }
  return picker;
}
