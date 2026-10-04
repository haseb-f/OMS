import { describe, expect, it } from "vitest";
import { orderDestination } from "@/config/store-orders/order-destination";

const partner = { countryId: "SA-id", city: "Riyadh", address: "Customer street 1" };

describe("orderDestination (R11)", () => {
  it("an order without its own destination uses the customer's", () => {
    expect(orderDestination({ partner } as never)).toEqual({
      countryId: "SA-id",
      city: "Riyadh",
      address: "Customer street 1",
      own: false,
    });
  });

  it("an order with its own destination uses it — the customer's is not mixed in", () => {
    expect(
      orderDestination({
        deliveryCountryId: "EG-id",
        deliveryCity: "Cairo",
        deliveryAddress: null,
        partner,
      } as never),
    ).toEqual({ countryId: "EG-id", city: "Cairo", address: "", own: true });
  });

  it("handles a missing customer", () => {
    expect(orderDestination({} as never)).toEqual({
      countryId: "",
      city: "",
      address: "",
      own: false,
    });
  });
});
