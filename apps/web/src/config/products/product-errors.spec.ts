import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api-client";
import {
  RECIPE_ERROR_KEYS,
  apiErrorCode,
  barcodeDuplicateFromError,
  investmentReasonFromError,
  productRuleMessage,
  recipeErrorMessage,
  type RecipeErrorCode,
} from "./product-errors";

/** A business error as the API sends it: `{ code, message, ...extra }` on a 4xx. */
function apiError(status: number, body: Record<string, unknown>, message = "server text") {
  return new ApiError(
    status,
    message,
    body.code as never,
    undefined,
    undefined,
    body as Record<string, unknown>,
  );
}

const translate = (key: string) => `«${key}»`;

describe("recipe error mapping", () => {
  it("maps every documented RECIPE_* code to its own localized key", () => {
    const codes = Object.keys(RECIPE_ERROR_KEYS) as RecipeErrorCode[];
    expect(codes.sort()).toEqual(
      [
        "RECIPE_CYCLE",
        "RECIPE_EMPTY",
        "RECIPE_KIT_FRACTIONAL",
        "RECIPE_KIT_OUTPUT",
        "RECIPE_NESTED_KIT",
        "RECIPE_OWNER_MIXED",
        "RECIPE_COMPONENT_NOT_STOCKED",
        "RECIPE_PRODUCT_NOT_ASSEMBLABLE",
        "RECIPE_UNIT_CONVERSION_MISSING",
      ].sort(),
    );
    for (const code of codes) {
      const message = recipeErrorMessage(apiError(422, { code }, ""), translate);
      expect(message).toContain(RECIPE_ERROR_KEYS[code]);
    }
  });

  it("appends the server's detail (the path / component) only for codes that name one", () => {
    const cycle = recipeErrorMessage(
      apiError(422, { code: "RECIPE_CYCLE" }, "A → B → A"),
      translate,
    );
    expect(cycle).toBe("«products.recipe.errors.RECIPE_CYCLE» A → B → A");
    const empty = recipeErrorMessage(
      apiError(422, { code: "RECIPE_EMPTY" }, "no lines"),
      translate,
    );
    expect(empty).toBe("«products.recipe.errors.RECIPE_EMPTY»");
  });

  it("returns null for anything that is not a known recipe code", () => {
    expect(recipeErrorMessage(apiError(500, { code: "SERVER_ERROR" }), translate)).toBeNull();
    expect(recipeErrorMessage(new Error("boom"), translate)).toBeNull();
    expect(recipeErrorMessage(undefined, translate)).toBeNull();
  });

  it("reads the business code from the body, falling back to the envelope code", () => {
    expect(apiErrorCode(apiError(422, { code: "RECIPE_CYCLE" }))).toBe("RECIPE_CYCLE");
    expect(apiErrorCode(new ApiError(404, "x", "NOT_FOUND"))).toBe("NOT_FOUND");
    expect(apiErrorCode("nope")).toBeUndefined();
  });
});

describe("product rule mapping", () => {
  it("explains the hard attribute rules and the locked supply method", () => {
    expect(productRuleMessage(apiError(422, { code: "PRODUCT_KIT_NOT_STOCKED" }), translate)).toBe(
      "«products.rules.PRODUCT_KIT_NOT_STOCKED»",
    );
    expect(
      productRuleMessage(apiError(409, { code: "PRODUCT_SUPPLY_METHOD_LOCKED" }), translate),
    ).toBe("«products.rules.PRODUCT_SUPPLY_METHOD_LOCKED»");
    expect(productRuleMessage(apiError(409, { code: "PRODUCT_TRACKING_LOCKED" }), translate)).toBe(
      "«products.rules.PRODUCT_TRACKING_LOCKED»",
    );
    expect(productRuleMessage(apiError(400, { code: "VALIDATION_ERROR" }), translate)).toBeNull();
  });

  it("names the investor-eligibility reason from the 422 body, never silently dropping it", () => {
    const error = apiError(422, { code: "PRODUCT_INVESTMENT_NOT_ALLOWED", reason: "AGENT_OWNED" });
    expect(investmentReasonFromError(error)).toBe("AGENT_OWNED");
    expect(productRuleMessage(error, translate)).toBe("«products.investment.reasons.AGENT_OWNED»");
    expect(
      investmentReasonFromError(
        apiError(422, { code: "PRODUCT_INVESTMENT_NOT_ALLOWED", reason: "WHATEVER" }),
      ),
    ).toBeNull();
  });
});

describe("barcode duplicate", () => {
  it("returns the product that already holds the barcode", () => {
    const error = apiError(409, {
      code: "PRODUCT_BARCODE_DUPLICATE",
      productId: "p-1",
      sku: "PRD-000012",
      name: "قلم",
    });
    expect(barcodeDuplicateFromError(error)).toEqual({
      productId: "p-1",
      sku: "PRD-000012",
      name: "قلم",
    });
  });

  it("ignores other conflicts and malformed bodies", () => {
    expect(barcodeDuplicateFromError(apiError(409, { code: "DUPLICATE" }))).toBeNull();
    expect(
      barcodeDuplicateFromError(apiError(409, { code: "PRODUCT_BARCODE_DUPLICATE" })),
    ).toBeNull();
    expect(barcodeDuplicateFromError(new Error("x"))).toBeNull();
  });
});
