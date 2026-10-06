import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";
import type { InvestmentBlockedReason } from "./attribute-rules";

/**
 * Business error codes of the R13 product / recipe API (api-contract.md §1–§2)
 * mapped onto localized messages. Pure (no React) and unit-tested. The server
 * stays the authority; these only turn its `code` into a clear sentence in the
 * UI language — the server's own bilingual message is kept as a detail where it
 * names a product (a cycle path, the offending component).
 */

/** The `code` of an API failure — the business code the server sent, if any. */
export function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const code = error.body?.code;
  return typeof code === "string" ? code : error.code;
}

export const RECIPE_ERROR_KEYS = {
  RECIPE_PRODUCT_NOT_ASSEMBLABLE: "products.recipe.errors.RECIPE_PRODUCT_NOT_ASSEMBLABLE",
  RECIPE_EMPTY: "products.recipe.errors.RECIPE_EMPTY",
  RECIPE_CYCLE: "products.recipe.errors.RECIPE_CYCLE",
  RECIPE_COMPONENT_NOT_STOCKED: "products.recipe.errors.RECIPE_COMPONENT_NOT_STOCKED",
  RECIPE_NESTED_KIT: "products.recipe.errors.RECIPE_NESTED_KIT",
  RECIPE_OWNER_MIXED: "products.recipe.errors.RECIPE_OWNER_MIXED",
  RECIPE_UNIT_CONVERSION_MISSING: "products.recipe.errors.RECIPE_UNIT_CONVERSION_MISSING",
  RECIPE_KIT_FRACTIONAL: "products.recipe.errors.RECIPE_KIT_FRACTIONAL",
  RECIPE_KIT_OUTPUT: "products.recipe.errors.RECIPE_KIT_OUTPUT",
} as const satisfies Record<string, MessageKey>;

export type RecipeErrorCode = keyof typeof RECIPE_ERROR_KEYS;

/** Codes whose server message names the product / path involved — shown after the localized sentence. */
const RECIPE_DETAIL_CODES: ReadonlySet<string> = new Set<RecipeErrorCode>([
  "RECIPE_CYCLE",
  "RECIPE_COMPONENT_NOT_STOCKED",
  "RECIPE_NESTED_KIT",
  "RECIPE_OWNER_MIXED",
  "RECIPE_UNIT_CONVERSION_MISSING",
  "RECIPE_KIT_FRACTIONAL",
]);

export function isRecipeErrorCode(code: string | undefined): code is RecipeErrorCode {
  return code !== undefined && code in RECIPE_ERROR_KEYS;
}

/** The localized sentence for a recipe error, or null when the failure is not a known recipe code. */
export function recipeErrorMessage(
  error: unknown,
  translate: (key: MessageKey) => string,
): string | null {
  const code = apiErrorCode(error);
  if (!isRecipeErrorCode(code)) return null;
  const base = translate(RECIPE_ERROR_KEYS[code]);
  if (!RECIPE_DETAIL_CODES.has(code) || !(error instanceof ApiError)) return base;
  const detail = error.message.trim();
  return detail && detail !== base ? `${base} ${detail}` : base;
}

export const PRODUCT_RULE_KEYS = {
  PRODUCT_SERVICE_RULE: "products.rules.PRODUCT_SERVICE_RULE",
  PRODUCT_KIT_NOT_STOCKED: "products.rules.PRODUCT_KIT_NOT_STOCKED",
  PRODUCT_ASSEMBLED_NOT_STOCKED: "products.rules.PRODUCT_ASSEMBLED_NOT_STOCKED",
  PRODUCT_SUPPLY_METHOD_LOCKED: "products.rules.PRODUCT_SUPPLY_METHOD_LOCKED",
  PRODUCT_TRACKING_LOCKED: "products.rules.PRODUCT_TRACKING_LOCKED",
  PRODUCT_OWNER_LOCKED: "products.rules.PRODUCT_OWNER_LOCKED",
} as const satisfies Record<string, MessageKey>;

export const INVESTMENT_REASON_KEYS = {
  AGENT_OWNED: "products.investment.reasons.AGENT_OWNED",
  SERVICE: "products.investment.reasons.SERVICE",
  NOT_SELLABLE: "products.investment.reasons.NOT_SELLABLE",
  NOT_ACTIVE: "products.investment.reasons.NOT_ACTIVE",
} as const satisfies Record<InvestmentBlockedReason, MessageKey>;

/** The localized sentence for a product attribute-rule failure, or null when it is not one. */
export function productRuleMessage(
  error: unknown,
  translate: (key: MessageKey) => string,
): string | null {
  const code = apiErrorCode(error);
  if (code === "PRODUCT_INVESTMENT_NOT_ALLOWED") {
    const reason = investmentReasonFromError(error);
    return reason ? translate(INVESTMENT_REASON_KEYS[reason]) : null;
  }
  if (code && code in PRODUCT_RULE_KEYS) {
    return translate(PRODUCT_RULE_KEYS[code as keyof typeof PRODUCT_RULE_KEYS]);
  }
  return null;
}

/** `reason` of a 422 `PRODUCT_INVESTMENT_NOT_ALLOWED`. */
export function investmentReasonFromError(error: unknown): InvestmentBlockedReason | null {
  if (!(error instanceof ApiError)) return null;
  const reason = error.body?.reason;
  return typeof reason === "string" && reason in INVESTMENT_REASON_KEYS
    ? (reason as InvestmentBlockedReason)
    : null;
}

export interface BarcodeDuplicate {
  productId: string;
  sku: string;
  name: string;
}

/** The product that already holds a barcode (409 `PRODUCT_BARCODE_DUPLICATE`), or null. */
export function barcodeDuplicateFromError(error: unknown): BarcodeDuplicate | null {
  if (apiErrorCode(error) !== "PRODUCT_BARCODE_DUPLICATE" || !(error instanceof ApiError)) {
    return null;
  }
  const { productId, sku, name } = error.body ?? {};
  if (typeof sku !== "string" || typeof name !== "string") return null;
  return { productId: typeof productId === "string" ? productId : "", sku, name };
}
