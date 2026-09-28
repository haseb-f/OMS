import { describe, expect, it } from "vitest";
import {
  buildConvertLeadInput,
  buildCreateOrderInput,
  buildPricingInput,
  emptyOrderForm,
  localizedApiMessage,
  newLineDraft,
  orderFormErrors,
  parseAmount,
  workedHint,
  type OrderFormState,
} from "./order-form";

function form(patch: Partial<OrderFormState> = {}): OrderFormState {
  return {
    ...emptyOrderForm(),
    customerName: " Sara ",
    mobile: "+201000000000",
    countryId: "eg",
    city: "Cairo",
    lines: [{ ...newLineDraft("p1", "2"), lineAmount: "900" }],
    ...patch,
  };
}

describe("agent portal order form", () => {
  it("parses amounts without guessing", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("abc")).toBeUndefined();
    expect(parseAmount("-1")).toBeUndefined();
    expect(parseAmount("10.456")).toBe(10.46);
    expect(parseAmount("0")).toBe(0);
  });

  it("returns no pricing request until a product has a quantity", () => {
    expect(buildPricingInput(emptyOrderForm())).toBeNull();
    expect(buildPricingInput(form({ lines: [newLineDraft("p1", "0")] }))).toBeNull();
  });

  it("builds a Shipping-added quote with line amounts and the destination", () => {
    expect(buildPricingInput(form())).toEqual({
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: "p1", quantity: 2, lineAmount: 900 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "PREPAID",
      countryId: "eg",
      city: "Cairo",
    });
  });

  it("builds a Shipping-included quote with the agreed total and no guessed line amounts", () => {
    const input = buildPricingInput(
      form({
        pricingMode: "SHIPPING_INCLUDED",
        agreedTotal: "1000",
        lines: [newLineDraft("p1", "1")],
      }),
    );
    expect(input).toMatchObject({ pricingMode: "SHIPPING_INCLUDED", agreedTotal: 1000 });
    expect(input?.lines).toEqual([{ productId: "p1", quantity: 1 }]);
  });

  it("sends a shipping override only when disclosed, with its reason", () => {
    const hidden = buildPricingInput(form({ shippingOverride: "50", shippingOverrideReason: "x" }));
    expect(hidden?.shippingChargeOverride).toBeUndefined();
    const shown = buildPricingInput(
      form({ overrideShipping: true, shippingOverride: "50", shippingOverrideReason: " far " }),
    );
    expect(shown).toMatchObject({ shippingChargeOverride: 50, shippingOverrideReason: "far" });
    const pickup = buildPricingInput(
      form({ overrideShipping: true, shippingOverride: "50", fulfillmentMethod: "PICKUP" }),
    );
    expect(pickup?.shippingChargeOverride).toBeUndefined();
  });

  it("sends a service charge only when enabled", () => {
    expect(buildPricingInput(form({ serviceCharge: "20" }))?.serviceCharge).toBeUndefined();
    expect(
      buildPricingInput(form({ serviceChargeEnabled: true, serviceCharge: "20" }))?.serviceCharge,
    ).toBe(20);
  });

  it("lists what is still missing", () => {
    expect(orderFormErrors(form(), { requireCustomer: true })).toEqual([]);
    expect(
      orderFormErrors(form({ customerName: "", mobile: "", countryId: "" }), {
        requireCustomer: true,
      }),
    ).toEqual(["customerName", "mobile", "country"]);
    expect(orderFormErrors(form({ customerName: "" }), { requireCustomer: false })).toEqual([]);
    expect(
      orderFormErrors(form({ lines: [{ ...newLineDraft("p1", "1"), lineAmount: "" }] }), {
        requireCustomer: true,
      }),
    ).toEqual(["lineAmount"]);
    expect(
      orderFormErrors(form({ pricingMode: "SHIPPING_INCLUDED", agreedTotal: "" }), {
        requireCustomer: true,
      }),
    ).toEqual(["agreedTotal"]);
    expect(
      orderFormErrors(form({ lines: [...form().lines, newLineDraft()] }), {
        requireCustomer: true,
      }),
    ).toContain("lines");
    expect(
      orderFormErrors(form({ overrideShipping: true, shippingOverride: "10" }), {
        requireCustomer: true,
      }),
    ).toEqual(["overrideReason"]);
    expect(
      orderFormErrors(form({ fulfillmentMethod: "PICKUP", countryId: "" }), {
        requireCustomer: true,
      }),
    ).toEqual([]);
  });

  it("builds the create payload with the customer and the idempotency key", () => {
    expect(buildCreateOrderInput(form({ notes: " call first " }), "key-1")).toMatchObject({
      customer: { name: "Sara", mobile: "+201000000000", countryId: "eg", city: "Cairo" },
      notes: "call first",
      idempotencyKey: "key-1",
      pricingMode: "SHIPPING_ADDED",
    });
  });

  it("builds the lead conversion payload without a customer", () => {
    const input = buildConvertLeadInput(form());
    expect(input).not.toHaveProperty("customer");
    expect(input).toMatchObject({ pricingMode: "SHIPPING_ADDED", countryId: "eg" });
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
