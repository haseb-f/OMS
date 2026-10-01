import { describe, expect, it } from "vitest";
import type { AgentShippingRate } from "@/services/agents-service";
import { resolveTariffRate, tariffMatrix } from "./shipping-tariffs";
import { shippingPricingDisplay } from "./shipping-pricing";

const rate = (
  id: string,
  over: Partial<AgentShippingRate> & Pick<AgentShippingRate, "amount">,
): AgentShippingRate => ({
  id,
  agreementId: "agr",
  countryId: "sa",
  city: "",
  deliveryChannel: "ANY",
  paymentType: "ANY",
  country: null,
  ...over,
});

/** spec-2-agent-pricing.md worked tariff. */
const WORKED = [
  rate("pc", { deliveryChannel: "CARRIER", paymentType: "PREPAID", amount: "25" }),
  rate("cc", { deliveryChannel: "CARRIER", paymentType: "CASH_ON_DELIVERY", amount: "35" }),
  rate("ci", {
    deliveryChannel: "INTERNAL_COURIER",
    paymentType: "CASH_ON_DELIVERY",
    amount: "25",
  }),
];

describe("agent shipping tariffs", () => {
  it("resolves the worked tariff and leaves prepaid × internal courier unset", () => {
    const [row] = tariffMatrix(WORKED);
    expect(row.cells["CARRIER:PREPAID"]?.amount).toBe("25");
    expect(row.cells["CARRIER:CASH_ON_DELIVERY"]?.amount).toBe("35");
    expect(row.cells["INTERNAL_COURIER:CASH_ON_DELIVERY"]?.amount).toBe("25");
    expect(row.cells["INTERNAL_COURIER:PREPAID"]).toBeNull();
  });

  it("city beats country, exact channel beats ANY, exact payment beats ANY", () => {
    const rates = [
      rate("any", { amount: "10" }),
      rate("carrier", { deliveryChannel: "CARRIER", amount: "20" }),
      rate("carrier-cod", {
        deliveryChannel: "CARRIER",
        paymentType: "CASH_ON_DELIVERY",
        amount: "30",
      }),
      rate("riyadh", { city: "Riyadh", amount: "40" }),
    ];
    const riyadh = { countryId: "sa", city: "riyadh" };
    const jeddah = { countryId: "sa", city: "Jeddah" };
    expect(resolveTariffRate(rates, riyadh, "CARRIER", "CASH_ON_DELIVERY")?.id).toBe("riyadh");
    expect(resolveTariffRate(rates, jeddah, "CARRIER", "CASH_ON_DELIVERY")?.id).toBe("carrier-cod");
    expect(resolveTariffRate(rates, jeddah, "CARRIER", "PREPAID")?.id).toBe("carrier");
    expect(resolveTariffRate(rates, jeddah, "INTERNAL_COURIER", "PREPAID")?.id).toBe("any");
    const matrix = tariffMatrix(rates);
    expect(matrix.map((row) => row.city)).toEqual(["", "Riyadh"]);
    expect(matrix[1].cells["INTERNAL_COURIER:PREPAID"]?.id).toBe("riyadh");
  });
});

describe("shipping pricing display", () => {
  const base = {
    status: "CONFIRMED" as const,
    pricingMode: "SHIPPING_ADDED" as const,
    customerTotalStatus: "NONE" as const,
    paidAmount: 0,
    outstanding: 0,
  };

  it("labels a provisional shipping-added total as pending, never final", () => {
    expect(shippingPricingDisplay({ ...base, status: "PENDING_METHOD" })).toMatchObject({
      provisional: true,
      payablePending: true,
    });
    // Shipping included: the agreed total is final; only the split is provisional.
    expect(
      shippingPricingDisplay({
        ...base,
        status: "PENDING_METHOD",
        pricingMode: "SHIPPING_INCLUDED",
      }),
    ).toMatchObject({ provisional: true, payablePending: false });
  });

  it("asks for the customer's agreement and shows paid 425 vs payable 435 as outstanding", () => {
    expect(
      shippingPricingDisplay({ ...base, customerTotalStatus: "CONFIRMATION_REQUIRED" })
        .confirmationRequired,
    ).toBe(true);
    expect(
      shippingPricingDisplay({
        ...base,
        customerTotalStatus: "CONFIRMED",
        paidAmount: 425,
        outstanding: 10,
      }).showOutstanding,
    ).toBe(true);
    expect(shippingPricingDisplay(null).provisional).toBe(false);
  });
});
