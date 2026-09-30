import { describe, expect, it } from "vitest";
import {
  buildAmendmentChanges,
  initialAmendDraft,
  isAmendReasonValid,
  type AmendableOrder,
} from "./amendment-draft";

const company: AmendableOrder = {
  id: "o1",
  number: "SO-1",
  version: 3,
  isAgentOrder: false,
  currencyId: "sar",
  currencyCode: "SAR",
  paymentType: "PREPAID",
  fulfillmentMethod: "SHIPPING",
  pricingMode: null,
  payableTotal: 100,
  customer: {
    partnerId: "p1",
    name: "Sara",
    phone: "+966500000001",
    email: "",
    countryId: "sa",
    city: "Riyadh",
    address: "Street 1",
  },
  lines: [{ itemId: "i1", productId: "prod1", productName: "Box", quantity: 1, agreedAmount: 100 }],
};

describe("amend dialog draft → API changes (spec 1A)", () => {
  it("an untouched draft has no changes", () => {
    const diff = buildAmendmentChanges(company, initialAmendDraft(company));
    expect(diff).toEqual({ changes: {}, error: null, hasChanges: false });
  });

  it("sends only the changed sections, with the full line list when lines change", () => {
    const draft = initialAmendDraft(company);
    draft.lines[0].quantity = "2";
    draft.lines.push({
      key: "n1",
      itemId: null,
      productId: "prod2",
      productName: "Bag",
      quantity: "1",
      agreedAmount: "50",
    });
    draft.currencyId = "egp";
    draft.city = "Jeddah";
    const diff = buildAmendmentChanges(company, draft);
    expect(diff.error).toBeNull();
    expect(diff.changes).toEqual({
      items: [
        { itemId: "i1", productId: "prod1", quantity: 2, agreedAmount: 100 },
        { productId: "prod2", quantity: 1, agreedAmount: 50 },
      ],
      currencyId: "egp",
      destination: { countryId: "sa", city: "Jeddah", address: "Street 1" },
    });
  });

  it("customer switch and corrections; email only for company orders", () => {
    const draft = initialAmendDraft(company);
    draft.partnerId = "p2";
    draft.name = "Sara A.";
    const diff = buildAmendmentChanges(company, draft);
    expect(diff.changes.customer).toEqual({ partnerId: "p2", name: "Sara A." });
  });

  it("validates lines: product, quantity ≥ 1 and (company) the agreed amount", () => {
    const draft = initialAmendDraft(company);
    draft.lines[0].agreedAmount = "";
    expect(buildAmendmentChanges(company, draft).error).toBe("orderAmendments.amountRequired");
    draft.lines[0].agreedAmount = "10";
    draft.lines[0].quantity = "0";
    expect(buildAmendmentChanges(company, draft).error).toBe("orderAmendments.lineRequired");
  });

  it("agent orders: no currency switch; shipping-included amounts are optional, agreed total sent", () => {
    const agent: AmendableOrder = {
      ...company,
      isAgentOrder: true,
      pricingMode: "SHIPPING_INCLUDED",
      payableTotal: 500,
    };
    const draft = initialAmendDraft(agent);
    draft.currencyId = "other";
    draft.lines[0].agreedAmount = "";
    draft.agreedTotal = "450";
    const diff = buildAmendmentChanges(agent, draft);
    expect(diff.error).toBeNull();
    expect(diff.changes.currencyId).toBeUndefined();
    expect(diff.changes.agreedTotal).toBe(450);
  });

  it("the reason is required (3–1000 characters)", () => {
    expect(isAmendReasonValid("  ")).toBe(false);
    expect(isAmendReasonValid("ok")).toBe(false);
    expect(isAmendReasonValid("Customer asked")).toBe(true);
  });
});
