import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Plus } from "lucide-react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => (key === "common.more" ? "More" : key), locale: "en" }),
}));

// jsdom has no matchMedia; the menu's phone-only copies are not under test here.
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { HeaderActions, planHeaderActions, type ActionSpec } from "./header-actions";

const noop = () => {};
const a = (key: string, extra: Partial<ActionSpec> = {}): ActionSpec => ({
  key,
  label: key,
  onSelect: noop,
  ...extra,
});

describe("planHeaderActions", () => {
  it("keeps at most two secondary actions inline; the rest overflow before `more`", () => {
    const plan = planHeaderActions({
      secondary: [a("s1"), a("s2"), a("s3")],
      more: [a("m1")],
    });
    expect(plan.inlineSecondary.map((x) => x.key)).toEqual(["s1", "s2"]);
    expect(plan.overflow.map((x) => x.key)).toEqual(["s3", "m1"]);
    expect(plan.overflowOnDesktop).toBe(true);
  });

  it("drops hidden actions and needs the overflow only on phones when only secondaries exist", () => {
    const plan = planHeaderActions({ secondary: [a("s1"), a("gone", { hidden: true })] });
    expect(plan.inlineSecondary.map((x) => x.key)).toEqual(["s1"]);
    expect(plan.overflowOnDesktop).toBe(false);
    expect(plan.overflowOnPhone).toBe(true);
  });

  it("counts destructive actions toward the desktop overflow", () => {
    const plan = planHeaderActions({
      destructive: [{ ...a("del"), confirm: { title: "t", confirmLabel: "ok" } }],
    });
    expect(plan.overflowOnDesktop).toBe(true);
    expect(plan.destructive.map((x) => x.key)).toEqual(["del"]);
  });
});

describe("HeaderActions", () => {
  afterEach(cleanup);

  it("renders in logical order: overflow → secondary → primary (last)", () => {
    const { container, getByRole } = render(
      <HeaderActions
        primary={a("Add", { icon: Plus, testId: "primary" })}
        secondary={[a("Import", { testId: "import" }), a("Export")]}
        more={[a("Sync")]}
      />,
    );
    const root = container.querySelector("[data-slot=header-actions]")!;
    const buttons = Array.from(root.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "More",
      "Import",
      "Export",
      "Add",
    ]);
    expect(buttons.at(-1)?.getAttribute("data-variant")).toBe("default");
    expect(getByRole("button", { name: "Import" }).getAttribute("data-variant")).toBe("outline");
    expect(getByRole("button", { name: "Import" }).getAttribute("data-testid")).toBe("import");
  });

  it("collapses secondary actions on phones but never hides the primary", () => {
    const { container, getByRole } = render(
      <HeaderActions primary={a("Add")} secondary={[a("Import")]} />,
    );
    const secondaryWrapper = container.querySelector("[data-header-secondary]")!;
    expect(secondaryWrapper.className).toContain("hidden");
    expect(secondaryWrapper.className).toContain("sm:contents");
    // Overflow exists only for phones here (nothing else lives in it).
    expect(getByRole("button", { name: "More" }).className).toContain("sm:hidden");
    const primary = getByRole("button", { name: "Add" });
    expect(primary.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(primary.closest("[data-header-secondary]")).toBeNull();
  });

  it("renders nothing when every action is hidden", () => {
    const { container } = render(
      <HeaderActions primary={a("Add", { hidden: true })} secondary={[a("x", { hidden: true })]} />,
    );
    expect(container.querySelector("[data-slot=header-actions]")).toBeNull();
  });
});
