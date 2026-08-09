"use client";

import { useEffect } from "react";

/**
 * The ONLY place in the entire app that calls `window.print()`. It only
 * ever runs on a `/print/*` route, whose document contains nothing but the
 * rendered template — never the app shell, sidebar, or toolbar — so
 * printing here can never "print the screen."
 */
export function useTriggerPrint(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      document.fonts.ready.then(() => window.print()).catch(() => window.print());
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
