import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UserPlus } from "lucide-react";
import { InsightCard, InsightScope } from "./insight-card";

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
