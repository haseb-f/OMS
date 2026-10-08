import { describe, expect, it } from "vitest";
import {
  agentLineErrors,
  agentOrderEntryDefaults,
  agentOrderStepRouting,
  buildAgentConvertInput,
  buildAgentCreateInput,
  buildAgentOrderEntrySchema,
  buildAgentPricingInput,
  localizedApiMessage,
  newAgentLine,
  parseAmount,
  workedHint,
  type AgentLineDraft,
  type AgentOrderEntryValues,
} from "./agent-order-entry";

const t = (key: string) => key;

function values(patch: Partial<AgentOrderEntryValues> = {}): AgentOrderEntryValues {
  return agentOrderEntryDefaults({
    customerName: " Sara ",
    customerPhone: "+201000000000",
    countryId: "eg",
    city: "Cairo",
    ...patch,
  });
}
const priced = (): AgentLineDraft[] => [{ ...newAgentLine("p1", "2"), lineAmount: "900" }];
const same = { differentCountry: false };

function schemaErrors(
  input: AgentOrderEntryValues,
  options: { customerRequired?: boolean; differentCountry?: boolean; phoneCountry?: string } = {},
) {
  const schema = buildAgentOrderEntrySchema(t as never, {
    getPhoneCountryCode: () => options.phoneCountry ?? "EG",
    customerRequired: options.customerRequired ?? true,
    getDifferentCountry: () => options.differentCountry ?? false,
  });
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
}

