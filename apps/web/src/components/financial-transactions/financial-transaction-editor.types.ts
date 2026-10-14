import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { DocumentActionConfirmation } from "@/components/documents/document-action-bar";
import type {
  FinancialTransactionActivityEntry,
  FinancialTransactionRow,
  FinancialTransactionStatusValue,
} from "@/services/financial-transactions-service";
import type { AllocationGridLine } from "./allocation-grid";
import type {
  FinancialTransactionDirection,
  FinancialTransactionTypeCode,
} from "@/config/financial-transactions/transaction-type";
import type {
  VoucherPurpose,
  VoucherPurposeDefinition,
} from "@/config/financial-transactions/voucher-purpose";

/**
 * Financial Transactions & Matching Engine (TASK-043) — the Configuration
 * Engine for `FinancialTransactionEditor`, mirroring the contract shape
 * `SalesDocumentEditorConfig`/`PurchaseDocumentEditorConfig` already
 * established (one `config` + one `state` + one `handlers` object). Unlike
 * those two, the party picker itself is a render prop
 * (`renderPartyPicker`), not a hardcoded import — this editor is the one
 * genuinely shared between two different party types (Customer vs
 * Supplier) in the same component, so the picker has to be generic here
 * rather than forked.
 */
export type TransactionWorkflowActionKey = "confirm" | "cancel" | "delete" | "print";

export interface TransactionEditorActionContext {
  document: FinancialTransactionRow | null;
}

export interface TransactionWorkflowAction {
  key: TransactionWorkflowActionKey;
  label: string;
  icon?: LucideIcon;
  /** The one filled action for the current status; defaults to `variant === "default"`. */
  primary?: boolean;
  /** Listed last in "More", in red; defaults to `variant === "destructive"`. */
  destructive?: boolean;
  /** Legacy visual hint — mapped onto `primary`/`destructive` by the action bar. */
  variant?: "default" | "outline" | "destructive" | "ghost";
  visibleForStatuses?: FinancialTransactionStatusValue[];
  /** Confirmation shown by the action bar itself before `onAction` runs. */
  confirm?: DocumentActionConfirmation;
  onAction: (context: TransactionEditorActionContext) => void | Promise<void>;
}

/** Inline validation messages, keyed by the field they belong under. */
export interface FinancialTransactionEditorFieldErrors {
  party?: string | null;
  amount?: string | null;
  receivingAccount?: string | null;
  /** R22 D4 — other receipt / payment. */
  counterAccount?: string | null;
  /** R22 D4 — internal transfer destination. */
  targetAccount?: string | null;
  allocations?: string | null;
  /** Anything not tied to one field — shown under the totals. */
  form?: string | null;
}

export interface TransactionStatusOption {
  value: FinancialTransactionStatusValue;
  label: string;
  tone: "success" | "warning" | "destructive" | "info" | "neutral";
}

export interface FinancialTransactionEditorConfig {
  title: string;
  partyLabel: string;
  transactionType: FinancialTransactionTypeCode;
  direction: FinancialTransactionDirection;
  docCodePreview?: string;
  permissions: { create: string; edit: string; confirm: string; cancel: string };
  statusOptions: TransactionStatusOption[];
  workflowActions: TransactionWorkflowAction[];
  toolbarExtra?: ReactNode;
  /** Allocation grid column header when the settled documents are not invoices (Customer Refund → Sales Returns). */
  allocationDocumentLabel?: string;
  /** Voucher-specific wording of the shared fields (an expense is "paid from", by "payment method"). */
  fieldLabels?: Partial<
    Record<"transactionDate" | "paymentSource" | "receivingAccount" | "amount", string>
  >;
  /**
   * R22 §2 — the purposes the card offers (receipt / supplier payment). Omitted:
   * every purpose of the direction for a receipt / supplier payment, none for
   * the other voucher types (expense, refund keep their single-purpose form).
   * `false` hides the choice.
   */
  purposes?: VoucherPurposeDefinition[] | false;
}

export interface FinancialTransactionEditorState {
  document: FinancialTransactionRow | null;
  documentNumber: string | null;
  status: FinancialTransactionStatusValue;
  transactionDate: Date | null;
  amount: number;
  referenceNumber: string;
  notes: string;
  paymentSourceId: string | null;
  receivingAccountId: string | null;
  allocations: AllocationGridLine[];
  /** R22 §2 — the operation purpose (receipt / supplier payment cards); defaults to invoice settlement. */
  purpose?: VoucherPurpose;
  /** R22 — chosen currency when the purpose does not follow invoices (null = base currency). */
  currencyId?: string | null;
  /** R22 D4 — OTHER_RECEIPT / OTHER_PAYMENT counter-account. */
  counterAccountId?: string | null;
  /** R22 D4 — INTERNAL_TRANSFER destination account. */
  targetReceivingAccountId?: string | null;
}

export interface FinancialTransactionEditorHandlers {
  onTransactionDateChange: (date: Date | null) => void;
  onAmountChange: (value: number) => void;
  onReferenceNumberChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onPaymentSourceChange: (id: string | null) => void;
  onReceivingAccountChange: (id: string | null) => void;
  onAllocationsChange: (lines: AllocationGridLine[]) => void | Promise<void>;
  onPurposeChange?: (purpose: VoucherPurpose) => void;
  /** Shown as a currency choice when the purpose does not settle invoices. */
  onCurrencyChange?: (currencyId: string | null) => void;
  onCounterAccountChange?: (accountId: string | null) => void;
  onTargetAccountChange?: (accountId: string | null) => void;
}

export type { FinancialTransactionActivityEntry };
