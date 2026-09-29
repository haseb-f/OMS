import type { MessageKey } from "@/i18n/translate";
import { formatAmount } from "@/lib/money";

/**
 * The fields a statement/ledger line needs to describe itself — satisfied by
 * both the internal `AgentStatementLine` and the portal `PortalStatementLine`
 * (whose `basis` is the portal-safe subset).
 */
export interface DescribableLedgerLine {
  entryType: string;
  description: string;
  basis?: unknown;
  references: {
    orderNumber?: string | null;
    paymentNumber?: string | null;
    payoutNumber?: string | null;
    settlementNumber?: string | null;
    returnNumber?: string | null;
  };
}

export type LedgerTranslate = (key: MessageKey, params?: Record<string, string | number>) => string;
type Translate = LedgerTranslate;
type Params = Record<string, string | number | null | undefined>;

function basisOf(line: DescribableLedgerLine): Record<string, unknown> {
  const basis = line.basis;
  return basis && typeof basis === "object" && !Array.isArray(basis)
    ? (basis as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Template key + params for a line, or null when the type/shape is not recognised. */
function template(line: DescribableLedgerLine): { key: MessageKey; params: Params } | null {
  const basis = basisOf(line);
  const refs = line.references;
  const order = refs.orderNumber ?? null;
  const payment = refs.paymentNumber ?? text(basis.paymentNumber);
  const payout = refs.payoutNumber ?? text(basis.payoutNumber);
  const settlement = refs.settlementNumber ?? text(basis.settlementNumber);
  const returnNumber = refs.returnNumber ?? text(basis.returnNumber);
  const reason = text(basis.reason);
  const reverses = text(basis.reverses);
  const k = (name: string) => `agents.ledgerDescription.${name}` as MessageKey;

  switch (line.entryType) {
    case "COLLECTION_RECEIVED":
      return { key: k("collectionReceived"), params: { payment, order } };
    case "COLLECTION_BY_AGENT":
      return { key: k("collectionByAgent"), params: { payment, order } };
    case "COLLECTION_REVERSAL":
      return { key: k("collectionReversal"), params: { reverses, reason } };
    case "COMMISSION": {
      const rate = typeof basis.ratePercent === "number" ? basis.ratePercent : null;
      const base = typeof basis.base === "number" ? formatAmount(basis.base) : null;
      return { key: k("commission"), params: { rate, base, order } };
    }
    case "COMMISSION_REVERSAL":
      return { key: k("commissionReversal"), params: { return: returnNumber, order } };
    case "CUSTOMER_SHIPPING_RETAINED":
      return { key: k("customerShippingRetained"), params: { order } };
    case "CUSTOMER_SHIPPING_RETAINED_REVERSAL":
      return { key: k("customerShippingRetainedReversal"), params: { order } };
    case "SHIPPING_FEE":
      return { key: k("shippingFee"), params: { order } };
    case "RETURN_FEE":
      return { key: k("returnFee"), params: { return: returnNumber, order } };
    case "SERVICE_FEE":
      return "customerServiceCharge" in basis
        ? { key: k("customerServiceCharge"), params: { order } }
        : { key: k("serviceFee"), params: { order } };
    case "PROVIDER_FEE":
      return { key: k("providerFee"), params: { settlement, payment } };
    case "CUSTOMER_REFUND":
      if (basis.paidBy === "AGENT") {
        return { key: k("refundByAgent"), params: { order, reason } };
      }
      if (basis.paidBy === "COMPANY") {
        return { key: k("refundByCompany"), params: { order, reason } };
      }
      return null;
    case "PAYOUT": {
      const reference = text(basis.reference);
      return reference
        ? { key: k("payoutWithReference"), params: { payout, reference } }
        : { key: k("payout"), params: { payout } };
    }
    case "PAYOUT_REVERSAL":
      return { key: k("payoutReversal"), params: { payout, reason } };
    case "ADJUSTMENT":
      // A reversed settlement credits the provider-fee share back.
      if (reverses && (basis.counterAccount === "PAYMENT_GATEWAY_FEE" || settlement)) {
        return { key: k("providerFeeReversal"), params: { reverses, settlement } };
      }
      if (basis.direction === "DEBIT") {
        return { key: k("adjustmentCharge"), params: { reason } };
      }
      if (basis.direction === "CREDIT") {
        return { key: k("adjustmentCredit"), params: { reason } };
      }
      return null;
    default:
      return null;
  }
}

/**
 * Localized statement/ledger description (portal statement, internal statement
 * tab and both statement prints). The stored `description` is immutable English
 * audit text; this renders the same facts from the entry type, its references
 * and its basis in the UI language. Unknown types, or a line missing any fact
 * its template needs, fall back to the stored text — never a half-filled
 * sentence.
 */
export function agentLedgerDescription(line: DescribableLedgerLine, t: Translate): string {
  const resolved = template(line);
  if (!resolved) return line.description;
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(resolved.params)) {
    if (value == null || value === "") return line.description;
    params[name] = value;
  }
  return t(resolved.key, params);
}
