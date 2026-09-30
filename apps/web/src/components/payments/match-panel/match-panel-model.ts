import type { StatusTone } from "@/components/business/status-tone";
import type { MessageKey } from "@/i18n/translate";
import { formatMoney } from "@/lib/money";
import type { PaymentReviewContext } from "@/services/payments-review-service";
import type {
  ClaimActiveMatch,
  MatchReason,
  StatementLineView,
} from "@/services/payment-reconciliation-service";

/**
 * Pure view-model of the payment match panel (Round 5 spec 3B/3C): what each
 * action would do (the exact effect sentence) and — when it cannot run — the
 * reason it is disabled. It mirrors the server's own refusals so the user
 * learns them before clicking; the server stays the authority for every one.
 */

const round2 = (value: number) => Math.round(value * 100) / 100;
const DAY_MS = 86_400_000;
/** Same window the server's suggestion scoring uses (suggestion.util DATE_WINDOW_DAYS). */
export const DATE_WINDOW_DAYS = 7;

export interface Sentence {
  key: MessageKey;
  params: Record<string, string>;
}

export interface ActionState {
  /** Null when the action may run; otherwise the tooltip reason. */
  disabledReason: MessageKey | null;
  effect: Sentence;
}

export interface MatchPanelPermissions {
  /** `sales.receipts.confirm` — confirm & post, reject, dispute from review. */
  canConfirm: boolean;
  /** `finance.payment-reconciliation.match`. */
  canMatch: boolean;
  /** `finance.payment-reconciliation.correct`. */
  canCorrect: boolean;
}

const OPEN_STATUSES = new Set(["PENDING", "MATCHED"]);

