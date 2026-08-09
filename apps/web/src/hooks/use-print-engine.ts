"use client";

import { useCallback } from "react";
import { createPrintJob } from "@/lib/print-bridge";
import type { GenericListPrintPayload, DocumentPrintPayload } from "@/types/print-engine";

/**
 * The single entry point every module uses to print. Never call
 * `window.print()` directly from an app page — hand the data here instead,
 * and the Enterprise Print Engine renders it in an isolated `/print/*` tab
 * that contains only the business document (see `app/print/*`).
 */
export function usePrintEngine() {
  const printList = useCallback((payload: GenericListPrintPayload) => {
    const jobId = createPrintJob(payload);
    // No "noopener": the print tab depends on inheriting the opener's
    // sessionStorage (see print-bridge.ts) to read the job payload —
    // "noopener" severs that browsing-context relationship and the tab
    // would just see the job as "expired".
    window.open(`/print/list?job=${jobId}`, "_blank");
  }, []);

  const printDocument = useCallback((payload: DocumentPrintPayload) => {
    const jobId = createPrintJob(payload);
    window.open(`/print/document?job=${jobId}`, "_blank");
  }, []);

  return { printList, printDocument };
}
