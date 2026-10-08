import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const locale = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  locale: "ar",
  direction: "rtl",
}));
vi.mock("@/providers/locale-provider", () => ({ useLocale: () => locale }));

import { AgentQuoteSummary } from "./agent-quote-summary";
import type { OrderQuote, ShippingRateScope } from "@/services/agent-portal-service";

afterEach(cleanup);

function quote(rateScope: ShippingRateScope): OrderQuote {
  return {
    valid: true,
    issues: [],
    currencyId: "egp",
    fulfillmentMethod: "SHIPPING",
    paymentType: "PREPAID",
    digitalOnly: false,
    shipping: { rate: 100, rateScope, charge: 100, source: "RATE", overrideAllowed: false },
    lines: [],
    breakdown: {
      mode: "SHIPPING_ADDED",
      merchandiseAmount: 900,
      discountAmount: 0,
      taxAmount: 0,
      shippingCharge: 100,
      serviceCharge: 0,
      payableTotal: 1000,
    },
    shippingPricingStatus: "CONFIRMED",
  };
}

describe("AgentQuoteSummary — where the shipping rate came from", () => {
  it.each([
    ["CITY", "agentPortal.orderForm.breakdown.rateScopeCity"],
    ["COUNTRY", "agentPortal.orderForm.breakdown.rateScopeCountry"],
    // R15 (W3): the shipping agreement's all-destinations row — never labelled a country rate.
    ["ALL", "agentShippingAgreements.allDestinations"],
  ] as const)("%s → %s", (scope, label) => {
    render(
      <AgentQuoteSummary
        state={{ status: "ready", key: "k", quote: quote(scope) }}
        current
        currency={{ code: "EGP" }}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain(`agentPortal.orderForm.breakdown.configuredRate · ${label}`);
    if (scope === "ALL") {
      expect(text).not.toContain("agentPortal.orderForm.breakdown.rateScopeCountry");
    }
  });

  it("explains a failed check without inventing figures", () => {
    render(
      <AgentQuoteSummary
        state={{ status: "failed", key: "k", message: null }}
        current={false}
        currency={{ code: "EGP" }}
      />,
    );
    expect(document.body.textContent).toContain("agentPortal.orderForm.breakdown.failed");
  });
});
