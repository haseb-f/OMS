import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import { agentLedgerDescription, type DescribableLedgerLine } from "./agent-ledger-description";

const ar = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(messages.ar, key, params);
const en = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(messages.en, key, params);

const line = (over: Partial<DescribableLedgerLine>): DescribableLedgerLine => ({
  entryType: "COLLECTION_RECEIVED",
  description: "STORED",
  basis: null,
  references: {
    orderNumber: "SO-7",
    paymentNumber: "PAY-1",
    payoutNumber: null,
    settlementNumber: null,
    returnNumber: null,
  },
  ...over,
});

describe("agentLedgerDescription", () => {
  it("renders a company collection in Arabic from the references", () => {
    expect(agentLedgerDescription(line({}), ar)).toBe("تحصيل PAY-1 استلمته الشركة — الطلب SO-7");
    expect(agentLedgerDescription(line({}), en)).toBe(
      "Collection PAY-1 received by the company — order SO-7",
    );
  });

  it("uses basis facts: commission rate/base, refund payer + reason, service-charge kind", () => {
    const commission = line({ entryType: "COMMISSION", basis: { ratePercent: 10, base: 900 } });
    expect(agentLedgerDescription(commission, ar)).toBe("عمولة 10% من 900.00 — الطلب SO-7");

    const refund = line({
      entryType: "CUSTOMER_REFUND",
      basis: { paidBy: "COMPANY", reason: "تالف" },
    });
    expect(agentLedgerDescription(refund, ar)).toBe(
      "استرداد للعميل دفعته الشركة — الطلب SO-7: تالف",
    );
    const agentRefund = line({
      entryType: "CUSTOMER_REFUND",
      basis: { paidBy: "AGENT", reason: "x" },
    });
    expect(agentLedgerDescription(agentRefund, en)).toBe(
      "Customer refund paid by the agent — order SO-7 (memo): x",
    );

    expect(
      agentLedgerDescription(
        line({ entryType: "SERVICE_FEE", basis: { customerServiceCharge: 20 } }),
        en,
      ),
    ).toBe("Customer service charge retained — order SO-7");
    expect(
      agentLedgerDescription(
        line({ entryType: "SERVICE_FEE", basis: { serviceFeePerOrder: 5 } }),
        en,
      ),
    ).toBe("Service fee per order — order SO-7");
  });

  it("covers provider fee, payout and adjustment variants", () => {
    const refs = {
      orderNumber: null,
      paymentNumber: "PAY-2",
      payoutNumber: "APO-3",
      settlementNumber: "PST-4",
      returnNumber: null,
    };
    expect(agentLedgerDescription(line({ entryType: "PROVIDER_FEE", references: refs }), ar)).toBe(
      "حصة رسوم مزوّد الدفع — PST-4، الدفعة PAY-2",
    );
    expect(agentLedgerDescription(line({ entryType: "PAYOUT", references: refs }), ar)).toBe(
      "صرف مستحقات APO-3",
    );
    expect(
      agentLedgerDescription(
        line({ entryType: "PAYOUT", references: refs, basis: { reference: "TRX-9" } }),
        en,
      ),
    ).toBe("Payout APO-3 — TRX-9");
    expect(
      agentLedgerDescription(
        line({
          entryType: "ADJUSTMENT",
          references: refs,
          basis: { reverses: "AL-5", reason: "r" },
        }),
        en,
      ),
    ).toBe("Provider fee reversed (AL-5) — settlement PST-4 reversed");
    expect(
      agentLedgerDescription(
        line({ entryType: "ADJUSTMENT", basis: { direction: "DEBIT", reason: "late" } }),
        ar,
      ),
    ).toBe("تسوية مالية (خصم): late");
  });

  it("falls back to the stored text for unknown types or missing facts", () => {
    expect(agentLedgerDescription(line({ entryType: "SOMETHING_NEW" }), ar)).toBe("STORED");
    // Commission without its basis cannot be described faithfully.
    expect(agentLedgerDescription(line({ entryType: "COMMISSION" }), ar)).toBe("STORED");
    // A refund whose payer is unknown.
    expect(
      agentLedgerDescription(line({ entryType: "CUSTOMER_REFUND", basis: { reason: "x" } }), ar),
    ).toBe("STORED");
    // Missing order reference.
    expect(
      agentLedgerDescription(
        line({ entryType: "SHIPPING_FEE", references: { orderNumber: null } }),
        ar,
      ),
    ).toBe("STORED");
  });

  it("every template resolves in both languages", () => {
    const keys = Object.keys(messages.en.agents.ledgerDescription);
    expect(Object.keys(messages.ar.agents.ledgerDescription).sort()).toEqual([...keys].sort());
  });
});
