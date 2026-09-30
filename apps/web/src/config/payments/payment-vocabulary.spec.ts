import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/modules/payment-vocabulary.en";
import ar from "@/i18n/messages/modules/payment-vocabulary.ar";
import {
  PAYMENT_TERMS,
  claimTerm,
  claimVerificationTerm,
  declaredStatusTone,
  paymentRecordTerm,
  paymentTerm,
  settlementTerm,
  statementLineTerm,
  verificationTone,
} from "./payment-vocabulary";
import { paymentRecordStatusBadge } from "@/config/store-orders/status";
import {
  SETTLEMENT_TONE,
  VERIFICATION_TONE,
} from "@/components/payments/declaration/declaration-status";
import { verificationTone as portalVerificationTone } from "@/config/agent-portal/labels";

describe("payment vocabulary", () => {
  it("maps every record state to exactly one term", () => {
    expect(paymentRecordTerm("PENDING")).toBe("DECLARED");
    expect(paymentRecordTerm("MATCHED")).toBe("MATCHED");
    expect(paymentRecordTerm("VERIFIED")).toBe("CONFIRMED");
    expect(paymentRecordTerm("REJECTED")).toBe("REJECTED");
    expect(paymentRecordTerm("DISPUTED")).toBe("DISPUTED");
    expect(paymentRecordTerm("SOMETHING_NEW")).toBeNull();
    expect(settlementTerm("NOT_APPLICABLE")).toBeNull();
    expect(settlementTerm("SETTLED")).toBe("SETTLED");
    expect(statementLineTerm("UNMATCHED")).toBe("STATEMENT_LINE");
    expect(statementLineTerm("EXCEPTION")).toBe("EXCEPTION");
  });

  it("uses the spec tones everywhere", () => {
    const tone = (term: Parameters<typeof paymentTerm>[0]) => paymentTerm(term).tone;
    expect(tone("DECLARED")).toBe("warning");
    expect(tone("MATCHED")).toBe("info");
    expect(tone("CONFIRMED")).toBe("success");
    expect(tone("SETTLED")).toBe("success");
    expect(tone("AWAITING_SETTLEMENT")).toBe("info");
    expect(tone("PARTIALLY_SETTLED")).toBe("warning");
    expect(tone("DISPUTED")).toBe("destructive");
    expect(tone("EXCEPTION")).toBe("destructive");
    expect(tone("REJECTED")).toBe("neutral");
  });

  it("orders the happy path 1–5 and keeps off-path states stage-less", () => {
    expect(paymentTerm("DECLARED").stage).toBe(1);
    expect(paymentTerm("STATEMENT_LINE").stage).toBe(2);
    expect(paymentTerm("MATCHED").stage).toBe(3);
    expect(paymentTerm("CONFIRMED").stage).toBe(4);
    expect(paymentTerm("SETTLED").stage).toBe(5);
    expect(paymentTerm("REJECTED").stage).toBeNull();
  });

  it("has a label and a description for every term in both languages, and never reuses a label", () => {
    for (const term of PAYMENT_TERMS) {
      expect(en.term[term].label).toBeTruthy();
      expect(en.term[term].description).toBeTruthy();
      expect(ar.term[term].label).toBeTruthy();
      expect(ar.term[term].description).toBeTruthy();
    }
    const labels = PAYMENT_TERMS.map((term) => en.term[term].label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(en.term.MATCHED.label).not.toBe(en.term.CONFIRMED.label);
    expect(en.term.CONFIRMED.label).not.toBe(en.term.SETTLED.label);
  });

  it("shows a posted claim by its settlement state once it has one", () => {
    expect(claimTerm({ status: "VERIFIED", settlementStatus: "NOT_APPLICABLE" })).toBe("CONFIRMED");
    expect(claimTerm({ status: "VERIFIED", settlementStatus: "AWAITING_SETTLEMENT" })).toBe(
      "AWAITING_SETTLEMENT",
    );
    expect(claimTerm({ status: "VERIFIED", settlementStatus: "SETTLED" })).toBe("SETTLED");
    expect(claimTerm({ status: "PENDING", settlementStatus: "SETTLED" })).toBe("DECLARED");
  });

  it("drives every screen's badges: order detail, declaration panel, agent portal", () => {
    expect(paymentRecordStatusBadge("VERIFIED")).toEqual({
      labelKey: "paymentVocabulary.term.CONFIRMED.label",
      fallback: "VERIFIED",
      tone: "success",
    });
    expect(paymentRecordStatusBadge("PENDING").tone).toBe("warning");
    expect(paymentRecordStatusBadge("WEIRD")).toEqual({
      labelKey: null,
      fallback: "WEIRD",
      tone: "neutral",
    });
    // Former conflicts: awaiting settlement was warning, partially settled info, rejected destructive.
    expect(SETTLEMENT_TONE.AWAITING_SETTLEMENT).toBe("info");
    expect(SETTLEMENT_TONE.PARTIALLY_SETTLED).toBe("warning");
    expect(SETTLEMENT_TONE.NOT_APPLICABLE).toBe("neutral");
    expect(VERIFICATION_TONE.REJECTED).toBe("neutral");
    expect(VERIFICATION_TONE.DISPUTED).toBe("destructive");
    expect(verificationTone("VERIFIED")).toBe("success");
    expect(declaredStatusTone("PAID")).toBe("warning");
    expect(declaredStatusTone("UNPAID")).toBe("neutral");
    expect(claimVerificationTerm("FINANCE_MATCHED")).toBe("MATCHED");
    expect(portalVerificationTone("FINANCE_MATCHED")).toBe("info");
  });
});
