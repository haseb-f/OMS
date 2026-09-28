"use client";

import { useCallback } from "react";
import { createPrintJob, PrintJobStorageError } from "@/lib/print-bridge";
import { reportApiError, toast } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type {
  DocumentPrintPayload,
  GenericListPrintPayload,
  PackageSlipPayload,
  StatementPrintPayload,
} from "@/types/print-engine";

type PrintRoute = "list" | "document" | "slip";
type RoutePayload = {
  list: GenericListPrintPayload;
  document: DocumentPrintPayload | StatementPrintPayload;
  slip: PackageSlipPayload;
};

/** `/print/<route>` for a job, or the "preparing…" placeholder. */
export function printRouteUrl(route: PrintRoute, jobId?: string): string {
  return jobId ? `/print/${route}?job=${jobId}` : `/print/${route}?pending=1`;
}

/**
 * The single entry point every module uses to print. Never call
 * `window.print()` directly from an app page — hand the data here instead,
 * and the Enterprise Print Engine renders it in an isolated `/print/*` tab
 * that contains only the business document and its print preview toolbar
 * (see `app/print/*`).
 *
 * Popup rules: the preview tab is opened synchronously inside the user's
 * click, BEFORE any data is awaited (a `window.open` after an `await` is
 * blocked silently). It shows "preparing…" until the job exists, then is
 * pointed at it. If the browser still blocks the tab, a toast offers an
 * "Open print preview" button (a fresh user gesture). Every outcome is
 * visible: a success toast, a storage error, or the loader's API error.
 */
export function usePrintEngine() {
  const { t } = useLocale();

  /** Stores the job; on failure closes `tab` and says why. */
  const storeJob = useCallback(
    (payload: unknown, tab: Window | null): string | null => {
      try {
        return createPrintJob(payload);
      } catch (error) {
        tab?.close();
        if (error instanceof PrintJobStorageError) toast.error(t("printDocument.storageFailed"));
        else reportApiError(error, "printDocument.previewFailed");
        return null;
      }
    },
    [t],
  );

  /** Success toast, or — when the browser blocked the tab — a toast with a fresh-gesture button. */
  const announce = useCallback(
    (url: string, opened: boolean) => {
      if (opened) {
        toast.success(t("printDocument.previewOpened"));
        return;
      }
      toast.warning(t("printDocument.popupBlocked"), {
        duration: 30000,
        action: {
          label: t("printDocument.openPreview"),
          onClick: () => {
            if (!window.open(url, "_blank")) toast.error(t("printDocument.popupBlocked"));
          },
        },
      });
    },
    [t],
  );

  /** Hands a ready payload to the already-open `tab` (async path). */
  const deliver = useCallback(
    <R extends PrintRoute>(route: R, payload: RoutePayload[R], tab: Window | null) => {
      const jobId = storeJob(payload, tab);
      if (!jobId) return;
      const url = printRouteUrl(route, jobId);
      const opened = !!tab && !tab.closed;
      if (opened) tab.location.replace(url);
      announce(url, opened);
    },
    [announce, storeJob],
  );

  /** Synchronous path: the data is in hand, so the tab opens straight on the job. */
  const openNow = useCallback(
    <R extends PrintRoute>(route: R, payload: RoutePayload[R]) => {
      const jobId = storeJob(payload, null);
      if (!jobId) return;
      const url = printRouteUrl(route, jobId);
      announce(url, !!window.open(url, "_blank"));
    },
    [announce, storeJob],
  );

  /**
   * Opens the preview tab now (in the click), awaits `load`, then shows the
   * result. On a load failure the tab is closed and the API reason shown.
   * Never rejects — safe to call as `void runPrint(...)`.
   */
  const runPrint = useCallback(
    async <R extends PrintRoute>(
      route: R,
      load: () => Promise<RoutePayload[R] | null | undefined>,
      errorFallback: Parameters<typeof reportApiError>[1] = "errors.loadFailed",
    ): Promise<void> => {
      const tab = window.open(printRouteUrl(route), "_blank");
      const loadingToast = toast.loading(t("printDocument.preparing"));
      try {
        const payload = await load();
        if (!payload) {
          tab?.close();
          return;
        }
        deliver(route, payload, tab);
      } catch (error) {
        tab?.close();
        reportApiError(error, errorFallback);
      } finally {
        toast.dismiss(loadingToast);
      }
    },
    [deliver, t],
  );

  const printList = useCallback(
    (payload: GenericListPrintPayload) => openNow("list", payload),
    [openNow],
  );

  const printDocument = useCallback(
    (payload: DocumentPrintPayload | StatementPrintPayload) => openNow("document", payload),
    [openNow],
  );

  /** Store-order A5 package slip. */
  const printSlip = useCallback(
    (payload: PackageSlipPayload) => openNow("slip", payload),
    [openNow],
  );

  return { printList, printDocument, printSlip, runPrint };
}
