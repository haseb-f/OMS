import { describe, expect, it } from "vitest";
import {
  createProductCommissionSchema,
  isValidCommissionRate,
  toProductCommissionInput,
  commissionDraftInput,
  commissionDraftInvalid,
} from "./product-commission-form";

const schema = createProductCommissionSchema((key) => key);

describe("product commission form", () => {
  it("accepts 0% as an explicit override rate", () => {
    expect(isValidCommissionRate(0)).toBe(true);
    expect(
      schema.safeParse({ source: "OVERRIDE", ratePercent: 0, effectiveFrom: "2026-09-29" }).success,
    ).toBe(true);
  });

  it("requires a 0–100 rate with at most 4 decimals for an override", () => {
    expect(isValidCommissionRate(12.3456)).toBe(true);
    expect(isValidCommissionRate(12.34567)).toBe(false);
    expect(isValidCommissionRate(100.01)).toBe(false);
    expect(isValidCommissionRate(-1)).toBe(false);
    expect(isValidCommissionRate(undefined)).toBe(false);
    const result = schema.safeParse({ source: "OVERRIDE", effectiveFrom: "2026-09-29" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["ratePercent"]);
  });

  it("does not require a rate to inherit the agreement", () => {
    expect(schema.safeParse({ source: "INHERIT", effectiveFrom: "2026-09-29" }).success).toBe(true);
    expect(schema.safeParse({ source: "INHERIT", effectiveFrom: "" }).success).toBe(false);
  });

  it("sends the rate only for an override (0 kept) and drops a blank reason", () => {
    expect(
      toProductCommissionInput({
        source: "OVERRIDE",
        ratePercent: 0,
        effectiveFrom: "2026-10-01",
        reason: "  ",
      }),
    ).toEqual({ source: "OVERRIDE", ratePercent: 0, effectiveFrom: "2026-10-01" });
    expect(
      toProductCommissionInput({
        source: "INHERIT",
        ratePercent: 20,
        effectiveFrom: "2026-10-01",
        reason: " back to agreement ",
      }),
    ).toEqual({ source: "INHERIT", effectiveFrom: "2026-10-01", reason: "back to agreement" });
  });
});

describe("commission draft saved with a new agent product (spec 2A)", () => {
  it("inherits without a request and sends an override effective today (0% included)", () => {
    expect(commissionDraftInput({ source: "INHERIT", rate: "" }, "2026-09-30")).toBeNull();
    expect(commissionDraftInput({ source: "OVERRIDE", rate: "0" }, "2026-09-30")).toEqual({
      source: "OVERRIDE",
      ratePercent: 0,
      effectiveFrom: "2026-09-30",
    });
  });

  it("refuses an override without a valid rate", () => {
    expect(commissionDraftInvalid({ source: "OVERRIDE", rate: "" })).toBe(true);
    expect(commissionDraftInvalid({ source: "OVERRIDE", rate: "120" })).toBe(true);
    expect(commissionDraftInvalid({ source: "OVERRIDE", rate: "12.5" })).toBe(false);
    expect(commissionDraftInvalid({ source: "INHERIT", rate: "" })).toBe(false);
  });
});
