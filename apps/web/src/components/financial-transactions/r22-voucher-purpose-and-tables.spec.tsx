import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * R22 I-B — FAILING regression cases (phase 1, no production fix yet):
 *  §2 a receipt / payment states its operation purpose (customer invoice settlement,
 *     advance, other receipt, …) and the money account is labelled for its direction;
 *  §5 the editor's open-invoices table keeps every header over its figures in Arabic
 *     (measured: headers on the left edge, figures on the right — `.num` (direction: ltr)
 *     + `text-end` on the cells, open-invoices-table.tsx:299-316);
 *  §4 a confirmed voucher's open-invoices row reports the invoice's remaining balance
 *     under «المتبقي» (measured: 160,000 shown, invoice really 60,000 open).
 * See specs/round22-settlement/investigation-ui.md.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/purchasing/payments/new",
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
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-element-width", () => ({ useElementWidth: () => 1200 }));
vi.mock("@/services/payment-sources-service", () => ({
  paymentSourcesService: { list: () => Promise.resolve([]) },
}));
vi.mock("@/services/receiving-accounts-service", () => ({
  receivingAccountsService: { list: () => Promise.resolve([]) },
}));
vi.mock("@/services/financial-transaction-types-service", () => ({
  financialTransactionTypesService: { list: () => Promise.resolve([]) },
}));

import { FinancialTransactionEditor } from "./financial-transaction-editor";
import { OpenInvoicesTable } from "./open-invoices-table";
import type { FinancialTransactionEditorConfig } from "./financial-transaction-editor.types";
import { buildTransactionStatusOptions } from "@/config/financial-transactions/status";
import type { OpenInvoiceRow } from "@/services/financial-transactions-service";

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

function renderEditor(direction: "IN" | "OUT") {
  const config = {
    title: direction === "IN" ? "سند قبض" : "سند صرف",
    partyLabel: direction === "IN" ? "العميل" : "المورد",
    transactionType: direction === "IN" ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT",
    direction,
    permissions: { create: "x", edit: "x", confirm: "x", cancel: "x" },
    statusOptions: buildTransactionStatusOptions(((key: string) => key) as never),
    workflowActions: [],
  } as FinancialTransactionEditorConfig;
  return render(
    <FinancialTransactionEditor
      config={config}
      state={{
        document: null,
        documentNumber: null,
        status: "DRAFT",
        transactionDate: new Date("2026-10-14T10:00:00Z"),
        amount: 0,
        referenceNumber: "",
        notes: "",
        paymentSourceId: null,
        receivingAccountId: null,
        allocations: [],
      }}
      handlers={{
        onTransactionDateChange: () => {},
        onAmountChange: () => {},
        onReferenceNumberChange: () => {},
        onNotesChange: () => {},
        onPaymentSourceChange: () => {},
        onReceivingAccountChange: () => {},
        onAllocationsChange: () => {},
      }}
      renderPartyPicker={({ id }) => <input id={id} aria-label="party" />}
    />,
  );
}

describe("R22 §2 — operation purpose and money account", () => {
  it("a new receipt lets the user choose its operation purpose (not a fixed, disabled type)", async () => {
    renderEditor("IN");
    const trigger = await screen.findByLabelText("نوع الحركة");
    expect(trigger.hasAttribute("disabled") || trigger.getAttribute("data-disabled") !== null).toBe(
      false,
    );
  });

  it("a supplier payment names the account the money leaves from — not «حساب الاستلام»", async () => {
    renderEditor("OUT");
    await waitFor(() => expect(screen.getByLabelText("نوع الحركة")).toBeTruthy());
    expect(screen.queryByText("حساب الاستلام")).toBeNull();
  });
});

const invoice: OpenInvoiceRow = {
  invoiceId: "inv",
  invoiceNumber: "INV-2026-000028",
  documentDate: "2026-10-14T10:00:00Z",
  currencyId: null,
  currencyCode: null,
  grandTotal: 200000,
  allocatedTotal: 140000,
  remainingBalance: 60000,
  paymentStatus: "PARTIALLY_PAID",
};

describe("R22 §5 — editor open-invoices table (Arabic)", () => {
  it("every money cell is aligned like its header (no dir=ltr + text-end flip in RTL)", () => {
    render(
      <OpenInvoicesTable
        invoices={[invoice]}
        allocations={[{ invoiceId: "inv", allocatedAmount: 100000 }]}
        confirmedVoucher
      />,
    );
    const headers = [...document.querySelectorAll("thead th")];
    const cells = [...document.querySelectorAll("tbody tr:first-child td")];
    // `.num` (theme/tokens.css:77) sets `direction: ltr`, so `text-end` on a `.num` (or dir="ltr")
    // cell resolves to the RIGHT edge in Arabic while its header's `text-end` resolves to the LEFT.
    const ltrBox = (el: Element) =>
      el.getAttribute("dir") === "ltr" || el.classList.contains("num");
    const flipped = cells
      .map((cell, index) => ({ cell, header: headers[index] }))
      .filter(
        ({ cell, header }) =>
          header?.classList.contains("text-end") &&
          !ltrBox(header) &&
          ltrBox(cell) &&
          cell.classList.contains("text-end"),
      )
      .map(({ header }) => header?.textContent);
    expect(flipped).toEqual([]);
  });

  it("a confirmed voucher shows the invoice's real remaining balance under «المتبقي»", () => {
    render(
      <OpenInvoicesTable
        invoices={[invoice]}
        allocations={[{ invoiceId: "inv", allocatedAmount: 100000 }]}
        confirmedVoucher
      />,
    );
    const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    const index = headers.indexOf("المتبقي");
    const cell = document.querySelectorAll("tbody tr:first-child td")[index];
    // measured on the local build: 160,000.00 (the balance BEFORE this voucher) under «المتبقي»
    expect(cell?.textContent?.trim()).toMatch(/^60,000\.00/);
  });
});
