import { z } from "zod";
import { isPhoneValidForCountry, phoneErrorMessage } from "@/components/shared/phone-input";
import { parsePhone } from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * Unified Partner Architecture — one schema for every Partner form (the
 * Customers/Suppliers role-scoped pages and the full Partners master page).
 * `customerProfile`/`supplierProfile` stay optional at the schema level:
 * PartnersService only persists the profile for a role actually present in
 * `roles`, so submitting both blocks unconditionally (simplest form UX,
 * spec section 13) is always safe.
 */
export function buildPartnerSchema(
  countries: { id: string; code: string }[],
  t: (key: MessageKey) => string,
) {
  return z
    .object({
      name: z.string().min(1),
      legalName: z.string().optional().or(z.literal("")),
      commercialName: z.string().optional().or(z.literal("")),
      entityType: z.enum(["PERSON", "ORGANIZATION"]).optional(),
      phone: z.string().optional().or(z.literal("")),
      mobile: z.string().optional().or(z.literal("")),
      email: z.string().email().optional().or(z.literal("")),
      website: z.string().optional().or(z.literal("")),
      taxNumber: z.string().optional().or(z.literal("")),
      commercialRegistration: z.string().optional().or(z.literal("")),
      currencyId: z.string().optional().or(z.literal("")),
      countryId: z.string().optional().or(z.literal("")),
      city: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      notes: z.string().optional().or(z.literal("")),
      customerProfile: z
        .object({
          customerGroupId: z.string().optional().or(z.literal("")),
          paymentTermId: z.string().optional().or(z.literal("")),
          creditLimit: z.number().min(0).optional().nullable(),
        })
        .optional(),
      supplierProfile: z
        .object({
          supplierGroupId: z.string().optional().or(z.literal("")),
          paymentTerm: z.string().optional().or(z.literal("")),
          creditLimit: z.number().min(0).optional().nullable(),
          isPreferred: z.boolean().optional(),
        })
        .optional(),
      employeeProfile: z
        .object({
          jobTitleId: z.string().optional().or(z.literal("")),
        })
        .optional(),
      isCustomerRole: z.boolean().optional(),
      isSupplierRole: z.boolean().optional(),
      isEmployeeRole: z.boolean().optional(),
      isOwnerRole: z.boolean().optional(),
    })
    .superRefine((values, ctx) => {
      const countryCode = countries.find((c) => c.id === values.countryId)?.code;
      for (const field of ["phone", "mobile"] as const) {
        const value = values[field];
        if (!value) continue;
        if (!isPhoneValidForCountry(value, countryCode)) {
          const reason = parsePhone(value, countryCode).errorReason;
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: phoneErrorMessage(reason, countryCode, t),
          });
        }
      }
    });
}

export const partnerDefaultValues = {
  name: "",
  legalName: "",
  commercialName: "",
  entityType: "ORGANIZATION",
  phone: "",
  mobile: "",
  email: "",
  website: "",
  taxNumber: "",
  commercialRegistration: "",
  currencyId: "",
  countryId: "",
  city: "",
  address: "",
  notes: "",
  customerProfile: { customerGroupId: "", paymentTermId: "", creditLimit: null },
  supplierProfile: { supplierGroupId: "", paymentTerm: "", creditLimit: null, isPreferred: false },
  employeeProfile: { jobTitleId: "" },
  isCustomerRole: false,
  isSupplierRole: false,
  isEmployeeRole: false,
  isOwnerRole: false,
};

/** Role-scoped pages (Customers/Suppliers) pre-check their one role and hide the Roles section entirely — see `config/partners/partner-columns.tsx` callers. */
export function partnerDefaultValuesForRole(role: "CUSTOMER" | "SUPPLIER") {
  return {
    ...partnerDefaultValues,
    isCustomerRole: role === "CUSTOMER",
    isSupplierRole: role === "SUPPLIER",
  };
}

/** Quick Create keeps only what a rep needs to not lose the sale/purchase mid-document — no Country field, so phone validation stays international-format-only. */
export function buildPartnerQuickCreateSchema(t: (key: MessageKey) => string) {
  return z
    .object({
      name: z.string().min(1),
      phone: z.string().optional().or(z.literal("")),
      email: z.string().email().optional().or(z.literal("")),
    })
    .superRefine((values, ctx) => {
      if (values.phone && !isPhoneValidForCountry(values.phone, undefined)) {
        const reason = parsePhone(values.phone, undefined).errorReason;
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: phoneErrorMessage(reason, undefined, t),
        });
      }
    });
}

export const partnerQuickCreateDefaultValues = {
  name: "",
  phone: "",
  email: "",
};

/**
 * Translates the master Partners page's role checkboxes
 * (`isCustomerRole`/`isSupplierRole`/`isEmployeeRole`/`isOwnerRole`) into the
 * `roles` array `PartnersService.create`/`update` expects, and drops a
 * role's profile block when that role isn't checked (PartnersService only
 * ever persists the profile for a role actually present in `roles`, so
 * sending an unrelated profile object is harmless, but stripping it keeps
 * the payload honest).
 */
export function toPartnerPayload(values: Record<string, unknown>): Record<string, unknown> {
  const roles: string[] = [];
  if (values.isCustomerRole) roles.push("CUSTOMER");
  if (values.isSupplierRole) roles.push("SUPPLIER");
  if (values.isEmployeeRole) roles.push("EMPLOYEE");
  if (values.isOwnerRole) roles.push("OWNER");

  const {
    isCustomerRole: _isCustomerRole,
    isSupplierRole: _isSupplierRole,
    isEmployeeRole: _isEmployeeRole,
    isOwnerRole: _isOwnerRole,
    customerProfile,
    supplierProfile,
    employeeProfile,
    ...rest
  } = values;
  void _isCustomerRole;
  void _isSupplierRole;
  void _isEmployeeRole;
  void _isOwnerRole;

  return {
    ...rest,
    roles,
    ...(roles.includes("CUSTOMER") ? { customerProfile } : {}),
    ...(roles.includes("SUPPLIER") ? { supplierProfile } : {}),
    ...(roles.includes("EMPLOYEE") ? { employeeProfile } : {}),
  };
}
