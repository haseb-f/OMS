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
    // Payload is in localStorage (see print-bridge.ts) so the print tab
    // works even when the browser opens with noopener / without opener.
    window.open(`/print/list?job=${jobId}`, "_blank");
  }, []);

  const printDocument = useCallback((payload: DocumentPrintPayload) => {
    const jobId = createPrintJob(payload);
    window.open(`/print/document?job=${jobId}`, "_blank");
  }, []);

  return { printList, printDocument };
}
