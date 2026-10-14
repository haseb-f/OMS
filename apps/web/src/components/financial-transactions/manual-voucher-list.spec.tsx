import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";

/**
 * R22 D4 — the lists of saved other receipts / other payments / transfers:
 * the right stream-T endpoint, counter-account or from → to accounts, badge
 * status, amount with currency, a link to the voucher card, and a refresh on
 * the `settlement` signal.
 */
const services = vi.hoisted(() => {
  const make = () => ({ list: vi.fn() });
  return { otherReceipts: make(), otherPayments: make(), transfers: make() };
});
vi.mock("@/services/voucher-services", () => ({
  otherReceiptsService: services.otherReceipts,
  otherPaymentsService: services.otherPayments,
  internalTransfersService: services.transfers,
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
vi.mock("@/hooks/use-functional-currency", () => ({ useFunctionalCurrencyCode: () => "EGP" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/sales/payments" }));
vi.mock("@/lib/toast", () => ({ reportApiError: vi.fn() }));
// The shared table itself is covered elsewhere — render its rows from the columns.
vi.mock("@/components/master-data/enterprise-data-table", () => ({
  EnterpriseDataTable: ({
    columns,
    data,
    getRowHref,
  }: {
    columns: (ColumnDef<{ id: string }, unknown> & { id: string })[];
    data: { id: string }[];
    getRowHref: (row: { id: string }) => string;
  }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={row.id} data-href={getRowHref(row)}>
            {columns.map((column) => (
              <td key={column.id} data-col={column.id}>
                {typeof column.cell === "function"
                  ? (column.cell as (ctx: unknown) => React.ReactNode)({ row: { original: row } })
                  : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock("@/components/shared/data-table", () => ({ MultiSelectFilter: () => null }));
vi.mock("@/components/shared/data-table/clear-filters-button", () => ({
  ClearFiltersButton: () => null,
}));
vi.mock("@/components/shared/date-range-picker", () => ({ EnterpriseDateRangePicker: () => null }));

import { ManualVoucherList } from "./manual-voucher-list";
import { notifyDataChanged } from "@/hooks/use-data-changed";

const voucher = (extra: Record<string, unknown>) => ({
  id: "v1",
  transactionNumber: "OR-2026-000001",
  status: "CONFIRMED",
  transactionDate: "2026-10-14T00:00:00.000Z",
  amount: "2500",
  currency: null,
  referenceNumber: null,
  receivingAccount: { id: "cash", name: "الصندوق الرئيسي" },
  allocations: [],
  ...extra,
});
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("R22 manual-entry voucher lists", () => {
  it("other receipts: other-receipts endpoint, counter-account, badge, amount + currency, card link", async () => {
    services.otherReceipts.list.mockResolvedValue(
      page([voucher({ counterAccount: { id: "c", code: "3101", name: "رأس المال" } })]),
    );
    render(<ManualVoucherList kind="OTHER_RECEIPT" />);
    await waitFor(() => expect(screen.getByText("3101 · رأس المال")).toBeTruthy());
    expect(services.otherReceipts.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, sortBy: "transactionDate" }),
    );
    expect(document.querySelector('[data-col="amount"]')?.textContent).toContain("2,500.00 EGP");
    expect(document.querySelector('[data-col="status"]')?.textContent).toBe("مؤكد");
    expect(document.querySelector("tr")?.getAttribute("data-href")).toBe(
      "/sales/payments/v1?purpose=other",
    );
  });

  it("transfers: from → to accounts, opened as a transfer", async () => {
    services.transfers.list.mockResolvedValue(
      page([
        voucher({
          transactionNumber: "TR-2026-000001",
          targetReceivingAccount: { id: "bank", name: "البنك الأهلي" },
        }),
      ]),
    );
    render(<ManualVoucherList kind="INTERNAL_TRANSFER" />);
    await waitFor(() => expect(screen.getByText("الصندوق الرئيسي")).toBeTruthy());
    expect(document.querySelector('[data-col="accounts"]')?.textContent).toContain("البنك الأهلي");
    expect(document.querySelector("tr")?.getAttribute("data-href")).toBe(
      "/purchasing/payments/v1?purpose=transfer",
    );
  });

  it("other payments re-read after a money operation (settlement signal)", async () => {
    services.otherPayments.list.mockResolvedValue(page([]));
    render(<ManualVoucherList kind="OTHER_PAYMENT" />);
    await waitFor(() => expect(services.otherPayments.list).toHaveBeenCalledTimes(1));
    act(() => notifyDataChanged("settlement"));
    await waitFor(() => expect(services.otherPayments.list).toHaveBeenCalledTimes(2));
  });
});
