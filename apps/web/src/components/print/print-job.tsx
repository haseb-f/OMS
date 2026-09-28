"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readPrintJob } from "@/lib/print-bridge";
import { useLocale } from "@/providers/locale-provider";

/**
 * Reads the print job named by `?job=` (written by `usePrintEngine`).
 * `undefined` while reading, `null` when missing or expired.
 */
export function usePrintJob<T>(): T | null | undefined {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const [payload, setPayload] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setPayload(jobId ? readPrintJob<T>(jobId) : null);
  }, [jobId]);
  return payload;
}

/**
 * No job to show: either the tab was opened ahead of its data (`?pending=1`,
 * see `usePrintEngine().runPrint` — the opener points it at the job once the
 * data is loaded, or closes it on failure), or the job expired.
 */
export function PrintJobExpired() {
  const { t } = useLocale();
  const pending = useSearchParams().get("pending") === "1";
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground"
    >
      {pending ? t("printDocument.preparing") : t("reportExport.printExpired")}
    </div>
  );
}
