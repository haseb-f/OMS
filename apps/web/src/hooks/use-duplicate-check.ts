"use client";

import { useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  IDLE_DUPLICATE_STATE,
  choiceFits,
  duplicateCheckKey,
  impliedChoice,
  isSubmitBlocked,
  resolutionFor,
  type DuplicateChoice,
  type DuplicatePanelState,
} from "@/config/orders/duplicate-panel";
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from "@/services/order-duplicates-service";

/** Waits for a typing pause before asking the server (phone numbers are typed in bursts). */
export const DUPLICATE_CHECK_DEBOUNCE_MS = 500;

/**
 * Round 5 Spec 1B — the debounced duplicate check behind
 * `DuplicateCustomerPanel`: runs `check` for the current phone / name,
 * keeps the user's answer while it still fits, and exposes the
 * `duplicateResolution` to send plus whether submit must wait.
 */
export function useDuplicateCheck({
  phone,
  name,
  countryId,
  enabled,
  check,
  knownCustomerId,
}: {
  phone?: string | null;
  name?: string | null;
  countryId?: string | null;
  enabled: boolean;
  /** A stable service function (module-level), e.g. `orderDuplicatesService.check`. */
  check: (input: DuplicateCheckInput) => Promise<DuplicateCheckResult>;
  /** A customer the user already picked explicitly — its match needs no second answer. */
  knownCustomerId?: string | null;
}) {
  const key = enabled ? duplicateCheckKey({ phone, name, countryId }) : "";
  const payload = key
    ? JSON.stringify({
        key,
        phone: phone?.trim() || undefined,
        name: name?.trim() || undefined,
        countryId: countryId || undefined,
      })
    : "";
  const debounced = useDebouncedValue(payload, DUPLICATE_CHECK_DEBOUNCE_MS);
  const [state, setState] = useState<DuplicatePanelState>(IDLE_DUPLICATE_STATE);

  useEffect(() => {
    if (!debounced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(IDLE_DUPLICATE_STATE);
      return;
    }
    const { key: checkedKey, ...input } = JSON.parse(debounced) as DuplicateCheckInput & {
      key: string;
    };
    let cancelled = false;
    setState((prev) => ({
      status: "checking",
      key: checkedKey,
      result: prev.result,
      choice: prev.choice,
    }));
    check(input)
      .then((result) => {
        if (cancelled) return;
        setState((prev) => ({
          status: "ready",
          key: checkedKey,
          result,
          choice:
            impliedChoice(result, knownCustomerId) ??
            (choiceFits(result, prev.choice) ? prev.choice : null),
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "failed", key: checkedKey, result: null, choice: null });
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, check, knownCustomerId]);

  const choose = useCallback(
    (choice: DuplicateChoice | null) => setState((prev) => ({ ...prev, choice })),
    [],
  );

  /** A 409 `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED` reopens the panel with the server's payload. */
  const applyServerResult = useCallback(
    (result: DuplicateCheckResult) =>
      setState({
        status: "ready",
        key,
        result,
        choice: impliedChoice(result, knownCustomerId),
      }),
    [key, knownCustomerId],
  );

  // The panel keeps the latest result while a re-check for new input runs.
  return {
    state: key ? state : IDLE_DUPLICATE_STATE,
    blocked: isSubmitBlocked(state, key),
    resolution: state.key === key ? resolutionFor(state) : undefined,
    choose,
    applyServerResult,
  };
}
