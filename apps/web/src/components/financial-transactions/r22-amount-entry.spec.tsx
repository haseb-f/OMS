import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

/**
 * R22 I-B — FAILING regression cases (phase 1, no production fix yet) for the
 * receipt / payment amount field the owner brief §3 describes:
 *   «المبلغ المقبوض» / «المبلغ المدفوع» label, visible currency, empty initial
 *   value, «أدخل المبلغ» placeholder, comfortable numeric entry (decimals,
 *   paste of a grouped figure, Arabic-Indic digits).
 * Each `it` names the brief requirement it guards. See
 * specs/round22-settlement/investigation-ui.md §3.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sales/payments/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/providers/locale-provider", async () => {
  const { messages } = await import("@/i18n/messages");
  const { translate } = await import("@/i18n/translate");
  return {
    useLocale: () => ({
      t: (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
        translate(messages.ar, key, params),
      locale: "ar",
      direction: "rtl",
    }),
  };
});
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: { id: "u1" }, isSuperAdmin: true, hasPermission: () => true }),
}));
vi.mock("@/services/payment-sources-service", () => ({
  paymentSourcesService: { list: () => Promise.resolve([]) },
}));
vi.mock("@/services/receiving-accounts-service", () => ({
  receivingAccountsService: {
    list: () => Promise.resolve([{ id: "bank", name: "البنك الرئيسي", isDefault: true }]),
  },
}));
vi.mock("@/services/financial-transaction-types-service", () => ({
  financialTransactionTypesService: { list: () => Promise.resolve([]) },
}));

import { FinancialTransactionEditor } from "./financial-transaction-editor";
import type {
  FinancialTransactionEditorConfig,
  FinancialTransactionEditorState,
} from "./financial-transaction-editor.types";
import { buildTransactionStatusOptions } from "@/config/financial-transactions/status";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const identity = (key: string) => key;

function config(direction: "IN" | "OUT"): FinancialTransactionEditorConfig {
  return {
    title: direction === "IN" ? "سند قبض" : "سند صرف",
    partyLabel: direction === "IN" ? "العميل" : "المورد",
    transactionType: direction === "IN" ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT",
    direction,
    docCodePreview: direction === "IN" ? "CR" : "SP",
    permissions: { create: "x", edit: "x", confirm: "x", cancel: "x" },
    statusOptions: buildTransactionStatusOptions(identity as never),
    workflowActions: [],
  } as FinancialTransactionEditorConfig;
}

/** The editor exactly as the receipt / payment pages drive it: amount is a number state, 0 = unset. */
function Harness({
  direction = "IN",
  initialAmount = 0,
  currencyCode = "EGP",
  onAmount,
}: {
  direction?: "IN" | "OUT";
  initialAmount?: number;
  currencyCode?: string;
  onAmount?: (value: number) => void;
}) {
  const [amount, setAmount] = useState(initialAmount);
  const state: FinancialTransactionEditorState = {
    document: null,
    documentNumber: null,
    status: "DRAFT",
    transactionDate: new Date("2026-10-14T10:00:00Z"),
    amount,
    referenceNumber: "",
    notes: "",
    paymentSourceId: null,
    receivingAccountId: "bank",
    allocations: [],
  };
  return (
    <FinancialTransactionEditor
      config={config(direction)}
      state={state}
      currencyCode={currencyCode}
      handlers={{
        onTransactionDateChange: () => {},
        onAmountChange: (value) => {
          setAmount(value);
          onAmount?.(value);
        },
        onReferenceNumberChange: () => {},
        onNotesChange: () => {},
        onPaymentSourceChange: () => {},
        onReceivingAccountChange: () => {},
        onAllocationsChange: () => {},
      }}
      renderPartyPicker={({ id }) => <input id={id} aria-label="party" />}
    />
  );
}

const amountField = () =>
  document.querySelector<HTMLInputElement>('[data-field-name="amount"] input')!;

describe("R22 §3 — receipt / payment amount field", () => {
  it("starts genuinely empty (never a prefilled 0) on a new voucher", async () => {
    render(<Harness />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    expect(amountField().value).toBe("");
  });

  it("a receipt labels the amount «المبلغ المقبوض» (persistent accessible label)", async () => {
    render(<Harness direction="IN" />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    expect(screen.getByLabelText(/المبلغ المقبوض/)).toBe(amountField());
  });

  it("a payment labels the amount «المبلغ المدفوع»", async () => {
    render(<Harness direction="OUT" />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    expect(screen.getByLabelText(/المبلغ المدفوع/)).toBe(amountField());
  });

  it("uses the subtle placeholder «أدخل المبلغ», not an illustrative 0.00", async () => {
    render(<Harness />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    expect(amountField().placeholder).toBe("أدخل المبلغ");
  });

  it("shows the currency inside the amount field group", async () => {
    render(<Harness currencyCode="SAR" />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    const group = document.querySelector('[data-field-name="amount"]')!;
    expect(group.textContent).toContain("SAR");
  });

  it("accepts a pasted grouped figure «1,234.50» as 1234.5", async () => {
    let latest = -1;
    render(<Harness onAmount={(value) => (latest = value)} />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    fireEvent.change(amountField(), { target: { value: "1,234.50" } });
    expect(latest).toBe(1234.5);
  });

  it("accepts Arabic-Indic digits «١٢٣٤٫٥» as 1234.5", async () => {
    let latest = -1;
    render(<Harness onAmount={(value) => (latest = value)} />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    fireEvent.change(amountField(), { target: { value: "١٢٣٤٫٥" } });
    expect(latest).toBe(1234.5);
  });

  it("keeps a leading «0» while the user types «0.5» (no field reset mid-entry)", async () => {
    render(<Harness />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    fireEvent.change(amountField(), { target: { value: "0" } });
    expect(amountField().value).toBe("0");
  });

  it("preserves a saved amount when editing a draft", async () => {
    render(<Harness initialAmount={100000} />);
    await waitFor(() => expect(amountField()).toBeTruthy());
    expect(Number(amountField().value.replace(/,/g, ""))).toBe(100000);
  });
});
