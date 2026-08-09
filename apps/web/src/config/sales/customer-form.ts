import { z } from "zod";

/**
 * Enterprise-grade validation: name required; phone/email get real format
 * checks when supplied (both stay optional at the field level — the
 * "prevent duplicate by phone/email" rule is enforced server-side, since
 * only the backend can see every other customer); credit limit non-negative.
 */
export const customerSchema = z.object({
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
  customerGroupId: z.string().optional().or(z.literal("")),
  currencyId: z.string().optional().or(z.literal("")),
  paymentTermId: z.string().optional().or(z.literal("")),
  creditLimit: z.number().min(0).optional().nullable(),
  countryId: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const customerDefaultValues = {
  name: "",
  commercialName: "",
  phone: "",
  mobile: "",
  email: "",
  website: "",
  taxNumber: "",
  commercialRegistration: "",
  customerGroupId: "",
  currencyId: "",
  paymentTermId: "",
  creditLimit: null,
  countryId: "",
  city: "",
  address: "",
  notes: "",
};

/** Quick Create keeps only what a sales rep needs to not lose the sale mid-document. */
export const customerQuickCreateSchema = z.object({
  name: z.string().min(1),
  phone: z
    .string()
    .regex(/^[0-9+()\-\s]{6,20}$/, { message: "Enter a valid phone number." })
    .optional()
    .or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
});

export const customerQuickCreateDefaultValues = {
  name: "",
  phone: "",
  email: "",
};
