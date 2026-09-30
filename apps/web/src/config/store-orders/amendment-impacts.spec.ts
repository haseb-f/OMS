import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { AmendmentImpact } from "@/services/order-amendments-service";
import { buildImpactView, impactText } from "./amendment-impacts";

const t = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(messages.en, key, params);
const tAr = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(messages.ar, key, params);

const impact = (
  code: string,
  severity: AmendmentImpact["severity"],
  params: AmendmentImpact["params"] = {},
  message = "server text",
): AmendmentImpact => ({ code, severity, params, message });

describe("amendment impact view-model (spec 1A preview)", () => {
  const preview = {
    canCommit: true,
    impacts: [
      impact("TOTALS_CHANGED", "INFO", { previous: "100.00", next: "80.00", currency: "SAR" }),
      impact("LABEL_REISSUE_REQUIRED", "ACKNOWLEDGE", { tracking: "TRK-1" }),
      impact("DECLARATION_REEVALUATED", "ACKNOWLEDGE", { declared: "100.00", next: "80.00" }),
      // A repeated acknowledgement code is shown (and confirmed) once.
      impact("LABEL_REISSUE_REQUIRED", "ACKNOWLEDGE", { tracking: "TRK-1" }),
    ],
  };

  it("groups impacts and needs every acknowledgement before commit", () => {
    const none = buildImpactView(preview, new Set(), t, "en");
    expect(none.info.map((i) => i.code)).toEqual(["TOTALS_CHANGED"]);
    expect(none.acknowledgements.map((i) => i.code)).toEqual([
      "LABEL_REISSUE_REQUIRED",
      "DECLARATION_REEVALUATED",
    ]);
    expect(none.missing).toEqual(["LABEL_REISSUE_REQUIRED", "DECLARATION_REEVALUATED"]);
    expect(none.canCommit).toBe(false);

    const one = buildImpactView(preview, new Set(["LABEL_REISSUE_REQUIRED"]), t, "en");
    expect(one.acknowledgements[0].checked).toBe(true);
    expect(one.canCommit).toBe(false);

    const both = buildImpactView(
      preview,
      new Set(["LABEL_REISSUE_REQUIRED", "DECLARATION_REEVALUATED"]),
      t,
      "en",
    );
    expect(both).toMatchObject({ missing: [], canCommit: true });
  });

  it("a blocking impact never commits, whatever is acknowledged", () => {
    const view = buildImpactView(
      {
        canCommit: false,
        impacts: [
          impact("CURRENCY_LOCKED_BY_PAYMENT", "BLOCKING", {
            payment: "PAY-1",
            amount: "100.00",
            currency: "SAR",
          }),
        ],
      },
      new Set(["CURRENCY_LOCKED_BY_PAYMENT"]),
      t,
      "en",
    );
    expect(view.canCommit).toBe(false);
    expect(view.blocking[0].text).toBe(
      "Reverse or refund payment PAY-1 (100.00 SAR) first — a posted or matched payment keeps the order currency.",
    );
  });

  it("localizes by code with params, and falls back to the server text", () => {
    const label = impact("LABEL_REISSUE_REQUIRED", "ACKNOWLEDGE", { tracking: "TRK-9" });
    expect(impactText(label, t, "en")).toBe("Label TRK-9 must be cancelled and reissued.");
    expect(impactText(label, tAr, "ar")).toContain("TRK-9");
    // Null params render as a dash, never "null".
    expect(
      impactText(impact("CUSTOMER_PHONE_IN_USE", "BLOCKING", { customer: null }), t, "en"),
    ).toContain("(—)");
    // Unknown code → server text; agent pricing issues keep the precise bilingual reason.
    expect(impactText(impact("SOMETHING_NEW", "INFO", {}, "Plain reason"), t, "en")).toBe(
      "Plain reason",
    );
    const pricing = impact(
      "AGENT_PRICING_INVALID",
      "BLOCKING",
      {},
      "لا يوجد سعر شحن معتمد — No configured shipping rate.",
    );
    expect(impactText(pricing, t, "en")).toBe("No configured shipping rate.");
    expect(impactText(pricing, tAr, "ar")).toBe("لا يوجد سعر شحن معتمد");
  });

  it("every impact code the API emits has an EN and AR text", () => {
    const codes = Object.keys(messages.en.orderAmendments.impact);
    expect(Object.keys(messages.ar.orderAmendments.impact).sort()).toEqual([...codes].sort());
    expect(codes).toEqual(
      expect.arrayContaining([
        "ORDER_LOCKED_AFTER_DELIVERY",
        "ORDER_IN_TRANSIT",
        "LABEL_REISSUE_REQUIRED",
        "PAYMENT_OVERPAID_REFUND",
        "CURRENCY_LOCKED_BY_PAYMENT",
        "INVOICE_POSTED",
        "AGENT_COMMISSION_EARNED",
      ]),
    );
  });
});

describe("re-quote problems are shown by code, never English in the Arabic UI (review LOW)", () => {
  it("maps the issue code to localized text with its params", () => {
    const refused = impact(
      "AGENT_PRICING_INVALID",
      "BLOCKING",
      { issueCode: "AGENT_SHIPPING_EXCEEDS_TOTAL", fee: "35.00", agreedTotal: "30.00" },
      "English only text",
    );
    expect(impactText(refused, t, "en")).toBe(
      "The shipping fee (35.00) leaves no merchandise amount within the agreed total (30.00).",
    );
    expect(impactText(refused, tAr, "ar")).toContain("35.00");
    const unknown = impact(
      "AGENT_PRICING_INVALID",
      "BLOCKING",
      { issueCode: "NEW_CODE" },
      "English only",
    );
    expect(impactText(unknown, tAr, "ar")).toContain("NEW_CODE");
    expect(impactText(unknown, tAr, "ar")).not.toContain("English");
  });
});
