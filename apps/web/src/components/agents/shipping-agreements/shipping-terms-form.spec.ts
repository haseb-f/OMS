import { describe, expect, it } from "vitest";
import {
  EMPTY_TERMS_FORM,
  chargePreview,
  newExtraRate,
  termsFormFrom,
  termsInputFrom,
} from "./shipping-terms-form";
import type { ShippingAgreementDetail } from "./shipping-agreements-api";

describe("R17 §3 — compact shipping terms form", () => {
  it("live preview: prepaid 25; COD 25 + 10 = 35; INCLUDED 35 (never 45); prepaid never pays the fee", () => {
    expect(chargePreview("ANY", "25", "10", false)).toEqual({
      prepaid: 25,
      cod: 35,
      base: 25,
      fee: 10,
      included: false,
    });
    expect(chargePreview("COD_CARRIER", "35", "10", true)).toEqual({
      prepaid: null,
      cod: 35,
      base: 35,
      fee: 0,
      included: true,
    });
    expect(chargePreview("PREPAID_CARRIER", "20", "10", false)).toEqual({
      prepaid: 20,
      cod: null,
      base: 20,
      fee: 0,
      included: false,
    });
    expect(chargePreview("ANY", "", "10", false)).toBeNull();
    expect(chargePreview("ANY", "30", "12", false)?.cod).toBe(42);
  });

  it("form → API terms: default ANY row first, extras by service / destination, explicit COD fee mode", () => {
    const form = {
      ...EMPTY_TERMS_FORM,
      defaultAmount: "25",
      codCollectionFee: "10",
      extras: [
        { ...newExtraRate(), service: "COD_CARRIER" as const, amount: "35", includesCodFee: true },
        { ...newExtraRate(), countryId: "eg", city: " Cairo ", amount: "20" },
        // A prepaid row's choice never matters: always ADDED.
        {
          ...newExtraRate(),
          service: "PREPAID_CARRIER" as const,
          amount: "22",
          includesCodFee: true,
        },
      ],
    };
    expect(termsInputFrom(form, { requireDefault: true })).toEqual({
      errors: null,
      input: {
        codCollectionFee: 10,
        rates: [
          { service: "ANY", amount: 25, codFee: "ADDED" },
          { service: "COD_CARRIER", amount: 35, codFee: "INCLUDED" },
          { service: "ANY", countryId: "eg", city: "Cairo", amount: 20, codFee: "ADDED" },
          { service: "PREPAID_CARRIER", amount: 22, codFee: "ADDED" },
        ],
      },
    });
  });

  it("validation: default required for a new agreement, city needs its country, duplicates refused", () => {
    const missing = termsInputFrom(EMPTY_TERMS_FORM, { requireDefault: true });
    expect(missing.errors?.defaultAmount).toBe("defaultAmount");
    // An existing agreement without a default row stays valid.
    expect(termsInputFrom(EMPTY_TERMS_FORM, { requireDefault: false }).errors).toBeNull();
    const city = { ...newExtraRate(), city: "Cairo", amount: "5" };
    const dupA = { ...newExtraRate(), countryId: "eg", city: "Cairo", amount: "5" };
    const dupB = { ...newExtraRate(), countryId: "eg", city: "CAIRO ", amount: "6" };
    const result = termsInputFrom(
      { ...EMPTY_TERMS_FORM, defaultAmount: "25", extras: [city, dupA, dupB] },
      { requireDefault: true },
    );
    expect(result.errors?.extras).toEqual({
      [city.key]: "cityNeedsCountry",
      [dupB.key]: "duplicate",
    });
    expect(
      termsInputFrom(
        { ...EMPTY_TERMS_FORM, defaultAmount: "25", codCollectionFee: "-1" },
        {
          requireDefault: true,
        },
      ).errors?.codCollectionFee,
    ).toBe("codCollectionFee");
  });

  it("an existing agreement opens with its ANY × all-destinations row as the default rate", () => {
    const form = termsFormFrom({
      notes: "n",
      codCollectionFee: 10,
      rates: [
        {
          id: "a",
          service: "ANY",
          countryId: null,
          country: null,
          city: "",
          scope: "ALL",
          amount: 25,
          codFee: "ADDED",
        },
        {
          id: "b",
          service: "COD_CARRIER",
          countryId: null,
          country: null,
          city: "",
          scope: "ALL",
          amount: 35,
          codFee: "INCLUDED",
        },
      ],
    } as Pick<ShippingAgreementDetail, "rates" | "codCollectionFee" | "notes">);
    expect(form).toMatchObject({
      defaultAmount: "25",
      defaultIncludesCodFee: false,
      codCollectionFee: "10",
      notes: "n",
      extras: [{ service: "COD_CARRIER", amount: "35", includesCodFee: true }],
    });
  });
});
