import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

const permissions = new Set<string>();
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ hasPermission: (name: string) => permissions.has(name) }),
}));

const advanced = vi.fn();
vi.mock("@/services/customer-lookup-service", () => ({
  customerLookupService: { advanced: (query: string) => advanced(query) },
}));

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ApiError } from "@/services/api-client";
import {
  AdvancedCustomerLookupButton,
  AdvancedCustomerLookupDialog,
  isMeaningfulLookupQuery,
} from "./advanced-customer-lookup-dialog";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  advanced.mockReset();
  permissions.clear();
});

describe("isMeaningfulLookupQuery", () => {
  it("needs 7+ digits for a phone or 3+ letters for a name", () => {
    expect(isMeaningfulLookupQuery("0501234")).toBe(true);
    expect(isMeaningfulLookupQuery("050123")).toBe(false);
    expect(isMeaningfulLookupQuery("Ali")).toBe(true);
    expect(isMeaningfulLookupQuery("Al")).toBe(false);
    expect(isMeaningfulLookupQuery("  ")).toBe(false);
    // Arabic digits and an OMS order number are accepted too.
    expect(isMeaningfulLookupQuery("٠٥٠١٢٣٤٥٦٧")).toBe(true);
    expect(isMeaningfulLookupQuery("STO-2026-027225")).toBe(true);
  });
});

describe("AdvancedCustomerLookupButton", () => {
  it("renders nothing without customers.lookup_advanced", () => {
    const { container } = render(<AdvancedCustomerLookupButton />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the trigger with the permission", () => {
    permissions.add("customers.lookup_advanced");
    render(<AdvancedCustomerLookupButton />);
    expect(screen.getByTestId("advanced-customer-lookup-trigger")).toBeTruthy();
  });
});

describe("AdvancedCustomerLookupDialog", () => {
  const type = (value: string) => {
    fireEvent.change(screen.getByPlaceholderText("customerLookup.placeholder"), {
      target: { value },
    });
  };

  it("does not call the API for a too-short query", () => {
    render(<AdvancedCustomerLookupDialog open onOpenChange={() => {}} />);
    type("12");
    fireEvent.click(screen.getByText("customerLookup.search"));
    expect(advanced).not.toHaveBeenCalled();
  });

  it("renders only the minimal disclosed fields, and a link only when openable", async () => {
    advanced.mockResolvedValue({
      exists: true,
      capped: false,
      remainingInWindow: 12,
      matches: [
        {
          kind: "CUSTOMER",
          maskedPhone: "+966••••••567",
          partialName: "Ah••• Sa•••",
          reference: { type: "ORDER", number: "SO-1", status: "IN_PROGRESS" },
          previousOrders: [],
          notAssignedToYou: true,
          openable: null,
        },
        {
          kind: "CUSTOMER",
          maskedPhone: "+966••••••999",
          partialName: "Mo•••",
          reference: { type: "ORDER", number: "SO-2", status: "COMPLETED" },
          previousOrders: [
            { id: "abc", number: "SO-2", orderDate: "2026-10-01", status: "COMPLETED" },
            { id: "old", number: "SO-0", orderDate: "2026-09-01", status: "COMPLETED" },
          ],
          notAssignedToYou: false,
          openable: { type: "ORDER", id: "abc" },
        },
      ],
    });
    render(<AdvancedCustomerLookupDialog open onOpenChange={() => {}} />);
    type("0501234567");
    fireEvent.click(screen.getByText("customerLookup.search"));
    await waitFor(() => expect(screen.getByText("SO-1")).toBeTruthy());
    expect(advanced).toHaveBeenCalledWith("0501234567");
    expect(screen.getByText("+966••••••567")).toBeTruthy();
    expect(screen.getByText("customerLookup.notAssignedToYou")).toBeTruthy();
    expect(screen.getByText("customerLookup.assignedToYou")).toBeTruthy();
    // Links only where the caller already has scope: the open link and their own earlier order.
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links.sort()).toEqual(["/store-orders/abc", "/store-orders/old"]);
    // Somebody else's customer lists no history.
    expect(screen.queryByText("SO-1", { selector: "a" })).toBeNull();
    expect(screen.getByText("customerLookup.noAccess")).toBeTruthy();
  });

  it("is honest about an empty result, a throttle and a failure", async () => {
    advanced.mockResolvedValueOnce({
      exists: false,
      matches: [],
      capped: false,
      remainingInWindow: 5,
    });
    render(<AdvancedCustomerLookupDialog open onOpenChange={() => {}} />);
    type("0501234567");
    fireEvent.click(screen.getByText("customerLookup.search"));
    await waitFor(() => expect(screen.getByTestId("advanced-lookup-empty")).toBeTruthy());

    advanced.mockRejectedValueOnce(new ApiError(429, "slow down", undefined));
    fireEvent.click(screen.getByText("customerLookup.search"));
    await waitFor(() => expect(screen.getByText("customerLookup.rateLimited")).toBeTruthy());

    advanced.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByText("customerLookup.search"));
    await waitFor(() => expect(screen.getByText("customerLookup.error")).toBeTruthy());
  });
});
