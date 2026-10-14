"use client";

import { useEffect, useState } from "react";
import { loadFunctionalCurrency } from "@/components/accounting/financial-report/use-report-format";

/**
 * The functional (base) currency code — Settings → Accounting, never a code
 * default (OMS.md, Round 7). One cached request per session, shared with the
 * financial reports. `enabled = false` skips the request (the caller already
 * knows the currency). "" while unknown or not readable for this user.
 */
export function useFunctionalCurrencyCode(enabled = true): string {
  const [code, setCode] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadFunctionalCurrency().then((value) => {
      if (!cancelled) setCode(value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? code : "";
}
