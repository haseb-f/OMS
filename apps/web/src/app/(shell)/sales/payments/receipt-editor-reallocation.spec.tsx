import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * R22 I-A — DEFECT R22-W1. Changing the amount of an allocation on a CONFIRMED
 * receipt must be one server operation: today the editor calls Unallocate and
 * then Allocate. When the second call is refused (e.g. the invoice has less
 * left than the new amount) the first has already removed the line — the
 * invoice silently loses its settlement — and the editor keeps showing the old
 * line (no refresh on failure).
 *
 * The fake API below is stateful (it enforces the invoice balance like the
 * server). The repair is expected to use one atomic call,
 * `customerReceiptsService.updateAllocation(id, allocationId, { allocatedAmount })`
 * (PATCH …/allocations/:allocationId), which the fake implements atomically.
 */

type Line = { id: string; salesInvoiceId: string; allocatedAmount: string };
const server = vi.hoisted(() => ({
  invoiceTotal: 220_000,
  /** Paid on the invoice by other vouchers. */
  otherPaid: 100_000,
  lines: [] as Line[],
}));
const free = () =>
  server.invoiceTotal -
  server.otherPaid -
  server.lines.reduce((sum, line) => sum + Number(line.allocatedAmount), 0);
const receiptRow = () => ({
  id: "r1",
  transactionNumber: "CR-TEST-1",
  type: "CUSTOMER_RECEIPT",
  status: "CONFIRMED",
  transactionDate: "2026-10-14T00:00:00.000Z",
  amount: "200000",
  feeAmount: "0",
  currencyId: null,
  currency: null,
  partnerId: "p1",
  partner: { id: "p1", name: "عميل", partnerNumber: "C-1" },
  paymentSourceId: null,
  receivingAccountId: "ra1",
  referenceNumber: null,
  notes: null,
  allocations: server.lines.map((line) => ({
    ...line,
    salesInvoice: { id: line.salesInvoiceId, invoiceNumber: "INV-1", grandTotal: "220000" },
    storeOrderId: null,
  })),
});

const api = vi.hoisted(() => ({
  get: vi.fn(),
  activities: vi.fn(async () => []),
  openInvoices: vi.fn(),
  unallocate: vi.fn(),
  allocate: vi.fn(),
  updateAllocation: vi.fn(),
}));
vi.mock("@/services/customer-receipts-service", () => ({ customerReceiptsService: api }));
vi.mock("@/services/partners-service", () => ({ partnersService: { catalog: vi.fn() } }));

const editor = vi.hoisted(() => ({
  latest: null as null | {
    state: { allocations: { id: string; invoiceId: string; allocatedAmount: number }[] };
    handlers: { onAllocationsChange: (lines: unknown[]) => Promise<void> | void };
  },
}));
vi.mock("@/components/financial-transactions/financial-transaction-editor", () => ({
  FinancialTransactionEditor: (props: (typeof editor)["latest"]) => {
    editor.latest = props;
    return null;
  },
}));

const locale = vi.hoisted(() => ({ t: (key: string) => key, locale: "ar", direction: "rtl" }));
vi.mock("@/providers/locale-provider", () => ({ useLocale: () => locale }));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: { id: "u1" }, hasPermission: () => true }),
}));
vi.mock("@/providers/breadcrumb-provider", () => ({ useBreadcrumbLabel: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-print-engine", () => ({ usePrintEngine: () => ({ printDocument: vi.fn() }) }));
vi.mock("@/components/print/print-brand", () => ({ usePrintCompany: () => null }));
vi.mock("@/hooks/use-idempotency-key", () => ({ useIdempotencyKey: () => ({ key: "k1" }) }));
vi.mock("@/lib/toast", () => ({ reportApiError: vi.fn(), reportSuccess: vi.fn() }));
vi.mock("@/components/shared/related-records-panel", () => ({ RelatedRecordsPanel: () => null }));
vi.mock("@/components/shared/confirmation-dialog", () => ({ ConfirmationDialog: () => null }));
vi.mock("@/components/shared/detail-workspace", () => ({
  EditorWorkspace: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { ReceiptEditorPage } from "./receipt-editor-page";

function installFakeApi() {
  server.lines = [{ id: "a1", salesInvoiceId: "inv1", allocatedAmount: "100000" }];
  api.get.mockImplementation(async () => receiptRow());
  api.openInvoices.mockImplementation(async () => [
    {
      invoiceId: "inv1",
      invoiceNumber: "INV-1",
      documentDate: "2026-10-01T00:00:00.000Z",
      currencyId: null,
      currencyCode: null,
      grandTotal: server.invoiceTotal,
      allocatedTotal: server.invoiceTotal - free(),
      remainingBalance: free(),
      paymentStatus: "PARTIALLY_PAID",
    },
  ]);
  api.unallocate.mockImplementation(async (_id: string, allocationId: string) => {
    server.lines = server.lines.filter((line) => line.id !== allocationId);
    return receiptRow();
  });
  api.allocate.mockImplementation(
    async (_id: string, dto: { invoiceId: string; allocatedAmount: number }) => {
      if (dto.allocatedAmount > free()) throw new Error("only less remains unpaid");
      server.lines.push({
        id: `a${server.lines.length + 2}`,
        salesInvoiceId: dto.invoiceId,
        allocatedAmount: String(dto.allocatedAmount),
      });
      return receiptRow();
    },
  );
  api.updateAllocation.mockImplementation(
    async (_id: string, allocationId: string, dto: { allocatedAmount: number }) => {
      const line = server.lines.find((row) => row.id === allocationId)!;
      if (dto.allocatedAmount - Number(line.allocatedAmount) > free()) {
        throw new Error("only less remains unpaid");
      }
      line.allocatedAmount = String(dto.allocatedAmount);
      return receiptRow();
    },
  );
}

describe("DEFECT R22-W1 — reallocating a posted receipt line is atomic", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("a refused new amount keeps the invoice's existing allocation and the editor shows the server's lines", async () => {
    installFakeApi();
    render(<ReceiptEditorPage id="r1" />);
    await waitFor(() => expect(editor.latest?.state.allocations).toHaveLength(1));
    const [line] = editor.latest!.state.allocations;

    // 100,000 → 150,000 while only 20,000 more is free on the invoice: refused.
    await act(async () => {
      await editor.latest!.handlers.onAllocationsChange([{ ...line, allocatedAmount: 150_000 }]);
    });

    // The invoice still carries its 100,000 settlement on the server…
    expect(server.lines).toEqual([{ id: "a1", salesInvoiceId: "inv1", allocatedAmount: "100000" }]);
    // …and the editor shows exactly what the server holds.
    await waitFor(() =>
      expect(editor.latest!.state.allocations.map((row) => row.allocatedAmount)).toEqual([100_000]),
    );
  });
});
