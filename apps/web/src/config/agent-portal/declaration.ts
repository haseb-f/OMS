import {
  declarationAmount,
  emptyDeclaration,
  roundMoney,
  validateDeclaration,
  type DeclarationError,
  type DeclarationKind,
} from "@/components/payments/declaration/declaration-logic";
import type { DeclarationInput } from "@/services/agent-portal-service";

/**
 * Agent-portal payment declaration (spec §6.2): the shared declaration rules
 * (FULL = the remaining payable, never re-entered; PARTIAL ≤ remaining; a
 * paid declaration needs a date that is not in the future) with the agent's
 * authorized payment DESTINATION in place of a payment method.
 */
export interface AgentDeclarationState {
  kind: DeclarationKind;
  /** PARTIAL only — raw input text. */
  amount: string;
  destinationId: string;
  /** YYYY-MM-DD */
  paymentDate: string;
  reference: string;
}

export function emptyAgentDeclaration(now: Date = new Date()): AgentDeclarationState {
  const base = emptyDeclaration("FULL", now);
  return {
    kind: base.kind,
    amount: "",
    destinationId: "",
    paymentDate: base.paymentDate,
    reference: "",
  };
}

function asShared(state: AgentDeclarationState) {
  return {
    kind: state.kind,
    amount: state.amount,
    paymentMethodId: state.destinationId,
    paymentDate: state.paymentDate,
    referenceNumber: state.reference,
    stagedAttachmentIds: [],
  };
}

/** `methodRequired` means "choose the destination" here. */
export function validateAgentDeclaration(
  state: AgentDeclarationState,
  ctx: { total: number; remaining: number; today?: string },
): DeclarationError | null {
  return validateDeclaration(asShared(state), ctx);
}

/** The amount the declaration records (FULL = everything that remains). */
export function agentDeclarationAmount(state: AgentDeclarationState, remaining: number): number {
  return declarationAmount(asShared(state), remaining);
}

export function buildAgentDeclarationPayload(
  state: AgentDeclarationState,
  stagedAttachmentIds: string[],
  idempotencyKey: string,
): DeclarationInput {
  if (state.kind === "UNPAID") return { kind: "UNPAID", idempotencyKey };
  return {
    kind: state.kind,
    ...(state.kind === "PARTIAL" ? { amount: roundMoney(Number(state.amount) || 0) } : {}),
    destinationId: state.destinationId,
    paymentDate: state.paymentDate,
    ...(state.reference.trim() ? { reference: state.reference.trim() } : {}),
    ...(stagedAttachmentIds.length ? { stagedAttachmentIds } : {}),
    idempotencyKey,
  };
}
