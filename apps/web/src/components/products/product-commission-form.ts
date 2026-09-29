import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import type {
  ProductCommissionSource,
  SetProductCommissionInput,
} from "@/services/product-commission-service";

/** Item commission setting form (commission-policy.md A4) — pure, unit-tested. */
export interface ProductCommissionFormValues {
  source: ProductCommissionSource;
  ratePercent?: number;
  effectiveFrom: string;
  reason?: string;
}

/** 0–100 with at most 4 decimals — the same bounds the API DTO enforces. 0 is valid. */
export function isValidCommissionRate(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < 0 || value > 100) return false;
  return Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-6;
}

export function createProductCommissionSchema(t: (key: MessageKey) => string) {
  return z
    .object({
      source: z.enum(["INHERIT", "OVERRIDE"]),
      ratePercent: z.number().optional(),
      effectiveFrom: z
        .string()
        .min(1, { message: t("productCommission.form.effectiveFromRequired") }),
      reason: z.string().max(500).optional(),
    })
    .superRefine((values, ctx) => {
      if (values.source === "OVERRIDE" && !isValidCommissionRate(values.ratePercent)) {
        ctx.addIssue({
          code: "custom",
          path: ["ratePercent"],
          message: t("productCommission.form.rateRequired"),
        });
      }
    });
}

/** Request body: the rate is sent only for an override (0 included); a blank reason is omitted. */
export function toProductCommissionInput(
  values: ProductCommissionFormValues,
): SetProductCommissionInput {
  const reason = values.reason?.trim();
  return {
    source: values.source,
    ...(values.source === "OVERRIDE" ? { ratePercent: values.ratePercent } : {}),
    effectiveFrom: values.effectiveFrom,
    ...(reason ? { reason } : {}),
  };
}
