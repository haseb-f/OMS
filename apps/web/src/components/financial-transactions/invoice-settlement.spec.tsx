import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

/**
 * R22 §4 / §5 — invoice settlement summary + history: the API's settlement
 * (contract 2) when present, else the invoice's own links (degraded, no
 * actions); credit notes on their own lines; permitted actions only.
 */
const receipts = vi.hoisted(() => ({
  unallocate: vi.fn(async () => ({})),
  updateAllocation: vi.fn(async () => ({})),
  cancel: vi.fn(async () => ({})),
}));
const salesInvoices = vi.hoisted(() => ({ settlement: vi.fn() }));
vi.mock("@/services/customer-receipts-service", () => ({ customerReceiptsService: receipts }));
vi.mock("@/services/supplier-payments-service", () => ({ supplierPaymentsService: receipts }));
vi.mock("@/services/sales-invoices-service", () => ({ salesInvoicesService: salesInvoices }));
vi.mock("@/services/purchase-invoices-service", () => ({
  purchaseInvoicesService: { settlement: vi.fn() },
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
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/toast", () => ({ reportApiError: vi.fn(), reportSuccess: vi.fn() }));

import {
  InvoiceSettlementHistory,
  settlementFromInvoice,
  useInvoiceSettlement,
  type InvoiceSettlementSource,
} from "./invoice-settlement";
import type { InvoiceSettlement } from "@/services/invoice-settlement-types";
import { TooltipProvider } from "@/components/ui/tooltip";

const renderHistory = (settlement: InvoiceSettlement) =>
  render(
    <TooltipProvider>
      <InvoiceSettlementHistory kind="sales" settlement={settlement} />
    </TooltipProvider>,
  );

const invoice: InvoiceSettlementSource = {
  id: "inv",
  status: "CONFIRMED",
  grandTotal: "200000.00",
  allocatedTotal: 100000,
  remainingBalance: 100000,
  paymentStatus: "PARTIALLY_PAID",
  currency: { code: "EGP" },
  allocations: [
    {
      id: "al1",
      allocatedAmount: "100000",
      transaction: { id: "r1", transactionNumber: "CR-2026-000101", status: "CONFIRMED" },
    },
  ],
  returns: [{ id: "ret1", returnNumber: "SR-2026-000004", status: "CONFIRMED" }],
};

const fromApi: InvoiceSettlement = {
  summary: {
    grandTotal: 200000,
    paidTotal: 100000,
    creditedTotal: 20000,
    remainingBalance: 80000,
    paymentStatus: "PARTIALLY_PAID",
    currencyCode: "EGP",
  },
  entries: [
    {
      kind: "PAYMENT",
      documentId: "r1",
      documentNumber: "CR-2026-000101",
      documentType: "CUSTOMER_RECEIPT",
      date: "2026-10-12T00:00:00.000Z",
      status: "CONFIRMED",
      amount: 100000,
      currencyCode: "EGP",
      allocationId: "al1",
      canUnallocate: true,
      canCancel: false,
    },
    {
      kind: "CREDIT_NOTE",
      documentId: "ret1",
      documentNumber: "SR-2026-000004",
      documentType: "SALES_RETURN",
      date: "2026-10-13T00:00:00.000Z",
      status: "CONFIRMED",
      amount: 20000,
      currencyCode: "EGP",
      canUnallocate: false,
      canCancel: false,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("invoice settlement (R22 contract 2)", () => {
  it("without the endpoint, the invoice's own figures and links are shown — never recomputed", () => {
    const built = settlementFromInvoice("sales", invoice);
    expect(built.summary).toMatchObject({
      grandTotal: 200000,
      paidTotal: 100000,
      creditedTotal: 0,
      remainingBalance: 100000,
    });
    expect(
      built.entries.map((entry) => [entry.kind, entry.documentNumber, entry.canUnallocate]),
    ).toEqual([
      ["PAYMENT", "CR-2026-000101", false],
      ["CREDIT_NOTE", "SR-2026-000004", false],
    ]);
  });

  it("uses the API's settlement for a posted invoice and degrades when the endpoint is missing", async () => {
    salesInvoices.settlement.mockResolvedValueOnce(fromApi);
    const { result } = renderHook(() => useInvoiceSettlement("sales", invoice));
    await waitFor(() => expect(result.current.settlement?.summary.creditedTotal).toBe(20000));
    expect(result.current.partial).toBe(false);

    salesInvoices.settlement.mockRejectedValueOnce(new Error("404"));
    const degraded = renderHook(() => useInvoiceSettlement("sales", { ...invoice, id: "inv2" }));
    await waitFor(() => expect(degraded.result.current.partial).toBe(true));
    expect(degraded.result.current.settlement?.entries).toHaveLength(2);
  });

  it("lists each voucher with date and amount, the credit note on its own line", () => {
    renderHistory(fromApi);
    const rows = [...document.querySelectorAll("tbody tr")].map((row) =>
      row.textContent?.replace(/\s+/g, " "),
    );
    expect(rows[0]).toMatch(/CR-2026-000101.*سند قبض.*100,000\.00 EGP/);
    expect(rows[1]).toMatch(/SR-2026-000004.*إشعار دائن.*20,000\.00 EGP/);
    expect(screen.getByRole("link", { name: "CR-2026-000101" }).getAttribute("href")).toBe(
      "/sales/payments/r1",
    );
  });

  it("offers actions only where the API permits them (none on a credit note)", () => {
    renderHistory(fromApi);
    expect(screen.getAllByRole("button", { name: "إجراءات" })).toHaveLength(1);
    cleanup();
    renderHistory({
      ...fromApi,
      entries: fromApi.entries.map((entry) => ({ ...entry, canUnallocate: false })),
    });
    expect(screen.queryAllByRole("button", { name: "إجراءات" })).toHaveLength(0);
  });
});
