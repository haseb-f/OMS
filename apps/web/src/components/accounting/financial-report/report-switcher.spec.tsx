import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", direction: "ltr" }),
}));

import { groupReportOptions, ReportSwitcher, type ReportSwitcherOption } from "./report-switcher";

const OPTIONS: ReportSwitcherOption[] = [
  { value: "generalLedger", label: "General ledger", group: "Ledgers & entries" },
  { value: "trialBalance", label: "Trial balance", group: "Ledgers & entries" },
  { value: "balanceSheet", label: "Balance sheet", group: "Financial statements" },
  { value: "incomeStatement", label: "Income statement", group: "Financial statements" },
  { value: "arAging", label: "AR aging", group: "Receivables & payables" },
  { value: "supplierStatement", label: "Supplier statement", group: "Receivables & payables" },
  { value: "cashAvailability", label: "Cash availability", group: "Cash" },
];

beforeAll(() => {
  // jsdom gaps used by cmdk / Radix.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

describe("groupReportOptions", () => {
  it("groups consecutive options by heading, in caller order", () => {
    const groups = groupReportOptions(OPTIONS);
    expect(groups.map((g) => g.heading)).toEqual([
      "Ledgers & entries",
      "Financial statements",
      "Receivables & payables",
      "Cash",
    ]);
    expect(groups[0].items.map((o) => o.value)).toEqual(["generalLedger", "trialBalance"]);
  });

  it("keeps ungrouped options in one heading-less group", () => {
    const groups = groupReportOptions([
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBeUndefined();
  });
});

describe("ReportSwitcher", () => {
  afterEach(cleanup);

  function open(value = "balanceSheet", onChange = vi.fn()) {
    render(
      <ReportSwitcher
        title="Financial reports"
        value={value}
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "reports.finance.header.switchReport" }));
    return onChange;
  }

  it("renders the root title and group headings as non-selectable labels", () => {
    open();
    const title = document.querySelector("[data-slot=report-switcher-title]");
    expect(title?.textContent).toBe("Financial reports");
    const options = screen.getAllByRole("option");
    // Only the 7 reports are options — never the root title or a heading.
    expect(options).toHaveLength(OPTIONS.length);
    for (const heading of [
      "Ledgers & entries",
      "Financial statements",
      "Receivables & payables",
      "Cash",
    ]) {
      const node = screen.getByText(heading);
      expect(node.closest("[role=option]")).toBeNull();
      expect(node.hasAttribute("cmdk-group-heading")).toBe(true);
    }
    expect(title?.closest("[role=option]")).toBeNull();
  });

  it("marks and highlights the active report (check state, aria-current, initial selection)", () => {
    open("incomeStatement");
    const active = screen.getByRole("option", { name: /Income statement/ });
    expect(active.getAttribute("data-checked")).toBe("true");
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.getAttribute("aria-selected")).toBe("true");
    const others = screen.getAllByRole("option").filter((option) => option !== active);
    for (const option of others) {
      expect(option.getAttribute("aria-current")).toBeNull();
      expect(option.getAttribute("data-checked")).toBe("false");
    }
  });

  it("reveals the active report in its group (all groups expanded)", () => {
    open("cashAvailability");
    const active = screen.getByRole("option", { name: /Cash availability/ });
    const group = active.closest("[data-report-group]");
    expect(group?.getAttribute("data-report-group")).toBe("Cash");
    expect(active.closest("[hidden]")).toBeNull();
  });

  it("selects a report with Enter after arrow navigation", () => {
    const onChange = open("generalLedger");
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("trialBalance");
  });
});
