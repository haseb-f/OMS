import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * R22 §2 / §3 — the one voucher card routes each purpose to its voucher type on
 * the same FinancialTransaction API (contract 4), asks only for what the
 * purpose needs, reviews before posting, and signals the refresh.
 */
const settlement = vi.hoisted(() => ({
  get: vi.fn(),
  activities: vi.fn(async () => []),
  openInvoices: vi.fn(async () => []),
  createConfirmed: vi.fn(),
  create: vi.fn(),
  confirm: vi.fn(),
  allocate: vi.fn(),
  unallocate: vi.fn(),
  updateAllocation: vi.fn(),
}));
const other = vi.hoisted(() => ({
  get: vi.fn(),
  activities: vi.fn(async () => []),
  createConfirmed: vi.fn(async () => ({ id: "o1" })),
}));
const transfers = vi.hoisted(() => ({
  get: vi.fn(),
  activities: vi.fn(async () => []),
  createConfirmed: vi.fn(async () => ({ id: "t1" })),
}));
vi.mock("@/services/voucher-services", () => ({
  otherReceiptsService: other,
  otherPaymentsService: other,
  internalTransfersService: transfers,
  counterAccountsService: {
    list: vi.fn(async () => [{ id: "acc-capital", code: "3101", name: "رأس المال" }]),
  },
}));
vi.mock("@/services/receiving-accounts-service", () => ({
  receivingAccountsService: {
    list: async () => [
      { id: "cash", name: "الصندوق الرئيسي", isDefault: true },
      { id: "bank", name: "البنك الأهلي" },
    ],
  },
}));
vi.mock("@/services/payment-sources-service", () => ({
  paymentSourcesService: { list: async () => [] },
}));
vi.mock("@/services/partners-service", () => ({ partnersService: { catalog: vi.fn() } }));
vi.mock("@/hooks/use-reference-data", () => ({ useCurrencies: () => [] }));

// The captured props of the (mocked) editor shell — read loosely in assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editor = vi.hoisted(() => ({ latest: null as null | Record<string, any> }));
vi.mock("@/components/financial-transactions/financial-transaction-editor", () => ({
  FinancialTransactionEditor: (props: Record<string, unknown>) => {
    editor.latest = props;
    return null;
  },
}));

