import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  FinancialTransactionActivityEntry,
  FinancialTransactionRow,
  FinancialTransactionStatusValue,
} from "@/services/financial-transactions-service";
import type { AllocationGridLine } from "./allocation-grid";

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
  variant?: "default" | "outline" | "destructive" | "ghost";
  visibleForStatuses?: FinancialTransactionStatusValue[];
  onAction: (context: TransactionEditorActionContext) => void | Promise<void>;
}

export interface TransactionStatusOption {
  value: FinancialTransactionStatusValue;
  label: string;
  tone: "success" | "warning" | "destructive" | "info" | "neutral";
}

export interface FinancialTransactionEditorConfig {
  title: string;
  partyLabel: string;
  docCodePreview?: string;
  permissions: { create: string; edit: string; confirm: string; cancel: string };
  statusOptions: TransactionStatusOption[];
  workflowActions: TransactionWorkflowAction[];
  toolbarExtra?: ReactNode;
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
}

export interface FinancialTransactionEditorHandlers {
  onTransactionDateChange: (date: Date | null) => void;
  onAmountChange: (value: number) => void;
  onReferenceNumberChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onPaymentSourceChange: (id: string | null) => void;
  onReceivingAccountChange: (id: string | null) => void;
  onAllocationsChange: (lines: AllocationGridLine[]) => void;
}

export type { FinancialTransactionActivityEntry };
