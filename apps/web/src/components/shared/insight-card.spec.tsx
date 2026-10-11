import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UserPlus } from "lucide-react";
import {
  INSIGHT_GROUP_BALANCED_MAX,
  InsightCard,
  InsightGroup,
  InsightScope,
  balancedInsightColumns,
  resolveInsightTone,
} from "./insight-card";

afterEach(cleanup);

describe("InsightCard (Round 6)", () => {
  it("never truncates its label — it wraps", () => {
    const { container } = render(
      <InsightCard icon={UserPlus} tone="info" label="Collections awaiting Finance" value="12" />,
    );
    const label = container.querySelector('[data-slot="insight-label"]')!;
    expect(label.textContent).toBe("Collections awaiting Finance");
    expect(label.className).not.toMatch(/\btruncate\b/);
    expect(label.className).toMatch(/break-words/);
  });

  it("static tiles carry no interactive hook; linked tiles do", () => {
    const { container, rerender } = render(<InsightCard label="New" value="3" tone="info" />);
    expect(container.querySelector("[data-interactive]")).toBeNull();
    rerender(<InsightCard label="New" value="3" tone="info" href="/crm/leads" />);
    expect(container.querySelector("a[data-interactive]")).not.toBeNull();
  });

  it("labels a figure's scope as period, current state or to date", () => {
    const { getByText } = render(
      <>
        <InsightScope kind="period">This month</InsightScope>
        <InsightScope kind="current">Now</InsightScope>
        <InsightScope kind="toDate">To date</InsightScope>
      </>,
    );
    expect(getByText("This month").closest("[data-scope]")?.getAttribute("data-scope")).toBe(
      "period",
    );
    expect(getByText("Now").closest("[data-scope]")?.getAttribute("data-scope")).toBe("current");
    expect(getByText("To date").closest("[data-scope]")?.getAttribute("data-scope")).toBe("toDate");
  });
});

describe("resolveInsightTone — colour follows meaning (Round 6)", () => {
  it("renders a zero or empty toned figure neutral", () => {
    expect(resolveInsightTone("destructive", 0)).toBe("neutral");
    expect(resolveInsightTone("success", "0")).toBe("neutral");
    expect(resolveInsightTone("success", "0%")).toBe("neutral");
    expect(resolveInsightTone("warning", "٠")).toBe("neutral");
    expect(resolveInsightTone("info", null)).toBe("neutral");
    expect(resolveInsightTone("warning", <span>0.00 EGP</span>, 0)).toBe("neutral");
  });

  it("keeps the tone for non-zero figures and for text verdicts", () => {
    expect(resolveInsightTone("info", 18)).toBe("info");
    expect(resolveInsightTone("success", "33.3%")).toBe("success");
    expect(resolveInsightTone("warning", <span>1,650.00</span>, 1650)).toBe("warning");
    expect(resolveInsightTone("success", "Balanced")).toBe("success");
    expect(resolveInsightTone("warning", <span>formatted</span>)).toBe("warning");
  });

  it("honours the opt-out where zero is the news", () => {
    expect(resolveInsightTone("success", 0, undefined, true)).toBe("success");
  });

  it("draws a zero tile neutral in the DOM", () => {
    const { container } = render(<InsightCard label="With returns" value={0} tone="destructive" />);
    expect(container.querySelector('[data-slot="insight-card"]')?.getAttribute("data-tone")).toBe(
      "neutral",
    );
  });
});

describe("InsightCard interactivity (Round 8)", () => {
  it("a tile that opens something always shows a chevron; a static summary never does", () => {
    const { container, rerender } = render(<InsightCard label="Orders" value="9" tone="info" />);
    expect(container.querySelector('[data-slot="insight-go"]')).toBeNull();
    rerender(<InsightCard label="Orders" value="9" tone="info" href="/store-orders" />);
    expect(container.querySelector('a[data-interactive] [data-slot="insight-go"]')).not.toBeNull();
    // With an explicit action label the label is the cue — no second chevron.
    rerender(
      <InsightCard
        label="Orders"
        value="9"
        tone="info"
        href="/store-orders"
        actionLabel="Open orders"
      />,
    );
    expect(container.querySelector('[data-slot="insight-go"]')).toBeNull();
    expect(container.querySelector('[data-slot="insight-action"]')).not.toBeNull();
  });

  it("keeps a visible keyboard focus ring (outline-solid, not just outline-2)", () => {
    const { container } = render(<InsightCard label="Orders" value="9" href="/store-orders" />);
    expect(container.querySelector("a")?.className).toMatch(/focus-visible:outline-solid/);
  });

  it("renders the headline figure at the large metric size", () => {
    const { container } = render(<InsightCard label="Orders" value="9" />);
    expect(container.querySelector('[data-slot="insight-value"]')?.className).toMatch(
      /text-metric-lg/,
    );
  });

  it("sets the metric title one step above caption through the shared token", () => {
    const { container } = render(<InsightCard label="Orders" value="9" />);
    const label = container.querySelector('[data-slot="insight-label"]');
    expect(label?.className).toMatch(/text-metric-label/);
    expect(label?.className).not.toMatch(/truncate/);
  });
});