const permissions = vi.hoisted(() => ({ manualEntry: true }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "ar", direction: "rtl" }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({
    user: { id: "u1" },
    hasPermission: (key: string) =>
      !key.startsWith("accounting.journal-entries.") || permissions.manualEntry,
  }),
}));
vi.mock("@/providers/breadcrumb-provider", () => ({ useBreadcrumbLabel: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-print-engine", () => ({ usePrintEngine: () => ({ printDocument: vi.fn() }) }));
vi.mock("@/components/print/print-brand", () => ({ usePrintCompany: () => ({ name: "OMS" }) }));
vi.mock("@/hooks/use-idempotency-key", () => ({ useIdempotencyKey: () => ({ key: "k1" }) }));
vi.mock("@/lib/toast", () => ({ reportApiError: vi.fn(), reportSuccess: vi.fn() }));
vi.mock("@/components/shared/related-records-panel", () => ({ RelatedRecordsPanel: () => null }));
vi.mock("@/components/shared/confirmation-dialog", () => ({ ConfirmationDialog: () => null }));
vi.mock("@/components/shared/detail-workspace", () => ({
  EditorWorkspace: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { VoucherEditorPage, type VoucherPageConfig } from "./voucher-editor-page";

const config = (direction: "IN" | "OUT"): VoucherPageConfig => ({
  direction,
  partyRole: direction === "IN" ? "CUSTOMER" : "SUPPLIER",
  relatedKind: direction === "IN" ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT",
  basePath: direction === "IN" ? "/sales/payments" : "/purchasing/payments",
  permissionPrefix: direction === "IN" ? "sales.receipts" : "purchasing.payments",
  titleKey: "sales.receipts.editorTitle",
  partyLabelKey: "sales.receipts.partyLabel",
  addNewKey: "sales.receipts.addNew",
  docCodePreview: direction === "IN" ? "CR" : "SP",
  service: settlement as never,
  invoiceHref: (id) => `/sales/invoices/${id}`,
  allocationToLine: (allocation) => ({
    id: allocation.id,
    invoiceId: allocation.salesInvoiceId ?? "",
    invoiceNumber: "INV",
    invoiceHref: "",
    remainingBalance: Number(allocation.allocatedAmount),
    allocatedAmount: Number(allocation.allocatedAmount),
  }),
  buildPrint: () => ({}) as never,
});

const latest = () => editor.latest!;
const action = (key: string) =>
  (
    latest().config.workflowActions as { key: string; confirm?: unknown; onAction: () => unknown }[]
  ).find((entry) => entry.key === key);

async function renderCard(direction: "IN" | "OUT" = "IN") {
  render(<VoucherEditorPage id={null} config={config(direction)} />);
  await waitFor(() => expect(editor.latest).not.toBeNull());
  // The default money account is applied by the (mocked) editor — set it like the editor would.
  act(() => latest().handlers.onReceivingAccountChange("cash"));
}

describe("R22 voucher card — purposes route to their voucher types", () => {
  beforeEach(() => {
    permissions.manualEntry = true;
    editor.latest = null;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("a new receipt starts as invoice settlement with every purpose offered", async () => {
    await renderCard("IN");
    expect(latest().state.purpose).toBe("SETTLE_INVOICES");
    expect(latest().config.purposes.map((p: { purpose: string }) => p.purpose)).toEqual([
      "SETTLE_INVOICES",
      "ADVANCE",
      "OTHER",
      "TRANSFER",
    ]);
  });

  it("other / transfer are offered only to holders of the manual journal-entry right (D4)", async () => {
    permissions.manualEntry = false;
    await renderCard("OUT");
    expect(latest().config.purposes.map((p: { purpose: string }) => p.purpose)).toEqual([
      "SETTLE_INVOICES",
      "ADVANCE",
      "EXPENSE",
    ]);
  });

  it("other receipt: no party, a counter-account, reviewed, posted through other-receipts", async () => {
    const signals: unknown[] = [];
    const onSignal = (event: Event) => signals.push((event as CustomEvent).detail);
    window.addEventListener("oms:data-changed", onSignal);
    await renderCard("IN");
    act(() => latest().handlers.onPurposeChange("OTHER"));
    act(() => latest().handlers.onAmountChange(5000));
    // Without the counter-account Confirm reviews nothing and shows the inline error instead.
    expect(action("confirm")?.confirm).toBeUndefined();
    await act(async () => {
      await action("confirm")!.onAction();
    });
    expect(latest().fieldErrors?.counterAccount).toBe("vouchers.validation.counterAccountRequired");
    expect(latest().fieldErrors?.party).toBeUndefined();
    act(() => latest().handlers.onCounterAccountChange("acc-capital"));
    expect(latest().config.transactionType).toBe("OTHER_RECEIPT");
    expect((action("confirm")?.confirm as { extra?: unknown })?.extra).toBeTruthy();
    await act(async () => {
      await action("confirm")!.onAction();
    });
    expect(other.createConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        counterAccountId: "acc-capital",
        receivingAccountId: "cash",
      }),
    );
    expect((other.createConfirmed.mock.calls as unknown[][])[0][0]).not.toHaveProperty("partnerId");
    expect(settlement.createConfirmed).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/sales/payments/o1?purpose=other");
    expect(signals).toContain("settlement");
    window.removeEventListener("oms:data-changed", onSignal);
  });

  it("internal transfer: source + a different destination, posted through transfers", async () => {
    await renderCard("IN");
    act(() => latest().handlers.onPurposeChange("TRANSFER"));
    act(() => latest().handlers.onAmountChange(1200));
    act(() => latest().handlers.onTargetAccountChange("cash"));
    await act(async () => {
      await action("confirm")!.onAction();
    });
    expect(latest().fieldErrors?.targetAccount).toBe("vouchers.validation.sameAccount");
    act(() => latest().handlers.onTargetAccountChange("bank"));
    await act(async () => {
      await action("confirm")!.onAction();
    });
    expect(transfers.createConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1200,
        receivingAccountId: "cash",
        targetReceivingAccountId: "bank",
      }),
    );
  });

  it("direct expense opens the existing Expenses editor (no duplicate flow)", async () => {
    await renderCard("OUT");
    act(() => latest().handlers.onPurposeChange("EXPENSE"));
    expect(router.push).toHaveBeenCalledWith("/finance/expenses/new");
  });

  it("an advance never sends allocations and needs no invoice table", async () => {
    settlement.createConfirmed.mockResolvedValue({ id: "r9" });
    await renderCard("IN");
    act(() => latest().handlers.onPurposeChange("ADVANCE"));
    act(() => latest().handlers.onAmountChange(750));
    expect(latest().allocationSection).toBeNull();
    // A party is still required for an advance.
    await act(async () => {
      await action("confirm")!.onAction();
    });
    expect(latest().fieldErrors?.party).toBe("financialTransactions.validation.partyRequired");
  });
  it("a confirmed receipt with an unapplied part offers «رد دفعة مقدمة» (D4); a fully applied one does not", async () => {
    const row = (allocated: number) => ({
      id: "r1",
      transactionNumber: "CR-1",
      type: "CUSTOMER_RECEIPT",
      status: "CONFIRMED",
      transactionDate: "2026-10-14T00:00:00.000Z",
      amount: "1000",
      currencyId: null,
      partnerId: "p1",
      partner: { id: "p1", name: "عميل" },
      paymentSourceId: null,
      receivingAccountId: "cash",
      referenceNumber: null,
      notes: null,
      updatedAt: "2026-10-14T00:00:00.000Z",
      allocations: allocated
        ? [{ id: "a1", salesInvoiceId: "inv", allocatedAmount: String(allocated) }]
        : [],
    });
    settlement.get.mockResolvedValueOnce(row(0));
    render(<VoucherEditorPage id="r1" config={config("IN")} />);
    await waitFor(() => expect(latest().state.document?.id).toBe("r1"));
    expect(action("refund")).toBeDefined();
    cleanup();
    editor.latest = null;
    settlement.get.mockResolvedValueOnce(row(1000));
    render(<VoucherEditorPage id="r1" config={config("IN")} />);
    await waitFor(() => expect(latest().state.document?.id).toBe("r1"));
    expect(action("refund")).toBeUndefined();
  });
});