export function isOpenDeclaration(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

export function isSettled(settlementStatus: string | null | undefined): boolean {
  return settlementStatus === "SETTLED" || settlementStatus === "PARTIALLY_SETTLED";
}

/** Amount of the declaration not yet allocated to statement lines. */
export function claimRemaining(context: Pick<PaymentReviewContext, "amount" | "matchedAmount">) {
  return round2(context.amount - context.matchedAmount);
}

function money(amount: number, code: string | undefined) {
  return formatMoney(amount, code);
}

function accountLabel(context: PaymentReviewContext): string {
  return context.debitAccount ? `${context.debitAccount.code} ${context.debitAccount.name}` : "—";
}

function orderLabel(context: PaymentReviewContext): string {
  return context.storeOrder?.internalOrderId ?? "—";
}

// ── Discrepancy between the declaration and a statement line ───────────

export type Discrepancy =
  | { kind: "amount"; tone: StatusTone; key: MessageKey; params: { amount: string } }
  | { kind: "currency"; tone: StatusTone; key: MessageKey; params: { line: string; claim: string } }
  | { kind: "date"; tone: StatusTone; key: MessageKey; params: { days: string } };

export function dayGap(a: string | Date, b: string | Date): number {
  const dayA = Math.floor(new Date(a).getTime() / DAY_MS);
  const dayB = Math.floor(new Date(b).getTime() / DAY_MS);
  return Math.abs(dayA - dayB);
}

export function discrepancies(
  context: PaymentReviewContext,
  line: StatementLineView,
): Discrepancy[] {
  const result: Discrepancy[] = [];
  if (line.currency.id !== context.currency.id) {
    result.push({
      kind: "currency",
      tone: "destructive",
      key: "paymentVocabulary.panel.currencyMismatch",
      params: { line: line.currency.code, claim: context.currency.code },
    });
  } else {
    const difference = round2(line.remaining - claimRemaining(context));
    if (Math.abs(difference) >= 0.005) {
      result.push({
        kind: "amount",
        tone: "warning",
        key: "paymentVocabulary.panel.amountDifference",
        params: { amount: money(Math.abs(difference), context.currency.code) },
      });
    }
  }
  const days = dayGap(context.paymentDate, line.transactionDate);
  if (days > 0) {
    result.push({
      kind: "date",
      tone: days > DATE_WINDOW_DAYS ? "warning" : "neutral",
      key: "paymentVocabulary.panel.dateGap",
      params: { days: String(days) },
    });
  }
  return result;
}

/** Positive evidence chips (the negative signals are shown as discrepancies instead). */
const NEGATIVE = new Set(["AMOUNT_DIFFERS", "DATE_OUT_OF_WINDOW", "STATUS_UNVERIFIED", "CURRENCY"]);
export function matchedSignals(reasons: MatchReason[] | null | undefined): MatchReason[] {
  return (reasons ?? []).filter((reason) => !NEGATIVE.has(reason.signal));
}

// ── Actions ─────────────────────────────────────────────────────────────

/** Why a declaration cannot be decided from review at all (null ⇒ it can). */
function decisionBlock(context: PaymentReviewContext): MessageKey | null {
  if (context.status === "VERIFIED") {
    return isSettled(context.settlementStatus)
      ? "paymentVocabulary.reason.settled"
      : "paymentVocabulary.reason.alreadyPosted";
  }
  if (!isOpenDeclaration(context.status)) return "paymentVocabulary.reason.notOpen";
  if (context.destinationOwnership === "AGENT") return "paymentVocabulary.reason.agentCollection";
  return null;
}

/** "Confirm & post" from review — non-reconciled methods only (the server refuses the others). */
export function confirmPostState(
  context: PaymentReviewContext,
  permissions: MatchPanelPermissions,
): ActionState {
  const blocked =
    decisionBlock(context) ??
    (!context.storeOrder
      ? "paymentVocabulary.reason.noOrder"
      : context.method?.requiresReconciliation
        ? "paymentVocabulary.reason.reconciledMethod"
        : context.storeOrder.currency.id !== context.currency.id
          ? "paymentVocabulary.reason.currencyDiffers"
          : !context.debitAccount
            ? "paymentVocabulary.reason.noDebitAccount"
            : context.orderSettlement && context.orderSettlement.total <= 0
              ? "paymentVocabulary.reason.missingPrice"
              : !permissions.canConfirm
                ? "paymentVocabulary.reason.noPermission"
                : null);
  return {
    disabledReason: blocked,
    effect: confirmPostSentence({
      amount: context.amount,
      currencyCode: context.currency.code,
      account: accountLabel(context),
      order: orderLabel(context),
    }),
  };
}

/** The Confirm & post effect sentence — shared by the panel and the review row confirmation. */
export function confirmPostSentence(input: {
  amount: number | string;
  currencyCode: string | undefined;
  account: string;
  order: string;
}): Sentence {
  return {
    key: "paymentVocabulary.effect.confirmPost",
    params: {
      amount: money(Number(input.amount), input.currencyCode),
      account: input.account,
      order: input.order,
    },
  };
}

/** Amount a match with this line allocates: as much as both sides still have open. */
export function allocationAmount(context: PaymentReviewContext, line: StatementLineView): number {
  return Math.max(round2(Math.min(line.remaining, claimRemaining(context))), 0);
}

/** "Confirm match & post" in the panel — an explicit, reviewed pick of one statement line. */
export function confirmMatchState(
  context: PaymentReviewContext,
  line: StatementLineView | null,
  permissions: MatchPanelPermissions,
): ActionState {
  const amount = line ? allocationAmount(context, line) : 0;
  const posts = !!line && Math.abs(amount - claimRemaining(context)) < 0.005;
  const blocked =
    decisionBlock(context) ??
    (!line
      ? "paymentVocabulary.reason.noLine"
      : line.currency.id !== context.currency.id
        ? "paymentVocabulary.reason.currencyDiffers"
        : !context.storeOrder
          ? "paymentVocabulary.reason.noOrder"
          : !context.debitAccount
            ? "paymentVocabulary.reason.noDebitAccount"
            : !permissions.canMatch
              ? "paymentVocabulary.reason.noPermission"
              : null);
  const reference = line?.providerReference ?? line?.orderReference ?? "—";
  return {
    disabledReason: blocked,
    effect: posts
      ? {
          key: "paymentVocabulary.effect.matchPost",
          params: {
            amount: money(amount, context.currency.code),
            reference,
            payment: context.paymentNumber,
            account: accountLabel(context),
            order: orderLabel(context),
          },
        }
      : {
          key: "paymentVocabulary.effect.matchPartial",
          params: {
            amount: money(amount, context.currency.code),
            reference,
            payment: context.paymentNumber,
            remaining: money(round2(claimRemaining(context) - amount), context.currency.code),
          },
        },
  };
}

function declarationParams(context: PaymentReviewContext) {
  return {
    payment: context.paymentNumber,
    amount: money(context.amount, context.currency.code),
    order: orderLabel(context),
  };
}

/** Reject declaration (reason required) — never for a posted payment, never while statement matches stand. */
export function rejectState(
  context: PaymentReviewContext,
  permissions: MatchPanelPermissions,
): ActionState {
  const blocked =
    decisionBlock(context) ??
    (context.activeMatchCount > 0
      ? "paymentVocabulary.reason.activeMatches"
      : !permissions.canConfirm
        ? "paymentVocabulary.reason.noPermission"
        : null);
  return {
    disabledReason: blocked,
    effect: { key: "paymentVocabulary.effect.reject", params: declarationParams(context) },
  };
}

export function disputeState(
  context: PaymentReviewContext,
  permissions: MatchPanelPermissions,
): ActionState {
  const blocked =
    decisionBlock(context) ??
    (!context.storeOrder
      ? "paymentVocabulary.reason.noOrder"
      : context.activeMatchCount > 0
        ? "paymentVocabulary.reason.activeMatches"
        : !permissions.canConfirm
          ? "paymentVocabulary.reason.noPermission"
          : null);
  return {
    disabledReason: blocked,
    effect: { key: "paymentVocabulary.effect.dispute", params: declarationParams(context) },
  };
}

/**
 * Unmatch vs Reverse posting for one active match — the server tells which
 * (`reversalEffect`); a reversal names the receipt and the journal entry.
 */
export function correctionState(
  context: PaymentReviewContext,
  match: ClaimActiveMatch,
  posting: {
    receipt: { transactionNumber: string } | null;
    journalEntry: { entryNumber: string } | null;
  },
  permissions: MatchPanelPermissions,
): ActionState & { intent: "unmatch" | "reversePosting"; journal: string | null } {
  const reverse = match.reversalEffect === "REVERSE_POSTING";
  const blocked = match.settled
    ? "paymentVocabulary.reason.settled"
    : !permissions.canCorrect
      ? "paymentVocabulary.reason.noPermission"
      : null;
  const reference = match.line.providerReference ?? match.line.orderReference ?? "—";
  const amount = money(match.amount, match.line.currency.code);
  return {
    intent: reverse ? "reversePosting" : "unmatch",
    journal: reverse ? (posting.journalEntry?.entryNumber ?? null) : null,
    disabledReason: blocked,
    effect: reverse
      ? {
          key: "paymentVocabulary.effect.reversePosting",
          params: {
            receipt: posting.receipt?.transactionNumber ?? "—",
            journal: posting.journalEntry?.entryNumber ?? "—",
            amount,
            reference,
            payment: context.paymentNumber,
          },
        }
      : {
          key: "paymentVocabulary.effect.unmatch",
          params: { amount, reference, payment: context.paymentNumber },
        },
  };
}

/** Refund is a separate flow for money actually posted — never a way to undo a declaration. */
export function refundState(context: PaymentReviewContext): ActionState {
  return {
    disabledReason: context.status === "VERIFIED" ? null : "paymentVocabulary.reason.notPosted",
    effect: { key: "paymentVocabulary.effect.refund", params: {} },
  };
}

/** The line the panel starts on: the first active match, else an unambiguous top suggestion. */
export function initialLineId(
  lines: {
    activeMatches: { line: { id: string } }[];
    candidates: { line: { id: string } }[];
    ambiguous: boolean;
  } | null,
): string | null {
  if (!lines) return null;
  if (lines.activeMatches[0]) return lines.activeMatches[0].line.id;
  if (!lines.ambiguous && lines.candidates[0]) return lines.candidates[0].line.id;
  return null;
}
