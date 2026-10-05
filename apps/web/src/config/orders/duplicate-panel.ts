import type {
  DuplicateCheckResult,
  DuplicateOrderSummary,
  DuplicateResolution,
} from "@/services/order-duplicates-service";

/**
 * Pure rules behind `DuplicateCustomerPanel` (Round 5 Spec 1B): what the
 * panel shows, which choice the user made, what that sends to the API and
 * whether submit must wait. The server re-runs the check on submit and
 * answers 409 when a required choice is missing, so this only decides UX.
 */

/** What the user chose in the panel. */
export type DuplicateChoice =
  /** Phone match: a new order for the existing customer. */
  | { kind: "NEW_ORDER"; customerId: string }
  /** Name match: it is that existing customer. */
  | { kind: "SAME_CUSTOMER"; customerId: string }
  /** Name match: a different person — a new customer. */
  | { kind: "DIFFERENT_CUSTOMER" }
  /** Phone match outside the caller's scope: create and send for review. */
  | { kind: "CONTINUE_WITH_REVIEW" };

export type DuplicatePanelMode = "none" | "known" | "phone" | "crossScope" | "name";

export interface DuplicatePanelState {
  status: "idle" | "checking" | "ready" | "failed";
  /** The check input key the result belongs to. */
  key: string;
  result: DuplicateCheckResult | null;
  choice: DuplicateChoice | null;
}

export const IDLE_DUPLICATE_STATE: DuplicatePanelState = {
  status: "idle",
  key: "",
  result: null,
  choice: null,
};

/** Shortest input worth checking: a phone with 8+ digits or a 3+ letter name. */
const MIN_PHONE_DIGITS = 8;
const MIN_NAME_LENGTH = 3;

/**
 * Stable key of the checkable input ("" = nothing to check yet). Digits only
 * for the phone (Arabic-Indic digits included), trimmed lower-cased name.
 */
export function duplicateCheckKey(input: {
  phone?: string | null;
  name?: string | null;
  countryId?: string | null;
}): string {
  const digits = toAsciiDigits(input.phone ?? "").replace(/\D/g, "");
  const name = (input.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const phonePart = digits.length >= MIN_PHONE_DIGITS ? digits : "";
  const namePart = name.length >= MIN_NAME_LENGTH ? name : "";
  if (!phonePart && !namePart) return "";
  return `${phonePart}|${namePart}|${phonePart ? (input.countryId ?? "") : ""}`;
}

function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function panelMode(result: DuplicateCheckResult | null): DuplicatePanelMode {
  if (!result || result.kind === "NONE") return "none";
  if (result.kind === "KNOWN") return "known";
  if (result.kind === "NAME") return result.candidates.length ? "name" : "none";
  return result.crossScope ? "crossScope" : "phone";
}

/** Whether the user must answer before submitting (a known customer with no orders is only shown). */
export function requiresChoice(result: DuplicateCheckResult | null): boolean {
  const mode = panelMode(result);
  return mode !== "none" && mode !== "known";
}

/** Every customer record a phone match can be answered with: the shown one, then the other records of the number. */
export function phoneMatchRecords(
  result: DuplicateCheckResult | null,
): Array<{ id: string; name: string; phoneMasked: string | null }> {
  if (result?.kind !== "PHONE" || result.crossScope) return [];
  return [result.customer, ...(result.alternatives ?? [])];
}

/** Is `choice` a valid answer to `result`? (A stale answer to an older result is not.) */
export function choiceFits(result: DuplicateCheckResult | null, choice: DuplicateChoice | null) {
  if (!choice) return false;
  switch (panelMode(result)) {
    case "phone":
      return (
        choice.kind === "NEW_ORDER" &&
        result?.kind === "PHONE" &&
        !result.crossScope &&
        phoneMatchRecords(result).some((record) => record.id === choice.customerId)
      );
    case "crossScope":
      return choice.kind === "CONTINUE_WITH_REVIEW";
    case "name":
      return (
        choice.kind === "DIFFERENT_CUSTOMER" ||
        (choice.kind === "SAME_CUSTOMER" &&
          result?.kind === "NAME" &&
          result.candidates.some((candidate) => candidate.id === choice.customerId))
      );
    default:
      return false;
  }
}

/** The `duplicateResolution` to send (undefined when there is nothing to answer). */
export function resolutionFor(state: DuplicatePanelState): DuplicateResolution | undefined {
  const { result, choice } = state;
  if (!choice || !choiceFits(result, choice)) return undefined;
  switch (choice.kind) {
    case "NEW_ORDER":
      return { decision: "INTENTIONAL_NEW_ORDER", customerId: choice.customerId };
    case "SAME_CUSTOMER":
      return { decision: "USE_EXISTING_CUSTOMER", customerId: choice.customerId };
    case "DIFFERENT_CUSTOMER":
      return { decision: "DIFFERENT_CUSTOMER" };
    case "CONTINUE_WITH_REVIEW":
      return { decision: "INTENTIONAL_NEW_ORDER" };
  }
}

/**
 * Submit waits while the check for the current input is still running (or
 * not started yet) and while a match is unanswered. A failed check never
 * blocks — the server still enforces the rule and the 409 reopens the panel.
 */
export function isSubmitBlocked(state: DuplicatePanelState, currentKey: string): boolean {
  if (!currentKey) return false;
  if (state.status === "failed" && state.key === currentKey) return false;
  if (state.key !== currentKey || state.status !== "ready") return true;
  return requiresChoice(state.result) && !choiceFits(state.result, state.choice);
}

/**
 * The choice that is already implied — e.g. the user picked this very
 * customer from the customer picker, or opened the form from "New order for
 * this customer". Only an exact id match counts.
 */
export function impliedChoice(
  result: DuplicateCheckResult | null,
  knownCustomerId: string | null | undefined,
): DuplicateChoice | null {
  if (!knownCustomerId || !result) return null;
  if (
    result.kind === "PHONE" &&
    !result.crossScope &&
    phoneMatchRecords(result).some((record) => record.id === knownCustomerId)
  ) {
    return { kind: "NEW_ORDER", customerId: knownCustomerId };
  }
  if (
    result.kind === "NAME" &&
    result.candidates.some((candidate) => candidate.id === knownCustomerId)
  ) {
    return { kind: "SAME_CUSTOMER", customerId: knownCustomerId };
  }
  return null;
}

/** Active / unfulfilled orders first, newest first within each group. */
export function sortOrdersForPanel(orders: DuplicateOrderSummary[]): DuplicateOrderSummary[] {
  return [...orders].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime(),
  );
}

/** The order "Open existing order" opens — the most relevant one. */
export function primaryExistingOrder(
  result: DuplicateCheckResult | null,
): DuplicateOrderSummary | null {
  if (result?.kind !== "PHONE" || result.crossScope) return null;
  return sortOrdersForPanel(result.orders)[0] ?? null;
}
