import {
  BankTransactionMatchStatus,
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
  WorkflowType,
} from '@prisma/client';

/**
 * Single mapping layer: legacy enums → StatusDefinition codes.
 * StatusDefinition is the display/runtime authority; enums remain as
 * transitional write helpers until fully retired.
 */

export const ORDER_PAYMENT_STATUS_CODE: Record<
  StoreOrderPaymentStatus,
  string
> = {
  [StoreOrderPaymentStatus.PAYMENT_PENDING]: 'UNPAID',
  [StoreOrderPaymentStatus.PAYMENT_REVIEW]: 'PAYMENT_REPORTED',
  [StoreOrderPaymentStatus.PARTIALLY_PAID]: 'PARTIALLY_PAID',
  [StoreOrderPaymentStatus.FULLY_PAID_RECONCILED]: 'PAID',
  [StoreOrderPaymentStatus.OVERPAID]: 'OVERPAID',
  [StoreOrderPaymentStatus.UNMATCHED]: 'UNMATCHED',
};

export const ORDER_PAYMENT_CODE_TO_ENUM: Record<
  string,
  StoreOrderPaymentStatus
> = Object.fromEntries(
  Object.entries(ORDER_PAYMENT_STATUS_CODE).map(([enumKey, code]) => [
    code,
    enumKey as StoreOrderPaymentStatus,
  ]),
) as Record<string, StoreOrderPaymentStatus>;

export const FULFILLMENT_STAGE_CODE: Record<StoreOrderShippingStage, string> = {
  [StoreOrderShippingStage.NOT_READY]: 'UNFULFILLED',
  [StoreOrderShippingStage.READY_FOR_SHIPPING]: 'READY',
};

/** Matching StatusDefinition codes mirror BankTransactionMatchStatus 1:1. */
export const MATCHING_STATUS_CODE: Record<BankTransactionMatchStatus, string> =
  {
    [BankTransactionMatchStatus.UNMATCHED]: 'UNMATCHED',
    [BankTransactionMatchStatus.POTENTIAL]: 'POTENTIAL',
    [BankTransactionMatchStatus.PARTIALLY_MATCHED]: 'PARTIALLY_MATCHED',
    [BankTransactionMatchStatus.MATCHED]: 'MATCHED',
    [BankTransactionMatchStatus.DUPLICATE]: 'DUPLICATE',
    [BankTransactionMatchStatus.CONFLICT]: 'CONFLICT',
    [BankTransactionMatchStatus.MANUAL_REVIEW]: 'MANUAL_REVIEW',
  };

export const WORKFLOW_FOR_ORDER_PAYMENT = WorkflowType.PAYMENT;
export const WORKFLOW_FOR_FULFILLMENT = WorkflowType.FULFILLMENT;
export const WORKFLOW_FOR_MATCHING = WorkflowType.MATCHING;

/** Paid / ready-to-fulfill payment StatusDefinition codes. */
export const PAID_PAYMENT_CODES = new Set(['PAID', 'OVERPAID']);
