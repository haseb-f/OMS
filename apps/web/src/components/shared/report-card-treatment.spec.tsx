import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Store, TrendingUp } from "lucide-react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

import { INSIGHT_FOCUS_CLASS, InsightCard, InsightSurface } from "./insight-card";
import { SummaryCard } from "@/components/agents/summary-card";
import { ReportCard } from "@/components/reports/report-card";

afterEach(cleanup);

/**
 * R16 S2 — ONE report-card treatment: the shared surface is the only card
 * implementation (static div, link or button), hover and keyboard focus are
 * the same paint-only response, touch keeps a clear resting state, reduced
 * motion removes transitions, and record-grid status cards stay untouched.
 */
const SRC = resolve(process.cwd(), "src");
const recipes = readFileSync(join(SRC, "theme/recipes.css"), "utf8").replace(/\r\n/g, "\n");
// R17 §4: the report-card tokens moved from globals.css to theme/tokens.css.
const tokens = readFileSync(join(SRC, "theme/tokens.css"), "utf8").replace(/\r\n/g, "\n");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The report-card block of the theme recipes (comments removed). */
const block = (() => {
  const start = recipes.indexOf("/* ── Report cards");
  const end = recipes.indexOf("/* Round 6 (§12.13): a dashboard panel's header icon");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return stripComments(recipes.slice(start, end));
})();

/** Removes every `@media (<query>) { … }` block (balanced braces). */
function withoutMedia(css: string, query: string): string {
  let out = css;
  for (;;) {
    const at = out.indexOf(`@media ${query}`);
    if (at < 0) return out;
    let depth = 0;
    let index = out.indexOf("{", at);
    for (; index < out.length; index += 1) {
      if (out[index] === "{") depth += 1;
      if (out[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out = out.slice(0, at) + out.slice(index + 1);
  }
}

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  return css
    .slice(open + 1, css.indexOf("}", open))
    .trim()
    .replace(/\s+/g, " ");
}

describe("shared surface — one implementation for static, link and button cards", () => {
  it("renders a static div without any interactive hook", () => {
    const { container } = render(<InsightSurface tone="info">x</InsightSurface>);
    const card = container.querySelector('[data-slot="insight-card"]')!;
    expect(card.tagName).toBe("DIV");
    expect(card.hasAttribute("data-interactive")).toBe(false);
    expect(card.getAttribute("data-tone")).toBe("info");
  });

  it("renders a link and a button with the same interactive hook and focus ring", () => {
    const { container } = render(
      <>
        <InsightSurface href="/agents/1">a</InsightSurface>
        <InsightSurface onSelect={() => undefined} pressed>
          b
        </InsightSurface>
      </>,
    );
    const [link, button] = [...container.querySelectorAll('[data-slot="insight-card"]')];
    expect(link.tagName).toBe("A");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    for (const card of [link, button]) {
      expect(card.hasAttribute("data-interactive")).toBe(true);
      for (const token of INSIGHT_FOCUS_CLASS.split(" ")) expect(card.className).toContain(token);
    }
  });

  it("InsightCard, SummaryCard and ReportCard all draw through it", () => {
    const { container } = render(
      <>
        <InsightCard icon={Store} tone="info" label="Active" value={3} href="/agents/overview" />
        <SummaryCard
          title="Agent A"
          icon={Store}
          tone="warning"
          currency="EGP"
          rows={[{ label: "Orders", value: "4" }]}
          href="/agents/1"
        />
        <ReportCard title="Sales" icon={TrendingUp} tone="success" figure={5} onSelect={() => {}} />
        <SummaryCard title="Static" currency="EGP" rows={[{ label: "Orders", value: "4" }]} />
      </>,
    );
    const cards = [...container.querySelectorAll('[data-slot="insight-card"]')];
    expect(cards.map((card) => card.tagName)).toEqual(["A", "A", "BUTTON", "DIV"]);
    // A card that opens something says so with a chevron; a static summary never does.
    expect(cards[1].querySelector('[data-slot="insight-go"]')).not.toBeNull();
    expect(cards[3].querySelector('[data-slot="insight-go"]')).toBeNull();
    // One icon chip implementation.
    expect(container.querySelectorAll('[data-slot="insight-icon"]')).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Agent A/ }).getAttribute("href")).toBe("/agents/1");
  });

  it("no other source file re-implements the card surface or its icon chip", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(entry) && !/\.spec\.tsx$/.test(entry)) {
          const source = readFileSync(path, "utf8");
          if (/data-slot="insight-(card|icon)"/.test(source)) offenders.push(relative(SRC, path));
        }
      }
    };
    walk(join(SRC, "app"));
    walk(join(SRC, "components"));
    expect(offenders.map((path) => path.replace(/\\/g, "/"))).toEqual([
      "components/shared/insight-card.tsx",
    ]);
  });
});

