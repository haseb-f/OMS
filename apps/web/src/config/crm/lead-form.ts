import { z } from "zod";

/**
 * Manual Leads/Orders entry (TASK-061). Customer Master matching/linking,
 * duplicate-order detection, and Auto Assignment all run server-side in
 * `LeadsService.create()` — this schema only validates shape, never
 * duplicates that logic.
 */
export const leadSchema = z.object({
  customerName: z.string().min(1),
  mobileNumber: z
    .string()
    .min(6)
    .regex(/^[0-9+()\-\s]{6,20}$/, { message: "Enter a valid phone number." }),
  countryId: z.string().min(1, { message: "Country is required." }),
  city: z.string().min(1),
  address: z.string().min(1),
  quantity: z.number().min(1),
  currencyId: z.string().min(1, { message: "Currency is required." }),
  externalOrderId: z.string().optional().or(z.literal("")),
  salesEmployeeId: z.string().optional().or(z.literal("")),
  /** Not a form field — always MANUAL for this dialog (import sets EXCEL itself, server-side). */
  source: z.literal("MANUAL"),
});

export const leadDefaultValues = {
  customerName: "",
  mobileNumber: "",
  countryId: "",
  city: "",
  address: "",
  quantity: 1,
  currencyId: "",
  externalOrderId: "",
  salesEmployeeId: "",
  source: "MANUAL" as const,
};
