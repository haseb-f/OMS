import type { MessageKey } from "@/i18n/translate";
import type {
  FinancialTransactionDirection,
  FinancialTransactionTypeCode,
} from "./transaction-type";

/**
 * R22 §2 / D4 — what a receipt or payment voucher is FOR. The purpose decides
 * the voucher type (one FinancialTransaction service + Posting Engine, no
 * competing workflow) and which fields the card asks for: a party only for
 * invoice settlement and advances, allocation only for invoice settlement, an
 * authorised counter-account for «other», source + destination accounts for a
 * transfer. A direct expense opens the existing expense flow instead.
 */
export type VoucherPurpose = "SETTLE_INVOICES" | "ADVANCE" | "OTHER" | "TRANSFER" | "EXPENSE";

export interface VoucherPurposeDefinition {
  purpose: VoucherPurpose;
  direction: FinancialTransactionDirection;
  /** The FinancialTransaction type the purpose posts as (null: another, existing flow). */
  transactionType: FinancialTransactionTypeCode | null;
  needsParty: boolean;
  needsAllocation: boolean;
  needsCounterAccount: boolean;
  needsTargetAccount: boolean;
  /** Opens this route instead (direct expense → the Expenses editor). */
  href?: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
}

const IN: VoucherPurposeDefinition[] = [
  {
    purpose: "SETTLE_INVOICES",
    direction: "IN",
    transactionType: "CUSTOMER_RECEIPT",
    needsParty: true,
    needsAllocation: true,
    needsCounterAccount: false,
    needsTargetAccount: false,
    labelKey: "vouchers.purposes.SETTLE_INVOICES_IN",
    hintKey: "vouchers.purposeHints.SETTLE_INVOICES_IN",
  },
  {
    purpose: "ADVANCE",
    direction: "IN",
    transactionType: "CUSTOMER_RECEIPT",
    needsParty: true,
    needsAllocation: false,
    needsCounterAccount: false,
    needsTargetAccount: false,
    labelKey: "vouchers.purposes.ADVANCE_IN",
    hintKey: "vouchers.purposeHints.ADVANCE_IN",
  },
  {
    purpose: "OTHER",
    direction: "IN",
    transactionType: "OTHER_RECEIPT",
    needsParty: false,
    needsAllocation: false,
    needsCounterAccount: true,
    needsTargetAccount: false,
    labelKey: "vouchers.purposes.OTHER_IN",
    hintKey: "vouchers.purposeHints.OTHER_IN",
  },
  {
    purpose: "TRANSFER",
    direction: "IN",
    transactionType: "INTERNAL_TRANSFER",
    needsParty: false,
    needsAllocation: false,
    needsCounterAccount: false,
    needsTargetAccount: true,
    labelKey: "vouchers.purposes.TRANSFER_IN",
    hintKey: "vouchers.purposeHints.TRANSFER_IN",
  },
];

const OUT: VoucherPurposeDefinition[] = [
  {
    purpose: "SETTLE_INVOICES",
    direction: "OUT",
    transactionType: "SUPPLIER_PAYMENT",
    needsParty: true,
    needsAllocation: true,
    needsCounterAccount: false,
    needsTargetAccount: false,
    labelKey: "vouchers.purposes.SETTLE_INVOICES_OUT",
    hintKey: "vouchers.purposeHints.SETTLE_INVOICES_OUT",
  },
  {
    purpose: "ADVANCE",
    direction: "OUT",
    transactionType: "SUPPLIER_PAYMENT",
    needsParty: true,
    needsAllocation: false,
    needsCounterAccount: false,
    needsTargetAccount: false,
    labelKey: "vouchers.purposes.ADVANCE_OUT",
    hintKey: "vouchers.purposeHints.ADVANCE_OUT",
  },
  {
    purpose: "EXPENSE",
    direction: "OUT",
    transactionType: null,
    needsParty: false,
    needsAllocation: false,
    needsCounterAccount: false,
    needsTargetAccount: false,
    href: "/finance/expenses/new",
    labelKey: "vouchers.purposes.EXPENSE_OUT",
    hintKey: "vouchers.purposeHints.EXPENSE_OUT",
  },
  {
    purpose: "OTHER",
    direction: "OUT",
    transactionType: "OTHER_PAYMENT",
    needsParty: false,
    needsAllocation: false,
    needsCounterAccount: true,
    needsTargetAccount: false,
    labelKey: "vouchers.purposes.OTHER_OUT",
    hintKey: "vouchers.purposeHints.OTHER_OUT",
  },
  {
    purpose: "TRANSFER",
    direction: "OUT",
    transactionType: "INTERNAL_TRANSFER",
    needsParty: false,
    needsAllocation: false,
    needsCounterAccount: false,
    needsTargetAccount: true,
    labelKey: "vouchers.purposes.TRANSFER_OUT",
    hintKey: "vouchers.purposeHints.TRANSFER_OUT",
  },
];

/** The purposes a receipt (IN) or payment (OUT) card offers, in menu order. */
export function purposesFor(direction: FinancialTransactionDirection): VoucherPurposeDefinition[] {
  return direction === "IN" ? IN : OUT;
}

export function purposeDefinition(
  direction: FinancialTransactionDirection,
  purpose: VoucherPurpose,
): VoucherPurposeDefinition {
  return (
    purposesFor(direction).find((entry) => entry.purpose === purpose) ?? purposesFor(direction)[0]
  );
}

/** The settlement voucher types whose card offers a purpose choice (receipt / supplier payment). */
export function offersPurposeChoice(type: FinancialTransactionTypeCode): boolean {
  return type === "CUSTOMER_RECEIPT" || type === "SUPPLIER_PAYMENT";
}

/**
 * The purpose a saved voucher has: its type for «other» / transfer; a
 * receipt / payment with any allocation settles invoices, one without is an
 * advance (a draft keeps the purpose the person chose until it is saved).
 */
export function purposeOfVoucher(voucher: {
  type: string;
  allocations?: readonly unknown[] | null;
}): VoucherPurpose {
  if (voucher.type === "OTHER_RECEIPT" || voucher.type === "OTHER_PAYMENT") return "OTHER";
  if (voucher.type === "INTERNAL_TRANSFER") return "TRANSFER";
  if (voucher.type === "EXPENSE_PAYMENT") return "EXPENSE";
  return (voucher.allocations?.length ?? 0) > 0 ? "SETTLE_INVOICES" : "ADVANCE";
}

/** Query value a voucher route carries for the non-settlement types (`?purpose=other|transfer`). */
export function purposeFromQuery(value: string | null): VoucherPurpose | null {
  switch ((value ?? "").toLowerCase()) {
    case "settle":
      return "SETTLE_INVOICES";
    case "advance":
      return "ADVANCE";
    case "other":
      return "OTHER";
    case "transfer":
      return "TRANSFER";
    default:
      return null;
  }
}

export function purposeQueryValue(purpose: VoucherPurpose): string | null {
  if (purpose === "OTHER") return "other";
  if (purpose === "TRANSFER") return "transfer";
  return null;
}
