import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TrendingUp, Wallet } from "lucide-react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

import { InsightCard, InsightCardSkeleton, InsightGroup } from "@/components/shared/insight-card";
import { ReportCard, ReportCardSkeleton } from "./report-card";
import { OwnRankCard } from "./own-rank-card";
import { formatNumber } from "@/lib/format-number";
import { formatMoney } from "@/lib/money";

afterEach(cleanup);

/**
 * R19 §C — the sales-report size of the shared report card: larger and stronger, but the SAME
 * component, the same figures (pass-through, never recomputed) and the same state machine.
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
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("report size — figures pass through unchanged", () => {
  it("ReportCard shows exactly the figure, every money line and every count it is given", () => {
    const amounts = [
      { currencyCode: "EGP", amount: 1234567890 },
      { currencyCode: "SAR", amount: 0.5 },
      { currencyCode: "USD", amount: -42.25 },
    ];
    const { container } = render(
      <ReportCard
        title="هذا الشهر"
        icon={TrendingUp}
        tone="revenue"
        figure={1234567}
        unit="طلب صالح"
        amounts={amounts}
        stats={[
          { label: "الطلبات", value: 1234999 },
          { label: "ملغاة", value: 0 },
        ]}
      />,
    );
    const card = container.querySelector('[data-slot="insight-card"]')!;
    expect(card.getAttribute("data-size")).toBe("report");
    expect(text(card.querySelector('[data-slot="insight-value"]'))).toBe(formatNumber(1234567));
    expect(
      [...card.querySelectorAll('[data-slot="report-amounts"] li')].map((li) => text(li)),
    ).toEqual(amounts.map((line) => formatMoney(line.amount, line.currencyCode)));
    expect([...card.querySelectorAll("dd")].map((dd) => text(dd))).toEqual([
      formatNumber(1234999),
      formatNumber(0),
    ]);
    expect(text(card)).toContain("طلب صالح");
  });

  it("an InsightCard reads the same text at the default and the report size", () => {
    const props = {
      icon: Wallet,
      tone: "success" as const,
      label: "Collected",
      value: "1,234,567,890.00",
      unit: "EGP",
      context: "Prepaid and cash on delivery, valid orders only",
    };
    const { container } = render(
      <>
        <InsightCard {...props} />
        <InsightCard {...props} size="report" />
      </>,
    );
    const [plain, report] = [...container.querySelectorAll('[data-slot="insight-card"]')];
    expect(plain.hasAttribute("data-size")).toBe(false);
    expect(report.getAttribute("data-size")).toBe("report");
    expect(text(report)).toBe(text(plain));
    // A report explanation is never clipped (it wraps).
    expect(report.querySelector("p")!.className).not.toContain("truncate");
  });

  it("OwnRankCard: same rank text at both sizes; the dashboard keeps the default", () => {
    const { container } = render(
      <>
        <OwnRankCard position={3} of={12} population="company" />
        <OwnRankCard position={3} of={12} population="company" size="report" />
        <OwnRankCard position={null} of={12} population="agent" size="report" />
      </>,
    );
    const [plain, report, unranked] = [...container.querySelectorAll('[data-slot="insight-card"]')];
    expect(plain.hasAttribute("data-size")).toBe(false);
    expect(report.getAttribute("data-size")).toBe("report");
    expect(text(report)).toBe(text(plain));
    expect(unranked.getAttribute("data-size")).toBe("report");
  });
});

describe("report size — geometry in the component, one family", () => {
  it("report cards take the report padding, title, figure and icon chip; default cards do not change", () => {
    const { container } = render(
      <>
        <InsightCard label="A" value={1} icon={Wallet} />
        <InsightCard label="B" value={1} icon={Wallet} size="report" />
        <ReportCard title="C" icon={Wallet} figure={1} />
      </>,
    );
    const [plain, report, reportCard] = [
      ...container.querySelectorAll('[data-slot="insight-card"]'),
    ];
    expect(plain.className).toContain("px-(--insight-card-padding-inline)");
    expect(plain.querySelector('[data-slot="insight-value"]')!.className).toContain(
      "text-metric-lg",
    );
    expect(plain.querySelector('[data-slot="insight-label"]')!.className).toContain(
      "text-metric-label",
    );
    expect(plain.querySelector('[data-slot="insight-icon"]')!.className).toContain("size-7");
    for (const card of [report, reportCard]) {
      expect(card.className).toContain("px-(--insight-report-padding-inline)");
      expect(card.className).toContain("py-(--insight-report-padding-block)");
      expect(card.className).not.toContain("--insight-card-padding");
      expect(card.querySelector('[data-slot="insight-value"]')!.className).toContain(
        "text-display",
      );
      expect(card.querySelector('[data-slot="insight-label"]')!.className).toContain(
        "text-card-title",
      );
      expect(card.querySelector('[data-slot="insight-icon"]')!.className).toContain("size-9");
    }
  });

  it("skeletons and groups follow the size; a long list is opaque", () => {
    const { container } = render(
      <>
        <InsightGroup size="report" surface="opaque" className="grid-cols-2">
          <ReportCardSkeleton />
          <InsightCardSkeleton size="report" />
        </InsightGroup>
        <InsightGroup>
          <InsightCardSkeleton />
        </InsightGroup>
      </>,
    );
    const [report, plain] = [...container.querySelectorAll('[data-slot="insight-group"]')];
    expect(report.getAttribute("data-size")).toBe("report");
    expect(report.getAttribute("data-surface")).toBe("opaque");
    expect(report.className).toContain("gap-3");
    expect(plain.hasAttribute("data-size")).toBe(false);
    expect(plain.hasAttribute("data-surface")).toBe(false);
    expect(plain.className).toContain("gap-2");
    for (const card of report.querySelectorAll('[data-slot="insight-card"]')) {
      expect(card.getAttribute("data-size")).toBe("report");
    }
  });
});

describe("report size — the recipe maps stronger tokens onto the same state machine", () => {
  const reportRule = (() => {
    const at = block.indexOf('[data-slot="insight-card"][data-size="report"] {');
    expect(at).toBeGreaterThan(-1);
    return block.slice(at, block.indexOf("}", at));
  })();

  it("only re-points state tokens (no geometry, no literal colour, no new state rules)", () => {
    const declarations = [...reportRule.matchAll(/(--[\w-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThan(12);
    for (const [, name, value] of declarations) {
      expect(name).toMatch(/^--(insight-|accent-edge)/);
      expect(value.trim()).toMatch(/^var\(--insight-report-[\w-]+\)$/);
    }
    expect(reportRule).not.toMatch(/(?<![-\w])(padding|margin|width|height|font-size)\s*:/);
  });

  it("defines every report token for light, and the surface strengths for dark too", () => {
    const used = [...reportRule.matchAll(/var\((--insight-report-[\w-]+)\)/g)].map((m) => m[1]);
    for (const token of used) expect(tokens, token).toContain(`${token}:`);
    for (const token of [
      "--insight-report-tint-top",
      "--insight-report-tint-top-hover",
      "--insight-report-tint-top-static-hover",
      "--insight-report-tint-border",
      "--insight-report-icon-fill",
      "--insight-report-glass",
      "--insight-report-rest-shadow",
      "--insight-report-static-hover-shadow",
      "--insight-report-active-shadow-geometry",
    ]) {
      expect(tokens.match(new RegExp(`${token}:`, "g")), token).toHaveLength(2);
    }
    // Stronger than the default card, still a restrained rise (translate only).
    expect(tokens).toMatch(/--insight-report-lift-static: -2px;/);
    expect(tokens).toMatch(/--insight-report-lift-active: -3px;/);
    expect(tokens).toMatch(/--insight-report-tint-top: 30%;/);
    expect(tokens).toMatch(/--insight-tint-top: 24%;/);
  });

  it("long lists and reduced transparency fall back to the opaque card without blur", () => {
    expect(block).toMatch(
      /\[data-slot="insight-group"\]\[data-surface="opaque"\] > \[data-slot="insight-card"\] \{\s*--insight-card-base: var\(--card\);\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/,
    );
    expect(block).toMatch(
      /@media \(prefers-reduced-transparency: reduce\) \{\s*\[data-slot="insight-card"\]\[data-size="report"\] \{\s*--insight-card-base: var\(--card\);\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/,
    );
  });

  it("informational report cards rest on a hairline depth; actionable ones keep the lift", () => {
    expect(block).toMatch(
      /\[data-slot="insight-card"\]\[data-size="report"\]:not\(\[data-interactive\]\) \{\s*--insight-card-lift: var\(--insight-report-depth\);/,
    );
    expect(reportRule).toMatch(/--insight-rest-shadow: var\(--insight-report-rest-shadow\);/);
  });
});
