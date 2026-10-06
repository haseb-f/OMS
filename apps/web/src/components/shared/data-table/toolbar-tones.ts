import { useLayoutEffect, useRef } from "react";

/**
 * Toolbar tonal sequence (design-system §12.15).
 *
 * The ordinary controls of a list toolbar — filter triggers, entity /
 * employee comboboxes, date pickers, labelled menu triggers (Columns), plain
 * selects and secondary outline buttons — are numbered 1…N in DOM order and
 * carry that number as `data-toolbar-tone`. `theme/recipes.css` maps each
 * number to one step of the blue ramp (`--toolbar-tone-*` in globals.css).
 *
 * DOM order is logical order and the ramp is ordered light → deep (tone 1 =
 * lightest, Round 13 D-A3), so in RTL the lightest step sits on the right and
 * the row darkens leftward; in LTR it is mirrored (lightest on the left) — no
 * direction logic here. Numbering counts every eligible control, including ones a
 * responsive class currently hides (the phone "Filters" button, the inline
 * filter group): hiding, wrapping or overflowing therefore never recolours
 * the controls that remain, and a control keeps its shade at every width.
 *
 * Never numbered (and never counted, so their coming and going is just as
 * stable): anything inside the bulk-action strip, anything under
 * `data-tone-exempt`, pressed-state toggles (`aria-pressed`: their pressed
 * fill means something), and every semantic variant — success, destructive,
 * ghost icon buttons, status badges — which the selector simply never
 * matches.
 */
export const TOOLBAR_TONE_COUNT = 5;
export const TOOLBAR_TONE_ATTRIBUTE = "data-toolbar-tone";
export const TOOLBAR_TONE_EXEMPT_ATTRIBUTE = "data-tone-exempt";

/** The controls that take part, keyed on the primitives' own data attributes. */
export const TOOLBAR_TONE_CANDIDATE_SELECTOR = [
  "[data-filter-trigger]",
  '[data-button][data-variant="field"]',
  '[data-button][data-variant="menu"]',
  '[data-button][data-variant="outline"]',
  '[data-select-trigger]:not([data-variant="ghost"])',
].join(", ");

/** A candidate under any of these is exempt. */
export const TOOLBAR_TONE_EXEMPT_ANCESTOR_SELECTOR = `[${TOOLBAR_TONE_EXEMPT_ATTRIBUTE}], [data-bulk-strip]`;

export interface ToolbarToneCandidate {
  /** Opted out: receives no tone and does not advance the sequence. */
  exempt?: boolean;
  /**
   * Hidden by a responsive class. Deliberately irrelevant to the result — a
   * hidden control keeps its index so nothing recolours when it shows.
   */
  hidden?: boolean;
}

/**
 * Pure assignment: eligible controls in DOM order → 1-based tone index,
 * cycling through `count`, or `null` for an exempt control.
 */
export function assignToolbarTones(
  candidates: readonly ToolbarToneCandidate[],
  count: number = TOOLBAR_TONE_COUNT,
): (number | null)[] {
  let position = 0;
  return candidates.map((candidate) => {
    if (candidate.exempt) return null;
    const tone = (position % count) + 1;
    position += 1;
    return tone;
  });
}

/** Whether a matched control opts out of the sequence. */
export function isToolbarToneExempt(element: Element): boolean {
  return (
    element.hasAttribute("aria-pressed") ||
    element.closest(TOOLBAR_TONE_EXEMPT_ANCESTOR_SELECTOR) !== null
  );
}

/**
 * (Re)number every eligible control under `root`. Idempotent and cheap:
 * only attributes whose value actually changes are written, so it is safe
 * to run after every DOM mutation.
 */
export function applyToolbarTones(root: Element, count: number = TOOLBAR_TONE_COUNT): void {
  const elements = Array.from(root.querySelectorAll(TOOLBAR_TONE_CANDIDATE_SELECTOR));
  const tones = assignToolbarTones(
    elements.map((element) => ({ exempt: isToolbarToneExempt(element) })),
    count,
  );
  elements.forEach((element, index) => {
    const tone = tones[index];
    if (tone === null) {
      if (element.hasAttribute(TOOLBAR_TONE_ATTRIBUTE)) {
        element.removeAttribute(TOOLBAR_TONE_ATTRIBUTE);
      }
      return;
    }
    const value = String(tone);
    if (element.getAttribute(TOOLBAR_TONE_ATTRIBUTE) !== value) {
      element.setAttribute(TOOLBAR_TONE_ATTRIBUTE, value);
    }
  });
}

/**
 * Keeps a toolbar's controls numbered: once before first paint, then after
 * every subtree change (filters mounting, the bulk strip replacing the row,
 * a control switching variant). React never owns `data-toolbar-tone`, so
 * re-renders neither strip nor fight it.
 */
export function useToolbarTones<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    applyToolbarTones(root);
    const observer = new MutationObserver(() => applyToolbarTones(root));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-variant",
        "data-filter-trigger",
        "data-select-trigger",
        "aria-pressed",
        TOOLBAR_TONE_EXEMPT_ATTRIBUTE,
      ],
    });
    return () => observer.disconnect();
  }, []);
  return ref;
}
