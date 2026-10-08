import { describe, expect, it } from "vitest";
import {
  buildInspectionLines,
  buildReturnRequestLines,
  canRecordRefund,
  figureGroups,
  hasReturnableLines,
  moneyNotices,
} from "./store-order-money";
import type {
  StoreOrderMoney,
  StoreOrderMoneyFigures,
  StoreOrderReturnsOverview,
} from "./store-order-money-service";
import { orderRefundSummary } from "@/components/financial-transactions/customer-refund-dialog";

const figures = (overrides: Partial<StoreOrderMoneyFigures> = {}): StoreOrderMoneyFigures => ({
  payable: 200,
  declared: 0,
  expectedFromCarrier: 0,
  collected: 0,
  withCarrier: 0,
  awaitingSettlement: 0,
  inBank: 0,
  invoiced: 0,
  credited: 0,
  refunded: 0,
  balanceDue: 200,
  refundDue: 0,
  refundable: 0,
  customerCreditBalance: 0,
  ...overrides,
});

const money = (overrides: Partial<StoreOrderMoney> = {}): StoreOrderMoney => ({
  storeOrderId: "so-1",
  internalOrderId: "SO-1",
  partnerId: "p-1",
  currency: { id: "c-1", code: "EGP" },
  paymentType: "PREPAID",
  isAgentOrder: false,
  cancelled: false,
  figures: figures(),
  codCollection: { tracking: "NOT_APPLICABLE", carrierName: null, methodName: null },
  payments: [],
  invoices: [],
  returnCredits: [],
  refunds: [],
  ...overrides,
});

const overview = (returnable: number[], isAgentOrder = false): StoreOrderReturnsOverview => ({
  storeOrderId: "so-1",
  isAgentOrder,
  recognitionStatus: "RECOGNIZED",
  invoices: [
    {
      id: "inv-1",
      invoiceNumber: "SI-1",
      shipmentId: null,
      lines: returnable.map((quantity, index) => ({
        salesInvoiceItemId: `line-${index}`,
        productId: `prod-${index}`,
        sku: `SKU-${index}`,
        name: `Product ${index}`,
        invoicedQuantity: 2,
        returnedQuantity: 2 - quantity,
        returnableQuantity: quantity,
        lineTotal: "100.00",
      })),
    },
  ],
  returns: [],
});

describe("store order money panel rules (R15 W5b)", () => {
  it("shows only the stages that hold money, keeping the anchors", () => {
    const groups = figureGroups(figures({ collected: 200, withCarrier: 200, balanceDue: 0 }));
    expect(groups.owed.map((row) => row.key)).toEqual(["payable", "balanceDue"]);
    expect(groups.received.map((row) => row.key)).toEqual(["collected", "withCarrier"]);
  });

  it("a refund due is a standing 'Refund pending' notice; an untracked carrier says so", () => {
    expect(
      moneyNotices(
        money({
          figures: figures({ refundDue: 50 }),
          codCollection: { tracking: "NOT_TRACKED", carrierName: "Aramex", methodName: null },
        }),
      ),
    ).toEqual(["REFUND_PENDING", "COD_NOT_TRACKED"]);
    expect(moneyNotices(money())).toEqual([]);
  });

  it("offers Record refund only when the API says something is refundable, never on agent orders", () => {
    expect(canRecordRefund(money({ figures: figures({ refundDue: 50, refundable: 50 }) }))).toBe(
      true,
    );
    // A credit note alone (refund due but no ledger credit) is not refundable now.
    expect(canRecordRefund(money({ figures: figures({ refundDue: 50, refundable: 0 }) }))).toBe(
      false,
    );
    expect(
      canRecordRefund(money({ isAgentOrder: true, figures: figures({ refundable: 50 }) })),
    ).toBe(false);
  });

  it("Return needs a delivered line still returnable; agent goods never use it", () => {
    expect(hasReturnableLines(overview([0, 1]))).toBe(true);
    expect(hasReturnableLines(overview([0, 0]))).toBe(false);
    expect(hasReturnableLines(overview([1], true))).toBe(false);
  });

  it("builds request lines: whole quantities up to what remains returnable", () => {
    const result = buildReturnRequestLines(overview([2, 1]), {
      "line-0": "1",
      "line-1": "2",
    });
    expect(result.lines).toEqual([{ salesInvoiceItemId: "line-0", quantity: 1 }]);
    expect(result.errors).toEqual({ "line-1": "tooMany" });
    expect(buildReturnRequestLines(overview([2]), { "line-0": "1.5" }).errors).toEqual({
      "line-0": "invalid",
    });
  });

  it("inspection lines default to saleable and send a warehouse only when overridden", () => {
    expect(
      buildInspectionLines([{ id: "a" }, { id: "b" }], { b: "DAMAGED" }, { a: "wh-1" }),
    ).toEqual([
      { salesReturnItemId: "a", condition: "SALEABLE", warehouseId: "wh-1" },
      { salesReturnItemId: "b", condition: "DAMAGED" },
    ]);
  });

  it("the order refund summary is the API's figures, the cap is its refundable", () => {
    const summary = orderRefundSummary({
      storeOrderId: "so-1",
      internalOrderId: "SO-1",
      partnerId: "p-1",
      currencyId: "c-1",
      active: false,
      collected: 150,
      invoiced: 0,
      credited: 0,
      refunded: 0,
      expected: 0,
      balanceDue: 0,
      refundDue: 150,
      advanceRefundable: 150,
      returnCredits: [],
      customerCreditBalance: 120,
      refundable: 120,
    });
    expect(summary.refundable).toBe(120);
    expect(summary.title).toBe("SO-1");
    expect(summary.rows.map((row) => row.amount)).toEqual([150, 0, 0, 150, 120, 120]);
  });
});
