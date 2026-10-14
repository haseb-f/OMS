"use client";

import { useEffect, useRef } from "react";

/**
 * R22 §5 — freshness without a query cache. A successful money operation
 * (voucher confirm / allocate / unallocate / cancel, refund) calls
 * `notifyDataChanged("settlement")`; every view that shows paid / remaining
 * figures (invoice detail + lists, statements, customer / supplier profile
 * panels, dashboard) refetches through `useDataChanged`. The signal reaches
 * this tab directly and other tabs through a BroadcastChannel; a tab the
 * person returns to (window focus / becoming visible) refetches as well, so
 * a change made elsewhere is never shown stale.
 */
export type DataTopic = "settlement";

const CHANNEL_NAME = "oms:data-changed";
const LOCAL_EVENT = "oms:data-changed";
/** A return to the tab refetches at most this often (focus + visibilitychange fire together). */
const RETURN_THROTTLE_MS = 1000;

let channel: BroadcastChannel | null | undefined;
function sharedChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel =
    typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(CHANNEL_NAME)
      : null;
  // Node / test runtimes: never keep the process alive for this hint channel.
  (channel as unknown as { unref?: () => void } | null)?.unref?.();
  return channel;
}

/** Tell every open view (this tab and the others) that `topic` data changed. */
export function notifyDataChanged(topic: DataTopic): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DataTopic>(LOCAL_EVENT, { detail: topic }));
  try {
    sharedChannel()?.postMessage({ topic });
  } catch {
    // A closed / unavailable channel only loses the cross-tab hint.
  }
}

/**
 * Runs `onChange` whenever `topic` changes (here or in another tab) and when
 * the person comes back to this tab. `enabled = false` pauses it (e.g. no
 * record loaded yet).
 */
export function useDataChanged(topic: DataTopic, onChange: () => void, enabled = true): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let lastReturn = 0;
    const run = () => callback.current();
    const onReturn = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastReturn < RETURN_THROTTLE_MS) return;
      lastReturn = now;
      run();
    };
    const onLocal = (event: Event) => {
      if ((event as CustomEvent<DataTopic>).detail === topic) run();
    };
    const onMessage = (event: MessageEvent<{ topic?: DataTopic }>) => {
      if (event.data?.topic === topic) run();
    };
    const bus = sharedChannel();
    window.addEventListener(LOCAL_EVENT, onLocal);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    bus?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener(LOCAL_EVENT, onLocal);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      bus?.removeEventListener("message", onMessage);
    };
  }, [topic, enabled]);
}
