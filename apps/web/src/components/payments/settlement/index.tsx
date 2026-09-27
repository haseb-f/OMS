"use client";

/**
 * CONTRACT (payment-declaration-reconciliation): the reconciliation workspace
 * (IMPL-REC) renders these two tabs for a payment method; IMPL-SET owns this
 * folder and replaces the placeholders.
 */
export function AwaitingSettlementTab({ methodId }: { methodId: string }) {
  return <div data-testid="awaiting-settlement-tab" data-method-id={methodId} />;
}

export function SettlementsTab({ methodId }: { methodId: string }) {
  return <div data-testid="settlements-tab" data-method-id={methodId} />;
}
