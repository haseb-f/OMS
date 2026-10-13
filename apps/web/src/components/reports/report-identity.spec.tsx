import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CalendarCheck, Wallet } from "lucide-react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

import { INSIGHT_IDENTITIES, InsightCard } from "@/components/shared/insight-card";
import { MoneyValue } from "@/components/shared/money-value";
import { ReportCard, REPORT_CURRENCY_CLASS } from "./report-card";
import { OwnRankCard } from "./own-rank-card";
import { METRIC_IDENTITY, PERIOD_IDENTITY, currencyIdentity } from "./report-identity";
import { formatMoney } from "@/lib/money";
import { formatNumber } from "@/lib/format-number";

afterEach(cleanup);

/**
 * R19 §C2 — colour identity, semantic text and icon motion of the sales-report cards: a stable
 * mapping by metric / period, figures unchanged, colour never the only signal, motion only on
 * the icon glyph and never under reduced motion.
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

describe("identity mapping — stable, curated, by metric / period", () => {
  it("the five Live periods have five distinct identities", () => {
    const hues = Object.values(PERIOD_IDENTITY).map((entry) => entry.hue);
    expect(new Set(hues).size).toBe(5);
  });

  it("cards of one fixed group read apart; one metric keeps one hue", () => {
    // My performance: own sales vs own rank; separate rows: unassigned vs agents.
    expect(METRIC_IDENTITY.personSales.hue).not.toBe(METRIC_IDENTITY.ownRank.hue);
    expect(METRIC_IDENTITY.unassigned.hue).not.toBe(METRIC_IDENTITY.agentSales.hue);
    expect(METRIC_IDENTITY.personSales.hue).not.toBe(METRIC_IDENTITY.teamSales.hue);
  });

  it("a currency always takes the same hue; common codes are pinned and distinct", () => {
    expect(currencyIdentity("EGP")).toEqual(currencyIdentity("egp"));
    expect(currencyIdentity("A2A0B2E")).toEqual(currencyIdentity("A2A0B2E"));
    const pinned = ["EGP", "SAR", "USD", "AED"].map((code) => currencyIdentity(code).hue);
    expect(new Set(pinned).size).toBe(4);
  });

  it("identities never borrow the semantic hues (green / amber / red stay meaning)", () => {
    for (const hue of INSIGHT_IDENTITIES) expect(hue).not.toMatch(/green|emerald|amber|red|rose/);
    const all = [
      ...Object.values(PERIOD_IDENTITY),
      ...Object.values(METRIC_IDENTITY),
      currencyIdentity("XYZ"),
    ];
    for (const entry of all) expect(INSIGHT_IDENTITIES).toContain(entry.hue);
  });
});

describe("identity on the shared card — values unchanged", () => {
  it("ReportCard carries its identity (even at zero) and the icon motion", () => {
    const { container } = render(
      <>
        <ReportCard
          title="اليوم"
          icon={CalendarCheck}
          identity={PERIOD_IDENTITY.today}
          figure={0}
        />
        <ReportCard
          title="أمس"
          icon={CalendarCheck}
          identity={PERIOD_IDENTITY.yesterday}
          figure={7}
        />
      </>,
    );
    const [zero, seven] = [...container.querySelectorAll('[data-slot="insight-card"]')];
    expect(zero.getAttribute("data-tone")).toBe("identity");
    expect(zero.getAttribute("data-identity")).toBe(PERIOD_IDENTITY.today.hue);
    expect(seven.getAttribute("data-identity")).toBe(PERIOD_IDENTITY.yesterday.hue);
    expect(zero.querySelector('[data-slot="insight-icon"]')!.getAttribute("data-motion")).toBe(
      "lift",
    );
    expect(text(seven.querySelector('[data-slot="insight-value"]'))).toBe(formatNumber(7));
  });

  it("a stat is coloured by meaning only when non-zero; the label always stays", () => {
    const { container } = render(
      <ReportCard
        title="x"
        identity={METRIC_IDENTITY.personSales}
        figure={3}
        stats={[
          { label: "Orders", value: 4 },
          { label: "Cancelled", value: 2, meaning: "danger" },
          { label: "Returned", value: 0, meaning: "attention" },
        ]}
      />,
    );
    const dds = [...container.querySelectorAll("dd")];
    expect(dds.map((dd) => dd.getAttribute("data-meaning"))).toEqual([null, "danger", null]);
    expect([...container.querySelectorAll("dt")].map((dt) => text(dt))).toEqual([
      "Orders",
      "Cancelled",
      "Returned",
    ]);
  });

  it("the split currency code reads exactly like formatMoney", () => {
    const cases: [number, string][] = [
      [1234567890, "EGP"],
      [0, "SAR"],
      [-42.25, "USD"],
    ];
    const { container } = render(
      <>
        {cases.map(([value, code]) => (
          <MoneyValue
            key={code}
            value={value}
            currency={code}
            currencyClassName={REPORT_CURRENCY_CLASS}
          />
        ))}
      </>,
    );
    const values = [...container.querySelectorAll('[data-slot="semantic-value"]')];
    expect(values.map((el) => el.textContent)).toEqual(
      cases.map(([value, code]) => formatMoney(value, code)),
    );
    expect(container.querySelectorAll('[data-slot="money-currency"]')).toHaveLength(3);
  });

  it("InsightCard / OwnRankCard: identity only at the report size; default cards unchanged", () => {
    const { container } = render(
      <>
        <InsightCard label="a" value={1} icon={Wallet} identity="teal" iconMotion="tilt" />
        <InsightCard
          label="b"
          value={1}
          icon={Wallet}
          identity="teal"
          iconMotion="tilt"
          size="report"
        />
        <OwnRankCard position={2} of={9} population="company" />
        <OwnRankCard
          position={2}
          of={9}
          population="company"
          size="report"
          identity={METRIC_IDENTITY.ownRank}
        />
      </>,
    );
    const [plain, report, rankPlain, rankReport] = [
      ...container.querySelectorAll('[data-slot="insight-card"]'),
    ];
    expect(plain.hasAttribute("data-identity")).toBe(false);
    expect(plain.querySelector('[data-slot="insight-icon"]')!.hasAttribute("data-motion")).toBe(
      false,
    );
    expect(report.getAttribute("data-identity")).toBe("teal");
    expect(rankPlain.hasAttribute("data-identity")).toBe(false);
    expect(rankReport.getAttribute("data-identity")).toBe(METRIC_IDENTITY.ownRank.hue);
    expect(text(rankReport)).toBe(text(rankPlain));
  });
});

describe("identity recipe, semantic text and icon motion", () => {
  it("every identity hue maps to its token, defined for light and dark", () => {
    for (const hue of INSIGHT_IDENTITIES) {
      expect(block).toMatch(
        new RegExp(
          // R20 §B: the outer card (`insight-frame`) shares the identity mapping.
          `:is\\(\\[data-slot="insight-card"\\], \\[data-slot="insight-frame"\\]\\)\\[data-identity="${hue}"\\] \\{\\s*--tone: var\\(--report-identity-${hue}\\);`,
        ),
      );
      expect(tokens.match(new RegExp(`--report-identity-${hue}:`, "g")), hue).toHaveLength(2);
    }
    for (const meaning of ["success", "attention", "danger"]) {
      expect(block).toMatch(
        new RegExp(
          `\\[data-meaning="${meaning}"\\] \\{\\s*color: var\\(--report-text-${meaning}\\);`,
        ),
      );
      expect(tokens.match(new RegExp(`--report-text-${meaning}:`, "g")), meaning).toHaveLength(2);
    }
  });

  it("icon motion: the glyph only, individual properties, gated on no-preference, never looping", () => {
    const motion = block.slice(block.indexOf("[data-motion] > svg {"));
    expect(motion).toMatch(/transition:\s*translate var\(--insight-card-duration\)/);
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-slot="insight-card"\]\[data-size="report"\]\[data-interactive\]:focus-visible/,
    );
    expect(block).toMatch(
      /@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{/,
    );
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-slot="insight-card"\]\[data-size="report"\] \[data-slot="insight-icon"\]\[data-motion\] > svg \{\s*transition: none;\s*translate: none;\s*rotate: none;\s*scale: none;/,
    );
    // Every motion rule targets the icon glyph, never the figure.
    for (const m of block.matchAll(
      /([^{}]*)\{\s*(?:translate: 0 var\(--report-icon-lift\)|rotate: var\(--report-icon-tilt\)|scale: var\(--report-icon-scale\));/g,
    )) {
      expect(m[1]).toMatch(
        /\[data-slot="insight-icon"\]\[data-motion="(lift|tilt|scale)"\]\s*> svg\s*$/,
      );
    }
    expect(block).not.toMatch(/animation\s*:|@keyframes|infinite/);
    for (const token of ["--report-icon-lift", "--report-icon-tilt", "--report-icon-scale"]) {
      expect(tokens).toContain(`${token}:`);
    }
  });
});
