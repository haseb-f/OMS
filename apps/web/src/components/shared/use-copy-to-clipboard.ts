"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";

/**
 * Writes `value` to the system clipboard. The async Clipboard API first
 * (secure contexts); then the legacy `execCommand("copy")` path, which still
 * works on a plain-http LAN deployment where `navigator.clipboard` is absent.
 * Resolves only when a write actually succeeded; rejects otherwise — callers
 * never claim "Copied" for a write that did not happen.
 */
export async function writeClipboardText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") throw new Error("clipboard unavailable");
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  // Off-screen and inert: never flashes, never scrolls the page.
  area.style.position = "fixed";
  area.style.insetInlineStart = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    const ok = typeof document.execCommand === "function" && document.execCommand("copy");
    if (!ok) throw new Error("clipboard unavailable");
  } finally {
    area.remove();
  }
}

export interface UseCopyToClipboardOptions {
  /** How long the "Copied" state lasts (ms). */
  resetAfterMs?: number;
  /**
   * Also confirm with a success toast — only for surfaces that have no button
   * of their own to show the check (e.g. a table cell copied by double-click).
   */
  successToast?: string;
}

/**
 * The one copy behaviour in OMS (R6 B2). `copied` turns true only after a
 * successful write and resets after `resetAfterMs`; a failed write shows an
 * accessible error toast with the reason (never a silent no-op). The copied
 * value is never logged or persisted.
 */
export function useCopyToClipboard({
  resetAfterMs = 2000,
  successToast,
}: UseCopyToClipboardOptions = {}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string | null | undefined): Promise<boolean> => {
      if (!value) return false;
      try {
        await writeClipboardText(value);
      } catch {
        setCopied(false);
        toast.error(t("controls.copy.failed"), { description: t("controls.copy.failedReason") });
        return false;
      }
      setCopied(true);
      if (successToast) toast.success(successToast);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetAfterMs);
      return true;
    },
    [t, successToast, resetAfterMs],
  );

  return { copy, copied };
}
