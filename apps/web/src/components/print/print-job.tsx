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

export function PrintJobExpired() {
  const { t } = useLocale();
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      {t("reportExport.printExpired")}
    </div>
  );
}
