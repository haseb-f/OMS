import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UserPlus } from "lucide-react";
import { InsightCard, InsightScope, resolveInsightTone } from "./insight-card";

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
