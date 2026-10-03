import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { StatementPrintPayload } from "@/types/print-engine";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", direction: "ltr" }),
}));
vi.mock("../print-brand", () => ({
  usePrintIdentity: (company: StatementPrintPayload["company"]) => ({
    company,
    accentColor: "#04203c",
  }),
}));

import { AccountStatementPrintTemplate } from "./statement-print-template";

afterEach(cleanup);

const payload: StatementPrintPayload = {
  variant: "account-statement",
  title: "Agent statement",
  printedByName: null,
  company: { name: "OMS" },
  partyRole: "customer",
  party: { name: "Nile", lines: [] },
  period: "From 01 Oct 2026 · To 31 Oct 2026",
  currency: "EGP",
  openingBalance: 0,
  movements: [
    {
      date: "01 Oct 2026",
      reference: "SO-1",
      description:
        "Commission — order SO-1, physical products at 35% of the merchandise net of returns",
      debit: 350,
      credit: 0,
      balance: -350,
    },
  ],
  periodDebit: 350,
  periodCredit: 0,
  closingBalance: -350,
};

describe("statement print template (spec D1–D3)", () => {
  it("prints a genuine zero as 0.00, the unused side blank, a negative balance with a minus — no Dr/Cr suffix", () => {
    const { container } = render(<AccountStatementPrintTemplate payload={payload} />);
    const rows = [...container.querySelectorAll(".pr-table tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    // Opening row: balance 0.00 (genuine zero), debit/credit do not apply.
    expect(rows[0].slice(3)).toEqual(["", "", "0.00"]);
    // The side a movement does not use is blank, not 0.00.
    expect(rows[1].slice(3)).toEqual(["350.00", "", "-350.00"]);
    // Period totals are computed figures: a zero total is 0.00.
    expect(rows.at(-1)?.slice(3)).toEqual(["350.00", "0.00", "-350.00"]);
    expect(container.textContent).not.toMatch(/\b(Dr|Cr)\b|مدين|دائن/);
  });

  it("gives the description a prose column (min width, word wrap)", () => {
    const { container } = render(<AccountStatementPrintTemplate payload={payload} />);
    const description = container.querySelectorAll(".pr-table thead th")[2];
    expect(description.getAttribute("data-wrap")).toBe("prose");
    expect(container.querySelector(".pr-table tbody td[data-wrap='prose']")).not.toBeNull();
  });

  it("states the labelled period as given (never re-derived)", () => {
    const { container } = render(<AccountStatementPrintTemplate payload={payload} />);
    expect(container.textContent).toContain("From 01 Oct 2026 · To 31 Oct 2026");
  });
});
