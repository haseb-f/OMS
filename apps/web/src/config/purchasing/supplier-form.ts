import { z } from "zod";

/**
 * Enterprise-grade validation — mirrors `config/sales/customer-form.ts`.
 * `code` stays optional at the field level: `SuppliersService.create`
 * defaults it to the minted `supplierNumber` when omitted (TASK-048), so
 * Quick Create never has to ask for one (UX Policy: never require a
 * manually-typed code).
 */
export const supplierSchema = z.object({
  code: z.string().optional().or(z.literal("")),
  name: z.string().min(1),
  commercialName: z.string().optional().or(z.literal("")),
  phone: z
    .string()
    .regex(/^[0-9+()\-\s]{6,20}$/, { message: "Enter a valid phone number." })
    .optional()
    .or(z.literal("")),
  mobile: z
    .string()
    .regex(/^[0-9+()\-\s]{6,20}$/, { message: "Enter a valid mobile number." })
    .optional()
    .or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().optional().or(z.literal("")),
  taxNumber: z.string().optional().or(z.literal("")),
  commercialRegistration: z.string().optional().or(z.literal("")),
  currencyId: z.string().optional().or(z.literal("")),
  paymentTerm: z.string().optional().or(z.literal("")),
  creditLimit: z.number().min(0).optional().nullable(),
  countryId: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  isPreferred: z.boolean().optional(),
});

export const supplierDefaultValues = {
  code: "",
  name: "",
  commercialName: "",
  phone: "",
  mobile: "",
  email: "",
  website: "",
  taxNumber: "",
  commercialRegistration: "",
  currencyId: "",
  paymentTerm: "",
  creditLimit: null,
  countryId: "",
  city: "",
  address: "",
  notes: "",
  isPreferred: false,
};

/** Quick Create keeps only what a buyer needs to not lose the purchase mid-document. */
export const supplierQuickCreateSchema = z.object({
  name: z.string().min(1),
  phone: z
    .string()
    .regex(/^[0-9+()\-\s]{6,20}$/, { message: "Enter a valid phone number." })
    .optional()
    .or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
});

export const supplierQuickCreateDefaultValues = {
  name: "",
  phone: "",
  email: "",
};
