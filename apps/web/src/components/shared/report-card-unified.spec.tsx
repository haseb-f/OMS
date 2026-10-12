import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Filter, Store } from "lucide-react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

import { INSIGHT_FOCUS_CLASS, InsightCard } from "./insight-card";

afterEach(cleanup);

/**
 * R17 §4 — one report-card treatment for every report summary card. Actionable
 * cards (link / button) and informational cards are told apart by markup and
 * by the recipe; the treatment is token-driven, paint-only, motion-safe and
 * touch-safe; record-grid status cards stay a separate family.
 */
const SRC = resolve(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8").replace(/\r\n/g, "\n");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const recipes = read("theme/recipes.css");
const tokens = read("theme/tokens.css");
const block = (() => {
  const start = recipes.indexOf("/* ── Report cards");
  const end = recipes.indexOf("/* Round 6 (§12.13): a dashboard panel's header icon");
  return stripComments(recipes.slice(start, end));
})();

describe("actionable vs informational cards", () => {
  it("an informational card is a plain, unfocusable div: no pointer hook, no chevron", () => {
    const { container } = render(
      <InsightCard icon={Store} tone="success" label="Delivered" value={12} />,
    );
    const card = container.querySelector<HTMLElement>('[data-slot="insight-card"]')!;
    expect(card.tagName).toBe("DIV");
    expect(card.hasAttribute("data-interactive")).toBe(false);
    expect(card.hasAttribute("tabindex")).toBe(false);
    expect(card.tabIndex).toBe(-1);
    expect(card.querySelector("a, button, [tabindex]")).toBeNull();
    expect(card.querySelector('[data-slot="insight-go"], [data-slot="insight-action"]')).toBeNull();
    for (const token of INSIGHT_FOCUS_CLASS.split(" ")) expect(card.className).not.toContain(token);
  });

  it("a drill-down card is one link with the chevron and the shared focus ring", () => {
    const { container } = render(
      <InsightCard icon={Store} tone="info" label="Orders" value={3} href="/orders" />,
    );
    const card = container.querySelector<HTMLElement>('[data-slot="insight-card"]')!;
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe("/orders");
    expect(card.hasAttribute("data-interactive")).toBe(true);
    expect(card.querySelector('[data-slot="insight-go"]')).not.toBeNull();
    for (const token of INSIGHT_FOCUS_CLASS.split(" ")) expect(card.className).toContain(token);
  });

  it("a filter card is one button; the active filter is pressed and carries the emphasis edge", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <>
        <InsightCard icon={Filter} tone="warning" label="Warnings" value={2} onSelect={onSelect} />
        <InsightCard icon={Filter} tone="info" label="New" value={5} onSelect={onSelect} pressed />
      </>,
    );
    const [idle, active] = [
      ...container.querySelectorAll<HTMLElement>('[data-slot="insight-card"]'),
    ];
    for (const card of [idle, active]) {
      expect(card.tagName).toBe("BUTTON");
      expect(card.hasAttribute("data-interactive")).toBe(true);
      for (const token of INSIGHT_FOCUS_CLASS.split(" ")) expect(card.className).toContain(token);
    }
    expect(idle.getAttribute("aria-pressed")).toBe("false");
    expect(idle.hasAttribute("data-emphasis")).toBe(false);
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.hasAttribute("data-emphasis")).toBe(true);
    active.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("loading shows the card skeleton (never a faked figure); compact steps the figure down", () => {
    const { container } = render(
      <>
        <InsightCard label="Capital" value={100} loading />
        <InsightCard label="Units" value={7} size="compact" />
      </>,
    );
    const [loading, compact] = [...container.querySelectorAll('[data-slot="insight-card"]')];
    expect(loading.getAttribute("aria-hidden")).toBe("true");
    expect(loading.querySelector('[data-slot="insight-value"]')).toBeNull();
    const figure = compact.querySelector('[data-slot="insight-value"]')!;
    expect(figure.className).toContain("text-metric");
    expect(figure.className).not.toContain("text-metric-lg");
  });

  it("the recipe: informational cards never show a pointer; actionable cards do", () => {
    expect(block).toMatch(
      /\[data-slot="insight-card"\]:not\(\[data-interactive\]\) \{\s*cursor: default;/,
    );
    expect(block).toMatch(
      /\[data-slot="insight-card"\]\[data-interactive\] \{[^}]*cursor: pointer;/,
    );
    // The informational hover is a gentle tint step only — never the actionable tint.
    expect(block).toMatch(
      /:not\(\[data-interactive\]\):hover \{[^}]*--tone-top: var\(--insight-tint-top-static-hover\)/,
    );
  });
});

describe("one token-driven, motion-safe, touch-safe treatment", () => {
  it("every card shares the token padding; no tile pads itself", () => {
    const source = read("components/shared/insight-card.tsx");
    expect(source).toMatch(
      /px-\(--insight-card-padding-inline\) py-\(--insight-card-padding-block\)/,
    );
    for (const token of ["--insight-card-padding-inline", "--insight-card-padding-block"]) {
      expect(tokens).toContain(`${token}:`);
    }
  });

  it("the block references only report-card tokens that tokens.css defines (light + dark)", () => {
    // Tokens the block reads but does not itself declare (card-local state variables excluded).
    const used = new Set(
      [...block.matchAll(/var\((--insight-[\w-]+)\)/g)]
        .map((m) => m[1])
        .filter((token) => !block.includes(`${token}:`)),
    );
    expect(used.size).toBeGreaterThan(10);
    for (const token of used) expect(tokens, token).toContain(`${token}:`);
    // Surface strengths are themed: each has a light and a dark value.
    for (const token of [
      "--insight-tint-top",
      "--insight-tint-top-hover",
      "--insight-tint-top-static-hover",
      "--insight-static-hover-shadow",
      "--insight-rest-shadow",
    ]) {
      expect(tokens.match(new RegExp(`${token}:`, "g")), token).toHaveLength(2);
    }
    // globals.css no longer carries a second copy.
    expect(read("app/globals.css")).not.toMatch(/--insight-tint-top:/);
  });

  it("transitions are short, token-timed and never animate layout (paint + the translate rise)", () => {
    const transitions = [...block.matchAll(/transition:([^;]+);/g)].map((m) => m[1]);
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      if (value.trim() === "none") continue;
      expect(value).toMatch(/var\(--insight-card-duration\)/);
      expect(value).not.toMatch(/transform|width|height|padding|margin|inset|top|left|all/);
    }
    expect(tokens).toMatch(/--insight-card-duration: var\(--duration-base\);/);
    // R18 §C: the rise is the `translate` property only — never transform / scale.
    expect(block).not.toMatch(/transform\s*:|translateY|scale\(/);
  });

  it("R18 §C: hover / focus rise 1px (informational) / 2px (actionable) through translate only", () => {
    expect(tokens).toMatch(/--insight-lift-static: -1px;/);
    expect(tokens).toMatch(/--insight-lift-active: -2px;/);
    expect(block).toMatch(/translate: var\(--insight-card-translate, none\);/);
    expect(block).toMatch(
      /:not\(\[data-interactive\]\):hover \{[^}]*--insight-card-translate: 0 var\(--insight-lift-static\);/,
    );
    expect(block).toMatch(
      /\[data-interactive\]:focus-visible \{[^}]*--insight-card-translate: 0 var\(--insight-lift-active\);/,
    );
    // A press settles the rise; reduced motion removes it (and every transition).
    expect(block).toMatch(/\[data-interactive\]:active \{\s*--insight-card-translate: none;/);
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\{\s*transition: none;\s*translate: none;/,
    );
    // Paper never carries the rise or the blur.
    const print = read("theme/print.css");
    expect(print).toMatch(/translate: none !important;/);
    expect(print).toMatch(/backdrop-filter: none !important;/);
  });

  it("R18 §C: a glass surface with an opaque fallback, themed for light and dark", () => {
    // Opaque card by default; the translucent glass + blur only where blur is supported.
    expect(block).toMatch(/--insight-card-base: var\(--card\);/);
    expect(block).toMatch(
      /@supports \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\[data-slot="insight-card"\] \{\s*--insight-card-base: var\(--insight-glass\);\s*-webkit-backdrop-filter: var\(--insight-glass-filter\);\s*backdrop-filter: var\(--insight-glass-filter\);/,
    );
    expect(block).toMatch(
      /color-mix\(in oklab, var\(--tone\) var\(--tone-top\), var\(--insight-card-base\)\)/,
    );
    for (const token of [
      "--insight-glass",
      "--insight-title",
      "--insight-active-shadow-geometry",
    ]) {
      expect(tokens.match(new RegExp(`${token}:`, "g")), token).toHaveLength(2);
    }
    // The title reads one step above secondary text.
    expect(block).toMatch(
      /\[data-slot="insight-card"\] \[data-slot="insight-label"\] \{\s*color: var\(--insight-title\);/,
    );
  });

  it("prefers-reduced-motion removes every card transition (inside the one block)", () => {
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-slot="insight-card"\],\s*\[data-slot="insight-card"\] :is\(\[data-slot="insight-icon"\], \[data-slot="insight-value"\]\),\s*\[data-slot="insight-card"\] :is\(\[data-slot="insight-action"\], \[data-slot="insight-go"\]\) \{\s*transition: none;/,
    );
  });

  it("hover: none keeps a clear resting difference for actionable cards", () => {
    expect(block).toMatch(
      /@media \(hover: none\) \{\s*\[data-slot="insight-card"\]\[data-interactive\] \{\s*--insight-card-border:/,
    );
  });
});

describe("record-grid status cards are untouched", () => {
  it("the grid card does not use the report-card surface, and no card rule targets it", () => {
    const grid = read("components/shared/data-table/record-grid-card.tsx");
    expect(grid).not.toMatch(/insight-card|InsightSurface|InsightCard/);
    expect(block).not.toMatch(/data-record|record-grid|data-grid-card/);
    // The record-card recipe never borrows the report-card tokens.
    const recordBlock = stripComments(recipes.slice(recipes.indexOf("[data-record-card] {")));
    expect(recordBlock).not.toMatch(/--insight-tint-top-static-hover|--insight-card-/);
  });
});
