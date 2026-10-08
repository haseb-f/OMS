import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  ShippingAgreementDetail,
  ShippingAgreementList,
  ShippingAgreementListItem,
} from "./shipping-agreements-api";

const granted = new Set<string>();

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({
    user: { id: "u1" },
    isSuperAdmin: false,
    hasPermission: (name: string) => granted.has(name),
  }),
}));
// jsdom has no matchMedia (HeaderActions' phone overflow is not under test).
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-reference-data", () => ({ useCountries: () => [] }));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  activate: vi.fn(),
  duplicate: vi.fn(),
  deactivate: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("./shipping-agreements-api", () => ({ shippingAgreementsApi: api }));

import { ShippingAgreementSection } from "./shipping-agreement-section";

const egypt = { id: "eg", code: "EG", name: "مصر", nameEn: "Egypt" };
const cells = (amount: number | null) => ({
  PREPAID_CARRIER: null,
  COD_CARRIER: amount == null ? null : { rateId: "r1", amount, inherited: false },
  COD_INTERNAL_COURIER: null,
  PREPAID_INTERNAL_COURIER: null,
});

const detail = (over: Partial<ShippingAgreementDetail>): ShippingAgreementDetail => ({
  id: "active",
  agreementNumber: "ASA-2026-0001",
  agentId: "agent",
  currencyId: "egp",
  status: "ACTIVE",
  effectiveFrom: "2020-01-01T00:00:00.000Z",
  effectiveTo: null,
  notes: null,
  activatedAt: "2026-01-01T10:00:00.000Z",
  deactivatedAt: null,
  deactivationReason: null,
  createdAt: "2026-01-01T09:00:00.000Z",
  supersedes: null,
  supersededBy: null,
  currency: { id: "egp", code: "EGP", name: "Egyptian pound", symbol: null },
  inForceToday: true,
  createdByUser: { id: "u1", fullName: "Admin" },
  activatedByUser: { id: "u1", fullName: "Admin" },
  deactivatedByUser: null,
  rates: [
    {
      id: "r1",
      service: "COD_CARRIER",
      countryId: "eg",
      country: egypt,
      city: "",
      scope: "COUNTRY",
      amount: 60,
    },
  ],
  coverage: {
    complete: false,
    destinations: [
      { key: "eg", countryId: "eg", country: egypt, city: "", scope: "COUNTRY", cells: cells(60) },
    ],
    missing: [
      {
        destinationKey: "eg",
        countryId: "eg",
        country: egypt,
        city: "",
        service: "PREPAID_CARRIER",
      },
    ],
  },
  activation: null,
  activity: [],
  ...over,
});

const listItem = (d: ShippingAgreementDetail): ShippingAgreementListItem => ({
  ...d,
  currency: { id: "egp", code: "EGP", symbol: null },
  supersededBy: null,
  rateCount: d.rates.length,
});

const active = detail({});
const draft = detail({
  id: "draft",
  agreementNumber: "ASA-2026-0002",
  status: "DRAFT",
  effectiveFrom: "2030-01-01T00:00:00.000Z",
  activatedAt: null,
  activatedByUser: null,
  inForceToday: false,
  activation: {
    ready: true,
    problems: [],
    overlapping: [
      {
        id: "active",
        agreementNumber: "ASA-2026-0001",
        effectiveFrom: "2020-01-01",
        effectiveTo: null,
      },
    ],
    replaceCloses: "2029-12-31",
  },
});
const list: ShippingAgreementList = {
  inForceId: "active",
  items: [listItem(draft), listItem(active)],
};

beforeEach(() => {
  api.list.mockResolvedValue(list);
  api.get.mockImplementation((_agent: string, id: string) =>
    Promise.resolve(id === "draft" ? draft : active),
  );
});

afterEach(() => {
  cleanup();
  granted.clear();
  vi.clearAllMocks();
});

describe("ShippingAgreementSection", () => {
  it("opens on the agreement in force: number, status, coverage with the missing service marked", async () => {
    render(<ShippingAgreementSection agentId="agent" currencyCode="EGP" />);
    await screen.findAllByText("agentShippingAgreements.inForceToday");
    expect(api.get).toHaveBeenCalledWith("agent", "active");
    expect(screen.getAllByText("ASA-2026-0001").length).toBeGreaterThan(0);
    // The coverage table (desktop rendering; phones get the same rows as cards).
    const [coverage] = screen.getAllByRole("table");
    expect(within(coverage).getAllByText("agentShippingAgreements.missing")).toHaveLength(3);
    expect(within(coverage).getByText("Egypt")).toBeTruthy();
    expect(screen.getByText("agentShippingAgreements.coverageMissing:1")).toBeTruthy();
    // Read-only without agents.agreements.manage: no New, no Duplicate.
    expect(screen.queryByText("agentShippingAgreements.new")).toBeNull();
    expect(screen.queryByText("agentShippingAgreements.actions.duplicate")).toBeNull();
  });

  it("activating a draft that overlaps needs 'replace from' before it can be confirmed", async () => {
    granted.add("agents.agreements.manage");
    api.activate.mockResolvedValue({ ...draft, status: "ACTIVE", activation: null });
    render(<ShippingAgreementSection agentId="agent" currencyCode="EGP" />);
    // History: the draft's number opens it (first = the desktop table row).
    fireEvent.click((await screen.findAllByRole("button", { name: "ASA-2026-0002" }))[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "agentShippingAgreements.actions.activate" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "agentShippingAgreements.actions.activate",
    )!;
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith("agent", "draft", true));
  });
});
