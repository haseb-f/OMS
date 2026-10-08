import { describe, expect, it } from "vitest";
import type {
  ShippingAgreementActivation,
  ShippingAgreementList,
  ShippingAgreementListItem,
} from "./shipping-agreements-api";
import {
  EMPTY_RATE_FORM,
  activePhase,
  agreementPeriod,
  canConfirmActivation,
  defaultSelectedAgreement,
  destinationName,
  rateInputFrom,
} from "./shipping-agreement-view";

const item = (id: string, status: ShippingAgreementListItem["status"]) =>
  ({ id, status }) as ShippingAgreementListItem;

const activation = (over: Partial<ShippingAgreementActivation> = {}) => ({
  ready: true,
  problems: [],
  overlapping: [],
  replaceCloses: null,
  ...over,
});

describe("shipping agreement view rules", () => {
  it("opens on the agreement in force, else the newest draft, else the newest", () => {
    const list = (inForceId: string | null, items: ShippingAgreementListItem[]) =>
      ({ inForceId, items }) as ShippingAgreementList;
    const items = [item("a", "INACTIVE"), item("b", "DRAFT"), item("c", "ACTIVE")];
    expect(defaultSelectedAgreement(list("c", items))).toBe("c");
    expect(defaultSelectedAgreement(list(null, items))).toBe("b");
    expect(defaultSelectedAgreement(list(null, [item("a", "INACTIVE")]))).toBe("a");
    expect(defaultSelectedAgreement(list(null, []))).toBeNull();
  });

  it("places an ACTIVE agreement against today (Cairo calendar days, inclusive)", () => {
    const active = (from: string, to: string | null) => ({
      status: "ACTIVE" as const,
      effectiveFrom: `${from}T00:00:00.000Z`,
      effectiveTo: to ? `${to}T00:00:00.000Z` : null,
    });
    expect(activePhase(active("2026-10-07", null), "2026-10-07")).toBe("IN_FORCE");
    expect(activePhase(active("2026-01-01", "2026-10-07"), "2026-10-07")).toBe("IN_FORCE");
    expect(activePhase(active("2026-10-08", null), "2026-10-07")).toBe("SCHEDULED");
    expect(activePhase(active("2026-01-01", "2026-10-06"), "2026-10-07")).toBe("ENDED");
    expect(
      activePhase({ ...active("2020-01-01", null), status: "DRAFT" }, "2026-10-07"),
    ).toBeNull();
  });

  it("formats the period with an open end", () => {
    expect(
      agreementPeriod({ effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null }, "open"),
    ).toBe("01 Jan 2026 – open");
  });

  it("offers Activate only when ready, and with an overlap only once 'replace from' is chosen", () => {
    expect(canConfirmActivation(null, true)).toBe(false);
    expect(canConfirmActivation(activation(), false)).toBe(true);
    expect(
      canConfirmActivation(
        activation({ ready: false, problems: ["SHIPPING_AGREEMENT_NO_RATES"] }),
        true,
      ),
    ).toBe(false);
    const overlapping = [
      { id: "x", agreementNumber: "ASA-1", effectiveFrom: "2020-01-01", effectiveTo: null },
    ];
    const replaceable = activation({ overlapping, replaceCloses: "2026-10-07" });
    expect(canConfirmActivation(replaceable, false)).toBe(false);
    expect(canConfirmActivation(replaceable, true)).toBe(true);
  });

  it("validates a rate row: service required, 0 allowed, two decimals, a city needs its country", () => {
    expect(rateInputFrom({ ...EMPTY_RATE_FORM, amount: "10" }).error).toBe("service");
    const base = { ...EMPTY_RATE_FORM, service: "COD_CARRIER" as const };
    expect(rateInputFrom({ ...base, amount: "0" })).toEqual({
      input: { service: "COD_CARRIER", amount: 0 },
      error: null,
    });
    expect(rateInputFrom({ ...base, amount: "" }).error).toBe("amount");
    expect(rateInputFrom({ ...base, amount: "-1" }).error).toBe("amount");
    expect(rateInputFrom({ ...base, amount: "1.005" }).error).toBe("amount");
    expect(rateInputFrom({ ...base, city: "Cairo", amount: "40" }).error).toBe("cityNeedsCountry");
    expect(rateInputFrom({ ...base, countryId: "eg", city: " Cairo ", amount: "40.5" })).toEqual({
      input: { service: "COD_CARRIER", countryId: "eg", city: "Cairo", amount: 40.5 },
      error: null,
    });
  });

  it("names a destination in the UI language; no country = all destinations (null)", () => {
    const country = { id: "eg", code: "EG", name: "مصر", nameEn: "Egypt" };
    expect(destinationName({ country, city: "Cairo" }, "en")).toBe("Egypt / Cairo");
    expect(destinationName({ country, city: "" }, "ar")).toBe("مصر");
    expect(destinationName({ country: null, city: "" }, "en")).toBeNull();
  });
});
