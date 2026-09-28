import { describe, expect, it } from "vitest";
import {
  canConvertLead,
  declaredStatusTone,
  digitalFulfillmentState,
  fulfillmentCodeLabelKey,
  fulfillmentProgress,
  leadCodeLabelKey,
  localizedName,
  paymentStageTone,
  stageShares,
  verificationTone,
} from "./labels";

describe("agent portal labels", () => {
  it("never styles a declaration like a verification", () => {
    expect(verificationTone("DECLARED_AWAITING_FINANCE")).toBe("warning");
    expect(verificationTone("FINANCE_VERIFIED")).toBe("success");
    expect(verificationTone("REJECTED")).toBe("destructive");
    expect(declaredStatusTone("PAID")).not.toBe("success");
  });

  it("maps payment stages to tones", () => {
    expect(paymentStageTone("AVAILABLE")).toBe("success");
    expect(paymentStageTone("PAID_OUT")).toBe("success");
    expect(paymentStageTone("DECLARED")).toBe("warning");
    expect(paymentStageTone("REVERSED")).toBe("destructive");
    expect(paymentStageTone("SETTLED")).toBe("info");
  });

  it("labels known status codes and falls back for catalog-only ones", () => {
    expect(fulfillmentCodeLabelKey("SHIPPED")).toBe("agentPortal.status.fulfillmentCodes.SHIPPED");
    expect(fulfillmentCodeLabelKey("CUSTOM")).toBeNull();
    expect(fulfillmentCodeLabelKey(null)).toBeNull();
    expect(leadCodeLabelKey("NEW")).toBe("agentPortal.status.leadCodes.NEW");
    expect(leadCodeLabelKey("FOLLOW_UP")).toBeNull();
  });

  it("derives the fulfillment progress from dispatch and earning", () => {
    expect(
      fulfillmentProgress({ dispatchedAt: null, earnedAt: null, statusCode: "READY" }),
    ).toEqual({
      current: "created",
      complete: false,
      cancelled: false,
    });
    expect(
      fulfillmentProgress({ dispatchedAt: "2026-09-01", earnedAt: null, statusCode: "SHIPPED" }),
    ).toMatchObject({ current: "dispatched", complete: false });
    expect(
      fulfillmentProgress({
        dispatchedAt: "2026-09-01",
        earnedAt: "2026-09-03",
        statusCode: "DELIVERED",
      }),
    ).toMatchObject({ current: "completed", complete: true });
    expect(
      fulfillmentProgress({ dispatchedAt: null, earnedAt: null, statusCode: "CANCELLED" })
        .cancelled,
    ).toBe(true);
  });

  it("digital-only orders read as a no-shipping service, completed once earned", () => {
    expect(digitalFulfillmentState({ earnedAt: null, statusCode: "NOT_FULFILLED" })).toEqual({
      labelKey: "agentPortal.orderDetail.digital.pending",
      tone: "info",
    });
    expect(
      digitalFulfillmentState({ earnedAt: "2026-09-20", statusCode: "NOT_FULFILLED" }),
    ).toEqual({
      labelKey: "agentPortal.orderDetail.digital.completed",
      tone: "success",
    });
    expect(digitalFulfillmentState({ earnedAt: null, statusCode: "CANCELLED" })).toBeNull();
  });

  it("computes stage shares of all orders", () => {
    const shares = stageShares({
      total: 8,
      awaitingDispatch: 2,
      dispatched: 2,
      completed: 3,
      withReturns: 1,
      cancelled: 1,
    });
    expect(shares.map((s) => s.percent)).toEqual([25, 25, 38, 13, 13]);
    expect(
      stageShares({
        total: 0,
        awaitingDispatch: 0,
        dispatched: 0,
        completed: 0,
        withReturns: 0,
        cancelled: 0,
      }).every((s) => s.percent === 0),
    ).toBe(true);
  });

  it("converts only open leads without an order", () => {
    expect(canConvertLead({ status: { code: "NEW" }, storeOrder: null })).toBe(true);
    expect(canConvertLead({ status: { code: "LOST" }, storeOrder: null })).toBe(false);
    expect(canConvertLead({ status: { code: "CONVERTED" }, storeOrder: { id: "o" } })).toBe(false);
  });

  it("names records in the UI language", () => {
    const product = { name: "كتاب", nameEn: "Book", displayName: "كتاب مميز" };
    expect(localizedName(product, "en")).toBe("Book");
    expect(localizedName(product, "ar")).toBe("كتاب مميز");
    expect(localizedName({ name: "مصر", nameEn: null }, "en")).toBe("مصر");
    expect(localizedName(null, "ar")).toBe("");
  });
});
