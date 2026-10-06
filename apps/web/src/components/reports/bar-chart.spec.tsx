import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart";

afterEach(() => cleanup());

const items = [
  { id: "a", label: "Amal", value: 40, valueLabel: "40", prefix: "#1" },
  { id: "b", label: "Badr", value: 10, valueLabel: "10", prefix: "#2" },
  { id: "c", label: "Cyrine", value: 0, valueLabel: "0", prefix: "#3" },
];

describe("BarChart", () => {
  it("keeps the given (ranked) order, labels every bar and scales to the largest value", () => {
    render(<BarChart title="Ranking" items={items} emptyLabel="Nothing" />);
    const figure = screen.getByRole("figure", { name: "Ranking" });
    const rows = within(figure).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "#1Amal: 4040",
      "#2Badr: 1010",
      "#3Cyrine: 00",
    ]);
    const bars = figure.querySelectorAll<HTMLElement>('[data-slot="bar"]');
    expect([...bars].map((bar) => bar.style.inlineSize)).toEqual(["100%", "25%", "0%"]);
  });

  it("mirrors in RTL through logical properties only (start edge, rounded data end)", () => {
    const { container } = render(
      <div dir="rtl">
        <BarChart title="الترتيب" items={items} emptyLabel="لا شيء" />
      </div>,
    );
    const bar = container.querySelector<HTMLElement>('[data-slot="bar"]');
    expect(bar?.className).toContain("start-0");
    expect(bar?.className).toContain("rounded-e-sm");
    expect(bar?.getAttribute("style")).not.toMatch(/\b(left|right|width)\s*:/);
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
  });

  it("says so when there is nothing to chart", () => {
    render(<BarChart title="Ranking" items={[]} emptyLabel="Nothing to compare" />);
    expect(screen.getByText("Nothing to compare")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
