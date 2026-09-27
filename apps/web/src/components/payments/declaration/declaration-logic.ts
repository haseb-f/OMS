/**
 * Pure rules behind the shared payment declaration UI (Sales + Finance).
 * The server re-validates everything; this only keeps the form honest:
 * FULL never asks for an amount, PARTIAL never exceeds what remains, and a
 * paid declaration always carries a method and an actual date.
 */

export type DeclarationKind = "UNPAID" | "FULL" | "PARTIAL";
export type DeclaredPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export interface DeclarationFormState {
  kind: DeclarationKind;
  /** PARTIAL only — raw input text. */
  amount: string;
  paymentMethodId: string;
  /** YYYY-MM-DD */
  paymentDate: string;
  referenceNumber: string;
  stagedAttachmentIds: string[];
}

export type DeclarationError =
  | "amountRequired"
  | "amountExceeds"
  | "methodRequired"
  | "dateRequired"
  | "dateFuture"
  | "nothingRemaining"
  | "zeroTotal";

export interface DeclarationPayload {
  kind: DeclarationKind;
  amount?: number;
  paymentMethodId?: string;
  currencyId?: string;
  paymentDate?: string;
  referenceNumber?: string;
  stagedAttachmentIds?: string[];
}

const EPSILON = 0.005;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function emptyDeclaration(
  kind: DeclarationKind = "FULL",
  now: Date = new Date(),
): DeclarationFormState {
  return {
    kind,
    amount: "",
    paymentMethodId: "",
    paymentDate: todayISO(now),
    referenceNumber: "",
    stagedAttachmentIds: [],
  };
}

/** What can still be declared: validated total minus standing (non-rejected, non-disputed) claims. */
export function remainingDeclarable(total: number, alreadyDeclared: number): number {
  return Math.max(roundMoney(total - alreadyDeclared), 0);
}

/** The amount a declaration will record (FULL = the whole remainder — never re-entered). */
export function declarationAmount(state: DeclarationFormState, remaining: number): number {
  if (state.kind === "FULL") return roundMoney(remaining);
  if (state.kind === "PARTIAL") return roundMoney(Number(state.amount) || 0);
  return 0;
}

export function validateDeclaration(
  state: DeclarationFormState,
  ctx: { total: number; remaining: number; today?: string },
): DeclarationError | null {
  if (state.kind === "UNPAID") return null;
  if (ctx.total <= EPSILON) return "zeroTotal";
  if (ctx.remaining <= EPSILON) return "nothingRemaining";
  if (state.kind === "PARTIAL") {
    const amount = declarationAmount(state, ctx.remaining);
    if (!(amount > 0)) return "amountRequired";
    if (amount > ctx.remaining + EPSILON) return "amountExceeds";
  }
  if (!state.paymentMethodId) return "methodRequired";
  if (!state.paymentDate) return "dateRequired";
  if (state.paymentDate > (ctx.today ?? todayISO())) return "dateFuture";
  return null;
}

/** Declared status the order would show after this declaration. */
export function projectedDeclaredStatus(
  total: number,
  alreadyDeclared: number,
  added: number,
): DeclaredPaymentStatus {
  const declared = roundMoney(alreadyDeclared + added);
  if (total > EPSILON && declared + EPSILON >= total) return "PAID";
  if (declared > EPSILON) return "PARTIALLY_PAID";
  return "UNPAID";
}

export function buildDeclarationPayload(
  state: DeclarationFormState,
  currencyId: string | undefined,
): DeclarationPayload {
  if (state.kind === "UNPAID") return { kind: "UNPAID" };
  return {
    kind: state.kind,
    amount: state.kind === "PARTIAL" ? roundMoney(Number(state.amount) || 0) : undefined,
    paymentMethodId: state.paymentMethodId,
    currencyId,
    paymentDate: state.paymentDate,
    referenceNumber: state.referenceNumber.trim() || undefined,
    stagedAttachmentIds: state.stagedAttachmentIds.length ? state.stagedAttachmentIds : undefined,
  };
}

/** One key per dialog open — a retry or double click reuses it, so the server keeps one claim. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