describe("agent order entry (R15 W1 agent adapter)", () => {
  it("parses amounts without guessing", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("abc")).toBeUndefined();
    expect(parseAmount("-1")).toBeUndefined();
    expect(parseAmount("10.456")).toBe(10.46);
    expect(parseAmount("0")).toBe(0);
  });

  it("returns no pricing request until a product has a quantity", () => {
    expect(buildAgentPricingInput(agentOrderEntryDefaults(), [newAgentLine()], same)).toBeNull();
    expect(buildAgentPricingInput(values(), [newAgentLine("p1", "0")], same)).toBeNull();
  });

  it("builds a Shipping-added quote with line amounts and the destination", () => {
    expect(buildAgentPricingInput(values(), priced(), same)).toEqual({
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: "p1", quantity: 2, lineAmount: 900 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "PREPAID",
      countryId: "eg",
      city: "Cairo",
    });
  });

  it("sends the different delivery country as the tariff destination", () => {
    const input = buildAgentPricingInput(values({ deliveryCountryId: "sa" }), priced(), {
      differentCountry: true,
    });
    expect(input?.countryId).toBe("sa");
    // Without the toggle the customer's country stays the destination.
    expect(
      buildAgentPricingInput(values({ deliveryCountryId: "sa" }), priced(), same)?.countryId,
    ).toBe("eg");
  });

  it("builds a Shipping-included quote with the agreed total and no guessed line amounts", () => {
    const input = buildAgentPricingInput(
      values({ pricingMode: "SHIPPING_INCLUDED", agreedTotal: "1000" }),
      [newAgentLine("p1", "1")],
      same,
    );
    expect(input).toMatchObject({ pricingMode: "SHIPPING_INCLUDED", agreedTotal: 1000 });
    expect(input?.lines).toEqual([{ productId: "p1", quantity: 1 }]);
  });

  it("sends a shipping override only when disclosed, with its reason", () => {
    const hidden = buildAgentPricingInput(
      values({ shippingOverride: "50", shippingOverrideReason: "x" }),
      priced(),
      same,
    );
    expect(hidden?.shippingChargeOverride).toBeUndefined();
    const shown = buildAgentPricingInput(
      values({ overrideShipping: true, shippingOverride: "50", shippingOverrideReason: " far " }),
      priced(),
      same,
    );
    expect(shown).toMatchObject({ shippingChargeOverride: 50, shippingOverrideReason: "far" });
    const pickup = buildAgentPricingInput(
      values({ overrideShipping: true, shippingOverride: "50", fulfillmentMethod: "PICKUP" }),
      priced(),
      same,
    );
    expect(pickup?.shippingChargeOverride).toBeUndefined();
  });

  it("sends a service charge only when enabled", () => {
    expect(
      buildAgentPricingInput(values({ serviceCharge: "20" }), priced(), same)?.serviceCharge,
    ).toBeUndefined();
    expect(
      buildAgentPricingInput(
        values({ serviceChargeEnabled: true, serviceCharge: "20" }),
        priced(),
        same,
      )?.serviceCharge,
    ).toBe(20);
  });

  it("lists what is still missing (schema + lines)", () => {
    expect(schemaErrors(values())).toEqual([]);
    expect(schemaErrors(values({ customerName: "", customerPhone: "", countryId: "" }))).toEqual([
      "customerName",
      "customerPhone",
      "countryId",
    ]);
    // A lead conversion: the customer comes from the lead.
    expect(schemaErrors(values({ customerName: "" }), { customerRequired: false })).toEqual([]);
    expect(agentLineErrors(priced(), "SHIPPING_ADDED")).toEqual([]);
    expect(
      agentLineErrors([{ ...newAgentLine("p1", "1"), lineAmount: "" }], "SHIPPING_ADDED"),
    ).toEqual(["lineAmount"]);
    expect(schemaErrors(values({ pricingMode: "SHIPPING_INCLUDED", agreedTotal: "" }))).toEqual([
      "agreedTotal",
    ]);
    expect(agentLineErrors([...priced(), newAgentLine()], "SHIPPING_ADDED")).toContain("lines");
    expect(schemaErrors(values({ overrideShipping: true, shippingOverride: "10" }))).toEqual([
      "shippingOverrideReason",
    ]);
    expect(schemaErrors(values({ fulfillmentMethod: "PICKUP", countryId: "" }))).toEqual([]);
    // "Different delivery country" without one falls back to the customer's; none at all is asked there.
    expect(
      schemaErrors(values({ countryId: "", deliveryCountryId: "" }), { differentCountry: true }),
    ).toEqual(["deliveryCountryId"]);
  });

  it("reads the phone with the chosen calling code (never re-read under another)", () => {
    // An Egyptian mobile typed nationally: valid under +20, never re-read as a Saudi number.
    expect(schemaErrors(values({ customerPhone: "01001234567" }), { phoneCountry: "EG" })).toEqual(
      [],
    );
    expect(
      schemaErrors(values({ customerPhone: "01001234567" }), { phoneCountry: "SA" }),
    ).toContain("customerPhone");
  });

  it("builds the create payload with the customer, the idempotency key and the declaration", () => {
    expect(
      buildAgentCreateInput(values({ notes: " call first " }), priced(), {
        ...same,
        idempotencyKey: "key-1",
        declaration: { kind: "UNPAID", idempotencyKey: "decl-1" },
      }),
    ).toMatchObject({
      customer: { name: "Sara", mobile: "+201000000000", countryId: "eg", city: "Cairo" },
      notes: "call first",
      idempotencyKey: "key-1",
      pricingMode: "SHIPPING_ADDED",
      declaration: { kind: "UNPAID", idempotencyKey: "decl-1" },
    });
  });

  it("keeps an order-only address off the customer, and staff fields only for staff", () => {
    const abroad = buildAgentCreateInput(values({ deliveryCountryId: "sa" }), priced(), {
      differentCountry: true,
      idempotencyKey: "k",
    });
    expect(abroad?.customer).toEqual({ name: "Sara", mobile: "+201000000000", countryId: "eg" });
    expect(abroad).toMatchObject({ countryId: "sa", city: "Cairo" });
    expect(abroad).not.toHaveProperty("agentId");
    const staff = buildAgentCreateInput(values({ ownerUserId: "u1" }), priced(), {
      ...same,
      idempotencyKey: "k",
      agentId: "agent-1",
    });
    expect(staff).toMatchObject({ agentId: "agent-1", ownerUserId: "u1" });
    expect(
      buildAgentCreateInput(values({ ownerUserId: "u1" }), priced(), {
        ...same,
        idempotencyKey: "k",
      }),
    ).not.toHaveProperty("ownerUserId");
  });

  it("builds the lead conversion payload without a customer", () => {
    const input = buildAgentConvertInput(values(), priced(), same);
    expect(input).not.toHaveProperty("customer");
    expect(input).toMatchObject({ pricingMode: "SHIPPING_ADDED", countryId: "eg" });
  });

  it("routes agent DTO errors to their step", () => {
    expect(agentOrderStepRouting.stepForField("customer.mobile")).toBe("customer");
    expect(agentOrderStepRouting.stepForField("lines[0].lineAmount")).toBe("products");
    expect(agentOrderStepRouting.stepForField("agreedTotal")).toBe("products");
    expect(agentOrderStepRouting.stepForField("shippingOverrideReason")).toBe("deliveryPayment");
    expect(agentOrderStepRouting.stepForField("declaration.destinationId")).toBe("deliveryPayment");
    expect(agentOrderStepRouting.firstStepWithError(["notes", "customerPhone"])).toBe("customer");
  });

  it("shows the API message half in the UI language", () => {
    const message = "حدد دولة الشحن — Choose the shipping destination country.";
    expect(localizedApiMessage(message, "ar")).toBe("حدد دولة الشحن");
    expect(localizedApiMessage(message, "en")).toBe("Choose the shipping destination country.");
    expect(localizedApiMessage("plain", "en")).toBe("plain");
  });

  it("explains the included-shipping arithmetic from the quote", () => {
    const hint = workedHint({
      breakdown: {
        mode: "SHIPPING_INCLUDED",
        merchandiseAmount: 900,
        discountAmount: 0,
        taxAmount: 0,
        shippingCharge: 100,
        serviceCharge: 0,
        payableTotal: 1000,
      },
    });
    expect(hint).toEqual({
      kind: "included",
      total: 1000,
      merchandise: 900,
      shipping: 100,
      service: 0,
    });
    expect(
      workedHint({
        breakdown: {
          mode: "SHIPPING_ADDED",
          merchandiseAmount: 1000,
          discountAmount: 0,
          taxAmount: 0,
          shippingCharge: 100,
          serviceCharge: 25,
          payableTotal: 1125,
        },
      })?.kind,
    ).toBe("addedService");
    expect(workedHint(null)).toBeNull();
    expect(workedHint({ breakdown: null })).toBeNull();
  });
});
