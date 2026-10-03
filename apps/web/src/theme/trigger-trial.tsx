"use client";

import { useEffect } from "react";

export type TriggerTrial = "a" | "b";

const SESSION_KEY = "oms.triggerTrial";

/** "a" | "b" → that trial; anything else → none (the canonical design). */
export function parseTriggerTrial(value: string | null | undefined): TriggerTrial | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "a" || normalized === "b" ? normalized : null;
}

/**
 * Resolves the Round 6 dropdown-trigger trial (theme/trigger-trial.css).
 * LOCAL ONLY: `NEXT_PUBLIC_TRIGGER_TRIAL` (never set on Vercel) wins; in
 * development `?triggerTrial=a|b` sets it for this tab (kept in
 * sessionStorage across navigation) and `?triggerTrial=off` clears it.
 * Nothing set → null → the canonical design, so a deployment is unchanged.
 */
export function resolveTriggerTrial({
  env,
  development,
  query,
  stored,
}: {
  env: string | undefined;
  development: boolean;
  query: string | null;
  stored: string | null;
}): { trial: TriggerTrial | null; store: TriggerTrial | "clear" | null } {
  const fromEnv = parseTriggerTrial(env);
  if (fromEnv) return { trial: fromEnv, store: null };
  if (!development) return { trial: null, store: null };
  if (query !== null) {
    const fromQuery = parseTriggerTrial(query);
    return { trial: fromQuery, store: fromQuery ?? "clear" };
  }
  return { trial: parseTriggerTrial(stored), store: null };
}

/** Sets `<html data-trigger-trial>`; renders nothing. */
export function TriggerTrialSwitch() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(SESSION_KEY);
    } catch {
      stored = null;
    }
    const { trial, store } = resolveTriggerTrial({
      env: process.env.NEXT_PUBLIC_TRIGGER_TRIAL,
      development: process.env.NODE_ENV === "development",
      query: new URLSearchParams(window.location.search).get("triggerTrial"),
      stored,
    });
    try {
      if (store === "clear") window.sessionStorage.removeItem(SESSION_KEY);
      else if (store) window.sessionStorage.setItem(SESSION_KEY, store);
    } catch {
      // Storage unavailable: the trial applies to this page only.
    }
    const root = document.documentElement;
    if (trial) root.dataset.triggerTrial = trial;
    else delete root.dataset.triggerTrial;
  }, []);
  return null;
}
