import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", direction: "ltr" }),
}));

import { RecordGridCard } from "./record-grid-card";

afterEach(cleanup);

const base = {
  tone: "neutral" as const,
  selected: false,
  title: "Accept A",
  reference: "INV-1001",
};

describe("RecordGridCard (design-system §12.19)", () => {
  it("is named by the record (customer — number), so repeated customers never read alike", () => {
    const { getByRole } = render(
      <RecordGridCard {...base} recordLabel="Accept A — INV-1001" onToggleSelected={() => {}} />,
    );
    expect(getByRole("article", { name: "Accept A — INV-1001" })).toBeTruthy();
  });

  it("has ONE primary link (the title) and controls never nest inside it", () => {
    const { container } = render(
      <RecordGridCard
        {...base}
        href="/sales/invoices/1"
        onToggleSelected={() => {}}
        selectLabel="Select Accept A — INV-1001"
      />,
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("aria-describedby")).toBeTruthy();
    expect(links[0].querySelector('[role="checkbox"], button')).toBeNull();
    expect(container.querySelector('[role="checkbox"]')?.getAttribute("aria-label")).toBe(
      "Select Accept A — INV-1001",
    );
  });

  it("the checkbox toggles selection without activating the link", () => {
    const onToggle = vi.fn();
    const onClick = vi.fn();
    const { container } = render(
      <div onClick={onClick}>
        <RecordGridCard {...base} href="/x" onToggleSelected={onToggle} selectLabel="s" />
      </div>,
    );
    fireEvent.click(container.querySelector('[role="checkbox"]')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("draws no checkbox on a list without selection", () => {
    const { container } = render(<RecordGridCard {...base} />);
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("drops fields that have nothing to say (—, empty) and caps the rest at four", () => {
    const { container } = render(
      <RecordGridCard
        {...base}
        fields={[
          { key: "a", label: "A", value: "—" },
          { key: "b", label: "B", value: "" },
          { key: "c", label: "C", value: "kept-1" },
          { key: "d", label: "D", value: "kept-2" },
          { key: "e", label: "E", value: "kept-3" },
          { key: "f", label: "F", value: "kept-4" },
          { key: "g", label: "G", value: "dropped-5" },
        ]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("kept-1");
    expect(text).toContain("kept-4");
    expect(text).not.toContain("dropped-5");
    expect([...container.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
      "C",
      "D",
      "E",
      "F",
    ]);
  });

  it("a lone field spans the whole row", () => {
    const { container } = render(
      <RecordGridCard {...base} fields={[{ key: "a", label: "A", value: "only" }]} />,
    );
    expect(container.querySelector("dl > div")?.className).toContain("col-span-2");
  });

  it("the reference wraps instead of truncating, and the key figure has its own row", () => {
    const { container } = render(
      <RecordGridCard
        {...base}
        meta={<span>1,500.00 SAR</span>}
        reference="DEMO-ACCEPTANCE-20260922-1052-B2B"
      />,
    );
    const reference = container.querySelector("[id]");
    expect(reference?.className).toContain("[overflow-wrap:anywhere]");
    expect(reference?.className).not.toContain("truncate");
    expect(container.querySelector("[data-record-figure]")?.textContent).toBe("1,500.00 SAR");
  });

  it("the marker sits in the badge row, not beside the title", () => {
    const { container } = render(
      <RecordGridCard
        {...base}
        marker={<span data-testid="m">new</span>}
        badges={<span>b</span>}
      />,
    );
    const marker = container.querySelector('[data-testid="m"]')!;
    expect(marker.closest("div")?.textContent).toContain("b");
    expect(marker.closest("[data-record-link]")).toBeNull();
  });

  it("carries the selected state for the recipe", () => {
    const { container } = render(<RecordGridCard {...base} selected />);
    expect(container.querySelector("article")?.getAttribute("data-state")).toBe("selected");
  });
});
