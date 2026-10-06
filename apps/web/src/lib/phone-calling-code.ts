import { detectRegionFromInput, parsePhone } from "@/services/phone-service";

/**
 * The calling code of a phone field is the PHONE's own state (R13 A1, D-A1) —
 * never a copy of the address country. E.164 already carries it, so no
 * "phone country" column exists: on edit the code is read back from the stored
 * number; a country elsewhere on the form (address, customer country) only
 * PROPOSES a code while the user has neither chosen one nor entered a number.
 */

/**
 * The one proposal rule shared by every phone field (order entry R12 and the
 * partner / user forms): a proposed calling code may be applied only while the
 * user has not chosen a code and the field holds no number — an entered number
 * is never re-read under another code behind the user's back.
 */
export function canProposeCallingCode(input: { codeChosen: boolean; hasNumber: boolean }): boolean {
  return !input.codeChosen && !input.hasNumber;
}

/** ISO2 region of a stored international number (`+…`), or null (empty, national or unparseable). */
export function phoneValueRegion(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = parsePhone(raw, null);
  if (parsed.isValid && parsed.detectedRegion) return parsed.detectedRegion;
  return detectRegionFromInput(raw);
}

/**
 * What the field remembers about its own code.
 * - `chosen`: the code the user picked in the field, or the code that was in
 *   effect when they committed a number (`source: "typed"`) — either way it is
 *   no longer a proposal.
 * - `seenValue` / `committedValue`: tell the field's own commits apart from an
 *   outside change of the value (a form reset / another record loaded), which
 *   starts over from the new number.
 */
export interface OwnedCallingCodeState {
  chosen: string | null;
  source: "picked" | "typed" | null;
  seenValue: string;
  committedValue: string | null;
}

export function initialOwnedCallingCodeState(
  value: string | null | undefined,
): OwnedCallingCodeState {
  return { chosen: null, source: null, seenValue: value ?? "", committedValue: null };
}

/** The code the field reads its number with right now. */
export function resolveOwnedCallingCode(
  state: OwnedCallingCodeState,
  value: string | null | undefined,
  proposedCountryCode: string | null | undefined,
): string | null {
  if (state.chosen) return state.chosen;
  const stored = phoneValueRegion(value);
  if (stored) return stored;
  const hasNumber = !!value?.trim();
  if (canProposeCallingCode({ codeChosen: false, hasNumber })) return proposedCountryCode || null;
  // A legacy national number without a chosen code: the caller's default rule applies.
  return null;
}

/** The user picked a code in the field. */
export function pickCallingCode(state: OwnedCallingCodeState, iso2: string): OwnedCallingCodeState {
  return { ...state, chosen: iso2, source: "picked" };
}

/**
 * The field committed `next`. Committing a number fixes the code that was in
 * effect (an address change afterwards never re-reads it); clearing a number
 * whose code was only fixed by typing lets the proposal apply again.
 */
export function commitPhoneValue(
  state: OwnedCallingCodeState,
  next: string,
  codeInEffect: string | null,
): OwnedCallingCodeState {
  if (!next.trim()) {
    return state.source === "typed"
      ? { chosen: null, source: null, seenValue: next, committedValue: next }
      : { ...state, seenValue: next, committedValue: next };
  }
  if (state.chosen) return { ...state, seenValue: next, committedValue: next };
  return {
    chosen: phoneValueRegion(next) ?? codeInEffect,
    source: "typed",
    seenValue: next,
    committedValue: next,
  };
}

/**
 * Reconcile with the value the form now holds. Our own commit → unchanged; an
 * outside change (reset, record reload) → start over from that value.
 * Returns the same object when nothing changed.
 */
export function syncPhoneValue(
  state: OwnedCallingCodeState,
  value: string | null | undefined,
): OwnedCallingCodeState {
  const current = value ?? "";
  if (current === state.seenValue) return state;
  if (current === state.committedValue) return { ...state, seenValue: current };
  return initialOwnedCallingCodeState(current);
}
