import { useEffect, useState, type RefObject } from "react";

/**
 * Live content-box width of an element (null until first measured). Lets a
 * component adapt to the space it actually has — a dialog, a split pane —
 * rather than to the viewport breakpoint alone.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
