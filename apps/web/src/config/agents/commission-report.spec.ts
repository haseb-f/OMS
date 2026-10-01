import { describe, expect, it } from "vitest";
import { carrierCostStage, formatCurrencyAmounts, shippingSettlement } from "./commission-report";

const carrier = {
  estimated: 0,
  incurredByCurrency: [],
  approvedByCurrency: [],
  paidByCurrency: [],
};

describe("commission report helpers", () => {
  it("reports the carrier cost stage (company expense) without merging stages", () => {
    expect(carrierCostStage(carrier)).toBe("NONE");
    expect(carrierCostStage({ ...carrier, estimated: 30 })).toBe("ESTIMATED");
    expect(
      carrierCostStage({ ...carrier, approvedByCurrency: [{ currencyCode: "SAR", amount: 10 }] }),
    ).toBe("APPROVED");
    expect(
      carrierCostStage({
        ...carrier,
        approvedByCurrency: [{ currencyCode: "SAR", amount: 10 }],
        incurredByCurrency: [{ currencyCode: "SAR", amount: 4 }],
      }),
    ).toBe("AWAITING_APPROVAL");
  });

  it("shows how the retained customer shipping settled the agent shipping charge", () => {
    expect(shippingSettlement({ agentShippingCharge: 100, difference: 0 })).toBe("SETTLED");
    // O1 — the company bears a shortfall and keeps an excess.
    expect(shippingSettlement({ agentShippingCharge: 100, difference: -20 })).toBe(
      "COMPANY_BEARS_SHORTFALL",
    );
    expect(shippingSettlement({ agentShippingCharge: 100, difference: 20 })).toBe(
      "COMPANY_KEEPS_EXCESS",
    );
    // Portal rows carry no difference: the agent always sees "settled".
    expect(shippingSettlement({ agentShippingCharge: 100 })).toBe("SETTLED");
    expect(shippingSettlement({ agentShippingCharge: null, difference: null })).toBe(
      "NO_AGENT_CHARGE",
    );
  });

  it("keeps each carrier currency separate", () => {
    expect(formatCurrencyAmounts([])).toBe("—");
    expect(
      formatCurrencyAmounts([
        { currencyCode: "SAR", amount: 10000 },
        { currencyCode: "EGP", amount: 1300 },
      ]),
    ).toMatch(/^SAR 10,000\.00 · EGP 1,300\.00$/);
  });
});
