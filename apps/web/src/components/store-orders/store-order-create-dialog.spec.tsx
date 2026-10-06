import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ hasPermission: () => false }),
}));

vi.mock("@/hooks/use-reference-data", () => {
  const countries = [
    {
      id: "sa",
      code: "SA",
      name: "السعودية",
      nameEn: "Saudi Arabia",
      iso3: "SAU",
      defaultCurrencyId: "sar",
    },
  ];
  const currencies = [{ id: "sar", code: "SAR", name: "Saudi Riyal" }];
  return { useCountries: () => countries, useCurrencies: () => currencies };
});

// The duplicate check is driven by the test (no debounce / network).
const duplicateState = vi.hoisted(() => ({ blocked: false, status: "idle" as string }));
vi.mock("@/hooks/use-duplicate-check", () => ({
  useDuplicateCheck: () => ({
    state: { status: duplicateState.status, key: "", result: null, choice: null },
    blocked: duplicateState.blocked,
    resolution: undefined,
    choose: vi.fn(),
    applyServerResult: vi.fn(),
  }),
}));
vi.mock("@/components/business/duplicate-customer-panel", () => ({
  DuplicateCustomerPanel: () => null,
}));
vi.mock("@/components/business/partner-picker", () => ({ PartnerPicker: () => null }));

// A stand-in line grid: one button adds a priced line.
vi.mock("@/components/sales/product-line-items-grid", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/sales/product-line-items-grid")>();
  return {
    ...actual,
    ProductLineItemsGrid: ({ onChange }: { onChange: (lines: unknown[]) => void }) => (
      <button
        type="button"
        data-testid="add-line"
        onClick={() =>
          onChange([
            {
              ...actual.createEmptyLine(),
              product: { id: "p1", name: "Mug", displayName: "Mug", itemType: "PHYSICAL" },
              quantity: 2,
              unitPrice: 50,
              priceBlank: false,
            },
          ])
        }
      >
        add line
      </button>
    ),
  };
});

const create = vi.hoisted(() => vi.fn());
vi.mock("@/services/store-orders-service", () => ({
  storeOrdersService: {
    create: (payload: unknown) => create(payload),
    receipts: { upload: vi.fn(), attach: vi.fn(), archive: vi.fn() },
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  reportApiError: vi.fn(),
  reportSuccess: vi.fn(),
}));

import { ApiError } from "@/services/api-client";
import { StoreOrderCreateDialog } from "./store-order-create-dialog";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  create.mockReset();
  duplicateState.blocked = false;
  duplicateState.status = "idle";
});

const prefill = { name: "Ali Hassan", phone: "+966501234567", countryId: "sa" };
const currentStep = () => document.querySelector("[data-step]")?.getAttribute("data-step") ?? null;
const next = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("step-flow-next"));
  });
};

function renderDialog(props: Partial<Parameters<typeof StoreOrderCreateDialog>[0]> = {}) {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <StoreOrderCreateDialog
      open
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      prefillCustomer={prefill}
      {...props}
    />,
  );
  return { onCreated, onOpenChange };
}

async function goToReview() {
  await next(); // customer → products
  fireEvent.click(screen.getByTestId("add-line"));
  await next(); // products → delivery & payment
  await waitFor(() => expect(currentStep()).toBe("deliveryPayment"));
  await next(); // → review
  await waitFor(() => expect(currentStep()).toBe("review"));
}

describe("StoreOrderCreateDialog steps", () => {
  it("starts on Customer and Next validates only that step", async () => {
    renderDialog({ prefillCustomer: null });
    expect(currentStep()).toBe("customer");
    await next();
    expect(currentStep()).toBe("customer");
    await waitFor(() =>
      expect(
        document.querySelector('input[name="customerName"]')?.getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    // The step header lists all four steps with the first current.
    const states = [...document.querySelectorAll("ol > li")].map((li) =>
      li.getAttribute("data-state"),
    );
    expect(states).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
  });

  it("an unanswered duplicate match keeps the user on step 1", async () => {
    duplicateState.blocked = true;
    duplicateState.status = "ready";
    renderDialog();
    await next();
    expect(currentStep()).toBe("customer");
    expect(screen.getAllByText("orderDuplicates.required").length).toBeGreaterThan(0);
  });

  it("products need a line before moving on; values survive Back / Next", async () => {
    renderDialog();
    await next();
    await waitFor(() => expect(currentStep()).toBe("products"));
    await next();
    expect(currentStep()).toBe("products");
    expect(screen.getByText("storeOrders.createDialog.items.required")).toBeTruthy();

    fireEvent.click(screen.getByTestId("add-line"));
    await next();
    await waitFor(() => expect(currentStep()).toBe("deliveryPayment"));
    await next();
    await waitFor(() => expect(currentStep()).toBe("review"));
    expect(screen.getByTestId("order-review").textContent).toContain("Mug");
    expect(screen.getByTestId("order-review").textContent).toContain("Ali Hassan");

    // A completed step header goes back; the entered data is still there.
    fireEvent.click(
      screen.getByRole("button", { name: /storeOrders.createDialog.steps.customer/ }),
    );
    await waitFor(() => expect(currentStep()).toBe("customer"));
    expect((document.querySelector('input[name="customerName"]') as HTMLInputElement).value).toBe(
      "Ali Hassan",
    );
  });

  it("creates once with the idempotency key, even on a double click", async () => {
    let resolve: (value: unknown) => void = () => {};
    create.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { onCreated } = renderDialog();
    await goToReview();
    const final = screen.getByTestId("step-flow-final");
    await act(async () => {
      fireEvent.click(final);
      fireEvent.click(final);
    });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const payload = create.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof payload.creationIdempotencyKey).toBe("string");
    expect(payload.currencyId).toBe("sar");
    expect(payload.items).toEqual([{ productId: "p1", quantity: 2, unitPrice: 50 }]);
    await act(async () => resolve({ id: "o1" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "o1" }));
  });

  it("a server field error returns to the step holding the field; a retry reuses the key", async () => {
    create.mockRejectedValueOnce(
      new ApiError(400, "Name taken", "VALIDATION_ERROR", [
        { field: "customerName", constraints: ["unique"] },
      ]),
    );
    renderDialog();
    await goToReview();
    await act(async () => {
      fireEvent.click(screen.getByTestId("step-flow-final"));
    });
    await waitFor(() => expect(currentStep()).toBe("customer"));
    expect(document.querySelector('input[name="customerName"]')?.getAttribute("aria-invalid")).toBe(
      "true",
    );
    const firstKey = (create.mock.calls[0][0] as { creationIdempotencyKey: string })
      .creationIdempotencyKey;

    create.mockResolvedValueOnce({ id: "o2" });
    fireEvent.change(document.querySelector('input[name="customerName"]')!, {
      target: { value: "Ali Hassan Omar" },
    });
    await goToReview();
    await act(async () => {
      fireEvent.click(screen.getByTestId("step-flow-final"));
    });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(
      (create.mock.calls[1][0] as { creationIdempotencyKey: string }).creationIdempotencyKey,
    ).toBe(firstKey);
  });
});
