import { describe, expect, it } from "vitest";
import { withInvoiceCapacity } from "./allocation-capacity";

const line = (invoiceId: string, allocatedAmount: number) => ({
  id: `l-${invoiceId}`,
  invoiceId,
  invoiceNumber: invoiceId,
  invoiceHref: "#",
  remainingBalance: allocatedAmount,
  allocatedAmount,
});

describe("withInvoiceCapacity (R18)", () => {
  it("a confirmed partial receipt is not 'fully paid': capacity = open balance + its own line", () => {
    // INV-91: 200,000, this receipt applied 100,000, 100,000 still open.
    const [result] = withInvoiceCapacity(
      [line("inv-91", 100_000)],
      [{ invoiceId: "inv-91", remainingBalance: 100_000 }],
      true,
    );
    expect(result.remainingBalance).toBe(200_000);
    expect(result.allocatedAmount < result.remainingBalance).toBe(true);
  });

  it("a confirmed line that settled the invoice keeps capacity = its amount (invoice no longer open)", () => {
    expect(withInvoiceCapacity([line("inv-1", 500)], [], true)[0].remainingBalance).toBe(500);
  });

  it("a draft line uses the invoice's open balance (draft allocations do not count yet)", () => {
    expect(
      withInvoiceCapacity(
        [line("inv-2", 100_000)],
        [{ invoiceId: "inv-2", remainingBalance: 200_000 }],
        false,
      )[0].remainingBalance,
    ).toBe(200_000);
  });
});
