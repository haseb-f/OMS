import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatusBadge } from "./status-badge";
import { DynamicStatusBadge } from "./dynamic-status-badge";

describe("StatusBadge", () => {
  it("always renders the state label", () => {
    const { getByText } = render(<StatusBadge label="Delivered" tone="success" />);
    expect(getByText("Delivered")).toBeTruthy();
  });

  it("maps colorKey to a semantic tone; explicit tone wins", () => {
    const a = render(<StatusBadge label="A" colorKey="#dc2626" />);
    expect(a.container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("destructive");
    const b = render(<StatusBadge label="B" colorKey="#dc2626" tone="info" />);
    expect(b.container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("info");
  });

  it("never paints a raw color as the badge background", () => {
    const { container } = render(<StatusBadge label="VIP" colorKey="#9333ea" />);
    const badge = container.querySelector("[data-slot=badge]") as HTMLElement;
    expect(badge.style.backgroundColor).toBe("");
    const dot = badge.querySelector("[aria-hidden]") as HTMLElement;
    expect(dot.style.backgroundColor).not.toBe("");
  });

  it("keeps DynamicStatusBadge as a thin wrapper", () => {
    const { container, getByText } = render(<DynamicStatusBadge label="Won" colorKey="success" />);
    expect(getByText("Won")).toBeTruthy();
    expect(container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("success");
  });
});
