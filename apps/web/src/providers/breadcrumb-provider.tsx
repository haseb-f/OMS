"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface BreadcrumbContextValue {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/**
 * Backs the trailing, dynamic breadcrumb crumb a detail page (a Lead, a
 * Customer, ...) supplies for itself — the global nav config can only ever
 * describe its static list-page ancestor (`/crm/leads`), never a specific
 * record's number/name. `BreadcrumbBar` renders `label` as the final,
 * non-clickable crumb whenever `useCurrentNavigation()` resolved via an
 * ancestor prefix match rather than an exact one — see that hook's
 * `isExactMatch`.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbContext must be used within BreadcrumbProvider");
  }
  return ctx;
}

/** `BreadcrumbBar`'s own read side — not for page components, see `useBreadcrumbLabel` below. */
export function useBreadcrumbValue(): string | null {
  return useBreadcrumbContext().label;
}

/**
 * Call from a dynamic detail page (once its entity has loaded) to supply
 * the trailing breadcrumb crumb — e.g. `useBreadcrumbLabel(lead ?
 * \`${lead.leadNumber} — ${lead.customerName}\` : null)`. Automatically
 * cleared on unmount so a stale label never leaks into the next page
 * navigated to.
 */
export function useBreadcrumbLabel(label: string | null): void {
  const { setLabel } = useBreadcrumbContext();
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);
}