describe("InsightGroup fit (R14 fix — partner statement summary)", () => {
  it("sizes columns from the space it gets (a container frame), never from viewport breakpoints", () => {
    const { container } = render(
      <InsightGroup fit className="flex-1" aria-busy="true">
        <InsightCard label="A" value="1" tone="info" />
      </InsightGroup>,
    );
    const frame = container.querySelector('[data-slot="insight-group-frame"]')!;
    const group = frame.querySelector('[data-slot="insight-group"]')!;
    // The caller's placement goes on the frame (the queried container); props on the grid.
    expect(frame.className).toContain("flex-1");
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect(group.hasAttribute("data-fit")).toBe(true);
    expect(group.className).not.toMatch(/grid-cols-/);
  });

  it("company partner summaries use the fit layout (no fixed 5–6 column rows)", () => {
    for (const file of [
      "src/app/(shell)/company-partners/page.tsx",
      "src/config/company-partners/period-statement-view.tsx",
      "src/app/(shell)/partner/overview/page.tsx",
      "src/app/(shell)/company-partners/periods/page.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain("<InsightGroup fit>");
      // R17: a fixed few-column row (e.g. two summary cards) is fine; never 5+ fixed columns.
      expect(source).not.toMatch(/<InsightGroup className="[^"]*grid-cols-[5-9]/);
    }
  });
});

describe("InsightGroup fit — balanced rows, no lone orphan (R17)", () => {
  it("chooses a column count that never leaves one card alone on the last row", () => {
    // 6 cards: 6 in one row, else 3 + 3 — never 5 + 1 or 4 + 2.
    expect(balancedInsightColumns(6, 8).columns).toBe(6);
    expect(balancedInsightColumns(6, 6).columns).toBe(6);
    expect(balancedInsightColumns(6, 5).columns).toBe(3);
    expect(balancedInsightColumns(6, 4).columns).toBe(3);
    expect(balancedInsightColumns(6, 2).columns).toBe(2);
    // 5 cards: 5, else 3 + 2.
    expect(balancedInsightColumns(5, 5).columns).toBe(5);
    expect(balancedInsightColumns(5, 4).columns).toBe(3);
    expect(balancedInsightColumns(4, 3).columns).toBe(2);
    for (let count = 2; count <= INSIGHT_GROUP_BALANCED_MAX; count += 1) {
      for (let room = 1; room <= 8; room += 1) {
        const { columns, spanLast } = balancedInsightColumns(count, room);
        expect(columns).toBeLessThanOrEqual(room);
        const last = count % columns || columns;
        // A lone last card only when unavoidable — and then it spans its row.
        expect(spanLast).toBe(columns > 1 && last === 1);
        // Rows are as even as possible: the last row is short by less than one card per row.
        expect(columns - last).toBeLessThan(Math.ceil(count / columns));
      }
    }
  });

  it("counts the rendered cards (fragments flattened, empty slots skipped)", () => {
    const show = false;
    const { container } = render(
      <InsightGroup fit>
        <>
          <InsightCard label="A" value="1" />
          <InsightCard label="B" value="2" />
        </>
        {[3, 4, 5].map((n) => (
          <InsightCard key={n} label={`C${n}`} value={n} />
        ))}
        {show ? <InsightCard label="X" value="0" /> : null}
        <InsightCard label="F" value="6" />
      </InsightGroup>,
    );
    const group = container.querySelector('[data-slot="insight-group"]')!;
    expect(group.getAttribute("data-count")).toBe("6");
  });

  it("the recipe applies exactly the balanced rule per container width", () => {
    const css = readFileSync(join(process.cwd(), "src/theme/recipes.css"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    expect(css).toMatch(
      /\[data-slot="insight-group-frame"\] \{\s*container: insight-group \/ inline-size;/,
    );
    const queries = [
      ...css.matchAll(/@container insight-group \(min-width: ([\d.]+)rem\) \{([\s\S]*?)\n\}/g),
    ];
    expect(queries.length).toBeGreaterThan(0);
    for (let count = 2; count <= INSIGHT_GROUP_BALANCED_MAX; count += 1) {
      // Simulate the cascade: queries are min-width, so the widest matching one wins.
      let columns = 1;
      let span = false;
      for (let room = 2; room <= 8; room += 1) {
        const minWidth = room * 12 + (room - 1) * 0.5;
        for (const [, width, body] of queries) {
          if (Number(width) !== minWidth) continue;
          const cols = body.match(
            new RegExp(
              `\\[data-count="${count}"\\] \\{\\s*grid-template-columns: repeat\\((\\d+),`,
            ),
          );
          if (cols) columns = Number(cols[1]);
          const last = body.match(
            new RegExp(`\\[data-count="${count}"\\] > :last-child \\{\\s*grid-column: ([^;]+);`),
          );
          if (last) span = last[1] === "1 / -1";
        }
        const expected = balancedInsightColumns(count, room);
        expect({ count, room, columns, span }).toEqual({
          count,
          room,
          columns: expected.columns,
          span: expected.spanLast,
        });
      }
    }
  });
});
