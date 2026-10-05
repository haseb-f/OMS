import { describe, expect, it } from "vitest";
import {
  companyStockValueTotal,
  isCompanyOwned,
  stockOwnerLabel,
  stockOwnerQuery,
} from "./stock-owner";

const labels = { company: "Company", unknownAgent: "Agent" };

describe("stockOwnerQuery", () => {
  it("maps the filter onto the API owner query (all = no filter)", () => {
    expect(stockOwnerQuery("")).toBeUndefined();
    expect(stockOwnerQuery("COMPANY")).toBe("COMPANY");
    expect(stockOwnerQuery("AGENT")).toBe("AGENT");
    expect(stockOwnerQuery("company")).toBeUndefined();
    expect(stockOwnerQuery("anything")).toBeUndefined();
  });
});

describe("stockOwnerLabel", () => {
  it("names the company or the agent, never the agent id", () => {
    expect(stockOwnerLabel({ ownerAgentId: null, ownerAgentName: null }, labels)).toBe("Company");
    expect(stockOwnerLabel({}, labels)).toBe("Company");
    expect(stockOwnerLabel({ ownerAgentId: "a-1", ownerAgentName: "Nile Agent" }, labels)).toBe(
      "Nile Agent",
    );
    expect(stockOwnerLabel({ ownerAgentId: "a-1", ownerAgentName: null }, labels)).toBe("Agent");
    expect(isCompanyOwned({ ownerAgentId: "a-1" })).toBe(false);
  });
});

describe("companyStockValueTotal", () => {
  it("sums company-owned values only, to the cent", () => {
    expect(
      companyStockValueTotal([
        { ownerAgentId: null, stockValue: 100.1 },
        { ownerAgentId: null, stockValue: 0.2 },
        // Agent stock never counts, even if a value slipped through.
        { ownerAgentId: "a-1", ownerAgentName: "Agent", stockValue: 999 },
        { ownerAgentId: null, stockValue: null },
      ]),
    ).toBe(100.3);
  });

  it("is null when no row carries a company value", () => {
    expect(companyStockValueTotal([])).toBeNull();
    expect(companyStockValueTotal([{ ownerAgentId: null, stockValue: null }])).toBeNull();
    expect(companyStockValueTotal([{ ownerAgentId: "a", stockValue: 5 }])).toBeNull();
  });
});
