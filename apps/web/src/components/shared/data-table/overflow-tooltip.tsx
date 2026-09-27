"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Overflow-only tooltips for dense grids (design-system §6 "Truncation").
 *
 * A Radix Tooltip per cell is hundreds of live instances on every list. This
 * region instead runs ONE tooltip for everything inside it:
 *
 * - any element marked `data-overflow-tip` is a candidate (the attribute
 *   value, when non-empty, is the full text; otherwise its textContent);
 * - on pointer-enter / focus the element is measured, and only a clipped
 *   element (its own box or a `.truncate` descendant) opens the tooltip;
 * - clipped elements are made keyboard-reachable (`tabindex=0`) by one scan
 *   per layout change (`scanKey` + a ResizeObserver), so the full value is
 *   reachable without a mouse. Screen readers already get the full text —
 *   truncation is visual only.
 */

const OverflowTooltipContext = createContext(false);

/** True inside an `OverflowTooltipRegion` — lets `TruncateText` skip its own Tooltip. */
export function useInOverflowTooltipRegion() {
  return useContext(OverflowTooltipContext);
}

const CANDIDATE_SELECTOR = "[data-overflow-tip]";
const CLIPPING_DESCENDANTS = ".truncate, .line-clamp-2";
const INTERACTIVE_DESCENDANTS = "a[href], button, input, select, textarea, [tabindex]";
const FOCUSABLE_MARK = "data-overflow-focusable";

function isClipped(el: Element) {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/** Whether the element (or a truncating descendant) is visually cutting its text. */
export function isElementOverflowing(el: HTMLElement): boolean {
  if (isClipped(el)) return true;
  for (const child of el.querySelectorAll(CLIPPING_DESCENDANTS)) {
    if (isClipped(child)) return true;
  }
  return false;
}

type TipState = { el: HTMLElement; text: string; rect: DOMRect };

export function OverflowTooltipRegion({
  children,
  scanKey,
  onScroll,
  ...props
}: ComponentProps<"div"> & {
  /** Any value that changes when the rendered cells change (rows, columns, widths, density). */
  scanKey?: unknown;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [tip, setTipState] = useState<TipState | null>(null);
  // Mirrors `tip` for the event handlers, written only alongside the state.
  const tipRef = useRef<TipState | null>(null);
  const setTip = useCallback((next: TipState | null) => {
    tipRef.current = next;
    setTipState(next);
  }, []);

  const hide = useCallback(() => setTip(null), [setTip]);

  const show = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(CANDIDATE_SELECTOR);
      if (!el || !regionRef.current?.contains(el)) return;
      if (tipRef.current?.el === el) return;
      if (!isElementOverflowing(el)) {
        if (tipRef.current) setTip(null);
        return;
      }
      const text = (el.dataset.overflowTip || el.textContent || "").trim();
      if (!text) return;
      setTip({ el, text, rect: el.getBoundingClientRect() });
    },
    [setTip],
  );

  // Keyboard reachability: only clipped candidates become tab stops.
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    let frame = 0;
    const scan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const el of region.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
          const marked = el.hasAttribute(FOCUSABLE_MARK);
          if (!marked && (el.hasAttribute("tabindex") || el.querySelector(INTERACTIVE_DESCENDANTS)))
            continue;
          const overflowing = isElementOverflowing(el);
          if (overflowing && !marked) {
            el.setAttribute("tabindex", "0");
            el.setAttribute(FOCUSABLE_MARK, "");
          } else if (!overflowing && marked) {
            el.removeAttribute("tabindex");
            el.removeAttribute(FOCUSABLE_MARK);
          }
        }
      });
    };
    scan();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scan);
    observer?.observe(region);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [scanKey]);

  // An open tooltip is anchored to a measured rect — any scroll, resize or
  // Escape closes it rather than leaving it floating over the wrong cell.
  useEffect(() => {
    if (!tip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKey);
    };
  }, [tip, hide]);

  return (
    <OverflowTooltipContext.Provider value>
      <div
        ref={regionRef}
        onPointerOver={(event) => {
          if (event.pointerType === "touch") return;
          show(event.target);
        }}
        onPointerOut={(event) => {
          const current = tipRef.current;
          if (!current) return;
          const next = event.relatedTarget;
          if (next instanceof Node && current.el.contains(next)) return;
          hide();
        }}
        onFocus={(event) => show(event.target)}
        onBlur={hide}
        onScroll={(event) => {
          hide();
          onScroll?.(event);
        }}
        {...props}
      >
        {children}
      </div>
      {tip ? (
        <Tooltip open onOpenChange={(open) => !open && hide()}>
          <TooltipTrigger asChild>
            {/* Physical coordinates of the measured cell — geometry, not layout direction. */}
            <span
              aria-hidden
              className="pointer-events-none fixed"
              style={{
                top: tip.rect.top,
                left: tip.rect.left,
                width: tip.rect.width,
                height: tip.rect.height,
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs whitespace-normal break-words text-start">
            {tip.text}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </OverflowTooltipContext.Provider>
  );
}
