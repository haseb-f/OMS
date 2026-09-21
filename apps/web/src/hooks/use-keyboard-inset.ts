"use client";

import { useEffect, useState } from "react";

/**
 * Height (px) the on-screen keyboard currently covers at the bottom of the
 * layout viewport. Fixed bottom bars add it to `bottom` so the primary
 * action stays above the keyboard instead of hiding behind it (iOS Safari
 * and Android Chrome both shrink only the visual viewport).
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
