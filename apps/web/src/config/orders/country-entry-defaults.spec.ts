import { describe, expect, it } from "vitest";
import { applicableProposals, proposeForCountry } from "./country-entry-defaults";

const countries = [
  { id: "sa", code: "SA", defaultCurrencyId: "sar" },
  { id: "eg", code: "EG", defaultCurrencyId: "egp" },
  { id: "kw", code: "KW", defaultCurrencyId: null },
  { id: "ae", code: "AE", defaultCurrencyId: "gone" },
];
const currencies = [{ id: "sar" }, { id: "egp" }];

describe("proposeForCountry", () => {
  it("proposes the calling code and the configured currency of the country", () => {
    expect(proposeForCountry("eg", countries, currencies)).toEqual({
      phoneCountryId: "eg",
      currencyId: "egp",
    });
  });

  it("asks (null) instead of guessing when the country has no configured currency", () => {
    expect(proposeForCountry("kw", countries, currencies)).toEqual({
      phoneCountryId: "kw",
      currencyId: null,
    });
  });

  it("never proposes a currency the form does not offer", () => {
    expect(proposeForCountry("ae", countries, currencies).currencyId).toBeNull();
  });

  it("proposes nothing for an unknown or empty country", () => {
    expect(proposeForCountry("zz", countries, currencies)).toEqual({
      phoneCountryId: null,
      currencyId: null,
    });
    expect(proposeForCountry("", countries, currencies).phoneCountryId).toBeNull();
  });
});

describe("applicableProposals", () => {
  it("applies both while nothing was chosen by the user", () => {
    expect(
      applicableProposals({
        phoneCodeTouched: false,
        currencyTouched: false,
        phoneHasValue: false,
      }),
    ).toEqual({ phone: true, currency: true });
  });

  it("never overwrites a manual calling code or currency", () => {
    expect(
      applicableProposals({ phoneCodeTouched: true, currencyTouched: true, phoneHasValue: false }),
    ).toEqual({ phone: false, currency: false });
  });

  it("does not re-read an already entered number under another calling code", () => {
    expect(
      applicableProposals({ phoneCodeTouched: false, currencyTouched: false, phoneHasValue: true }),
    ).toEqual({ phone: false, currency: true });
  });
});