describe("report-card recipe — hover, focus, touch and motion", () => {
  it("never shifts layout: no transform, size, spacing or position in the card block", () => {
    // R18 §C: the only motion is the `translate` rise (outside the flow); no transform.
    expect(block).not.toMatch(/transform\s*:/);
    expect(block).not.toMatch(/(?<![-\w])(width|height|padding|margin|inset|top|left|right)\s*:/);
    expect(block).not.toMatch(/border(-[a-z]+)?-width\s*:|(?<![-\w])border\s*:/);
  });

  it("keeps every :hover under (hover: hover) — a tap never leaves a sticky hover", () => {
    expect(block).toMatch(/@media \(hover: hover\)/);
    expect(withoutMedia(block, "(hover: hover)")).not.toMatch(/:hover/);
  });

  it("gives keyboard focus exactly the hover response of an interactive card", () => {
    const focus = ruleBody(block, '[data-slot="insight-card"][data-interactive]:focus-visible');
    const hover = ruleBody(block, '  [data-slot="insight-card"][data-interactive]:hover');
    expect(focus).toBe(hover);
    expect(focus).toMatch(/--insight-card-glow/);
    // Focus is never gated on a hover-capable pointer.
    expect(withoutMedia(block, "(hover: hover)")).toMatch(/\[data-interactive\]:focus-visible \{/);
  });

  it("static cards answer hover quietly; interactive cards keep a resting lift and pointer", () => {
    expect(block).toMatch(
      /:not\(\[data-interactive\]\):hover \{[^}]*--insight-static-hover-shadow/,
    );
    expect(ruleBody(block, '[data-slot="insight-card"][data-interactive]')).toMatch(
      /--insight-card-lift: var\(--insight-rest-shadow\); cursor: pointer;/,
    );
  });

  it("uses tokens only (no literal colours) and defines the new tokens for light and dark", () => {
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    for (const token of ["--insight-tint-border-hover", "--insight-static-hover-shadow"]) {
      expect(tokens.match(new RegExp(`${token}:`, "g")), token).toHaveLength(2);
    }
  });

  it("removes the card transitions under prefers-reduced-motion and never animates continuously", () => {
    const reduced = stripComments(recipes).match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-slot="insight-card"\],[\s\S]*?transition: none;/,
    );
    expect(reduced).not.toBeNull();
    expect(block).not.toMatch(/animation\s*:|@keyframes|infinite/);
  });
});

describe("record-grid status cards stay a separate, flat family", () => {
  it("the grid card never uses the report-card surface, and the recipe never targets it", () => {
    const grid = readFileSync(
      join(SRC, "components/shared/data-table/record-grid-card.tsx"),
      "utf8",
    );
    expect(grid).not.toMatch(/insight-card|InsightSurface|InsightCard/);
    expect(block).not.toMatch(/data-record|data-grid-card|record-grid/);
    // Every selector of the block targets the report-card family only.
    const selectors = withoutMedia(block, "(hover: hover)")
      .split("}")
      // The selector right before the last "{" (an @media wrapper header is skipped).
      .map((chunk) => chunk.split("{").at(-2)?.trim() ?? "")
      .filter(Boolean);
    for (const selector of selectors) expect(selector).toMatch(/data-slot="insight-card"/);
  });
});
