import { describe, expect, it } from "vitest";
import type { PaymentReviewContext } from "@/services/payments-review-service";
import type {
  ClaimActiveMatch,
  StatementLineView,
} from "@/services/payment-reconciliation-service";
import {
  allocationAmount,
  confirmMatchState,
  confirmPostState,
  correctionState,
  discrepancies,
  disputeState,
  initialLineId,
  matchedSignals,
  refundState,
  rejectState,
  type MatchPanelPermissions,
} from "./match-panel-model";
import { formatCurrencyTotals, totalsByCurrency } from "../payment-totals";

const SAR = { id: "sar", code: "SAR" };
const EGP = { id: "egp", code: "EGP" };
const ALL: MatchPanelPermissions = { canConfirm: true, canMatch: true, canCorrect: true };

function context(overrides: Partial<PaymentReviewContext> = {}): PaymentReviewContext {
  return {
    id: "p1",
    paymentNumber: "PAY-1",
    status: "PENDING",
    settlementStatus: "NOT_APPLICABLE",
    amount: 450,
    settledAmount: 0,
    matchedAmount: 0,
    activeMatchCount: 0,
    currency: SAR,
    paymentDate: "2026-09-20T00:00:00.000Z",
    referenceNumber: "REF-1",
    senderName: "Customer",
    origin: "SALES_DECLARATION",
    declarationKind: "FULL",
    destinationOwnership: null,
    disputeReason: null,
    rejectionReason: null,
    method: { id: "m1", name: "Bank transfer", requiresReconciliation: false },
    paymentSource: null,
    debitAccount: { id: "a1", code: "1130", name: "Clearing", source: "PAYMENT_METHOD" },
    storeOrder: { id: "o1", internalOrderId: "SO-1", externalOrderId: null, currency: SAR },
    customer: { id: "c1", name: "Customer", phone: null, kind: "CUSTOMER" },
    orderSettlement: { total: 450, paid: 0, outstanding: 450, fullySettled: false },
    attachments: [],
    receipt: null,
    journalEntry: null,
    ...overrides,
  };
}

function line(overrides: Partial<StatementLineView> = {}): StatementLineView {
  return {
    id: "l1",
    providerReference: "TX-9",
    orderReference: null,
    customerName: null,
    customerPhone: null,
    amount: 450,
    matchedAmount: 0,
    remaining: 450,
    currency: SAR,
    transactionDate: "2026-09-21T00:00:00.000Z",
    providerStatus: "CAPTURED",
    feeAmount: null,
    netAmount: null,
    status: "UNMATCHED",
    technical: {
      importId: null,
      sourceType: "FILE",
      fileName: null,
      sheetName: null,
      rowNumber: 2,
      importedAt: "2026-09-21T00:00:00.000Z",
      dedupeKey: "ref:TX-9",
      rowHash: null,
      rawRow: null,
    },
    ...overrides,
  };
}

describe("match panel view-model", () => {
  it("states the exact Confirm & post effect: amount, debit account, order", () => {
    const state = confirmPostState(context(), ALL);
    expect(state.disabledReason).toBeNull();
    expect(state.effect.key).toBe("paymentVocabulary.effect.confirmPost");
    expect(state.effect.params.account).toBe("1130 Clearing");
    expect(state.effect.params.order).toBe("SO-1");
    expect(state.effect.params.amount).toContain("450");
    expect(state.effect.params.amount).toContain("SAR");
  });

  it("disables Confirm & post with the server's own reasons", () => {
    const reason = (overrides: Partial<PaymentReviewContext>, perms = ALL) =>
      confirmPostState(context(overrides), perms).disabledReason;
    expect(reason({ status: "VERIFIED" })).toBe("paymentVocabulary.reason.alreadyPosted");
    expect(reason({ status: "VERIFIED", settlementStatus: "SETTLED" })).toBe(
      "paymentVocabulary.reason.settled",
    );
    expect(reason({ method: { id: "m", name: "Tabby", requiresReconciliation: true } })).toBe(
      "paymentVocabulary.reason.reconciledMethod",
    );
    expect(reason({ currency: EGP })).toBe("paymentVocabulary.reason.currencyDiffers");
    expect(reason({ debitAccount: null })).toBe("paymentVocabulary.reason.noDebitAccount");
    expect(
      reason({ orderSettlement: { total: 0, paid: 0, outstanding: 0, fullySettled: false } }),
    ).toBe("paymentVocabulary.reason.missingPrice");
    expect(reason({ destinationOwnership: "AGENT" })).toBe(
      "paymentVocabulary.reason.agentCollection",
    );
    expect(reason({}, { ...ALL, canConfirm: false })).toBe("paymentVocabulary.reason.noPermission");
  });

  it("distinguishes a posting match from a partial allocation", () => {
    const reconciled = context({
      method: { id: "m", name: "Tabby", requiresReconciliation: true },
    });
    expect(confirmMatchState(reconciled, line(), ALL).effect.key).toBe(
      "paymentVocabulary.effect.matchPost",
    );
    const partial = confirmMatchState(reconciled, line({ remaining: 200 }), ALL);
    expect(partial.effect.key).toBe("paymentVocabulary.effect.matchPartial");
    expect(partial.effect.params.remaining).toContain("250");
    expect(allocationAmount(reconciled, line({ remaining: 900 }))).toBe(450);
    expect(confirmMatchState(reconciled, null, ALL).disabledReason).toBe(
      "paymentVocabulary.reason.noLine",
    );
    expect(confirmMatchState(reconciled, line({ currency: EGP }), ALL).disabledReason).toBe(
      "paymentVocabulary.reason.currencyDiffers",
    );
  });

  it("reports amount, currency and date discrepancies", () => {
    expect(discrepancies(context(), line({ transactionDate: "2026-09-20T05:00:00.000Z" }))).toEqual(
      [],
    );
    const amount = discrepancies(context(), line({ remaining: 400 }));
    expect(amount.map((row) => row.kind)).toEqual(["amount", "date"]);
    expect(amount[0].tone).toBe("warning");
    const currency = discrepancies(context(), line({ currency: EGP }));
    expect(currency[0]).toMatchObject({ kind: "currency", tone: "destructive" });
    const far = discrepancies(context(), line({ transactionDate: "2026-10-10T00:00:00.000Z" }));
    expect(far.find((row) => row.kind === "date")?.tone).toBe("warning");
  });

  it("keeps Reject declaration and Refund customer apart", () => {
    expect(rejectState(context(), ALL).disabledReason).toBeNull();
    expect(rejectState(context({ activeMatchCount: 1 }), ALL).disabledReason).toBe(
      "paymentVocabulary.reason.activeMatches",
    );
    expect(rejectState(context({ status: "VERIFIED" }), ALL).disabledReason).toBe(
      "paymentVocabulary.reason.alreadyPosted",
    );
    expect(refundState(context()).disabledReason).toBe("paymentVocabulary.reason.notPosted");
    expect(refundState(context({ status: "VERIFIED" })).disabledReason).toBeNull();
    expect(disputeState(context({ storeOrder: null }), ALL).disabledReason).toBe(
      "paymentVocabulary.reason.noOrder",
    );
  });

  it("labels a correction truthfully: Unmatch vs Reverse posting naming the JE", () => {
    const match = (overrides: Partial<ClaimActiveMatch>): ClaimActiveMatch => ({
      id: "m1",
      amount: 450,
      reasons: [],
      confirmedAt: "2026-09-21T00:00:00.000Z",
      reversalEffect: "UNMATCH",
      settled: false,
      line: line(),
      ...overrides,
    });
    const posting = {
      receipt: { transactionNumber: "RC-7" },
      journalEntry: { entryNumber: "JE-2026-000123" },
    };
    const unmatch = correctionState(context(), match({}), posting, ALL);
    expect(unmatch.intent).toBe("unmatch");
    expect(unmatch.journal).toBeNull();
    expect(unmatch.effect.key).toBe("paymentVocabulary.effect.unmatch");

    const reverse = correctionState(
      context(),
      match({ reversalEffect: "REVERSE_POSTING" }),
      posting,
      ALL,
    );
    expect(reverse.intent).toBe("reversePosting");
    expect(reverse.journal).toBe("JE-2026-000123");
    expect(reverse.effect.params).toMatchObject({ receipt: "RC-7", journal: "JE-2026-000123" });

    expect(correctionState(context(), match({ settled: true }), posting, ALL).disabledReason).toBe(
      "paymentVocabulary.reason.settled",
    );
    expect(
      correctionState(context(), match({}), posting, { ...ALL, canCorrect: false }).disabledReason,
    ).toBe("paymentVocabulary.reason.noPermission");
  });

  it("starts on the active match, else an unambiguous top suggestion", () => {
    const row = (id: string) => ({ line: { id } });
    expect(initialLineId(null)).toBeNull();
    expect(
      initialLineId({ activeMatches: [row("a")], candidates: [row("b")], ambiguous: false }),
    ).toBe("a");
    expect(initialLineId({ activeMatches: [], candidates: [row("b")], ambiguous: false })).toBe(
      "b",
    );
    expect(
      initialLineId({ activeMatches: [], candidates: [row("b")], ambiguous: true }),
    ).toBeNull();
  });

  it("shows positive evidence only and keeps currencies apart in totals", () => {
    expect(
      matchedSignals([
        { signal: "REFERENCE", detail: "" },
        { signal: "AMOUNT_DIFFERS", detail: "" },
        { signal: "CURRENCY", detail: "" },
      ]).map((reason) => reason.signal),
    ).toEqual(["REFERENCE"]);
    const totals = totalsByCurrency(
      [
        { code: "SAR", amount: "100" },
        { code: "SAR", amount: 50.5 },
        { code: "EGP", amount: 10 },
      ],
      (row) => row,
    );
    expect(totals).toEqual({ SAR: { count: 2, amount: 150.5 }, EGP: { count: 1, amount: 10 } });
    expect(formatCurrencyTotals(totals).split(" · ")).toHaveLength(2);
    expect(formatCurrencyTotals({})).toBe("—");
  });
});
