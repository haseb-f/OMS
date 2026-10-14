import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef } from "@tanstack/react-table";

/**
 * R22 I-B — FAILING regression cases (phase 1, no production fix yet) for the
 * invoice list presentation the owner brief §5 asks for: total / paid /
 * remaining / payment status immediately visible, explicit currency labels,
 * numeric (end-aligned, sortable) amount columns, no money figure parked in a
 * start-aligned status column. See specs/round22-settlement/investigation-ui.md §4–§5.
 */
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "ar", direction: "rtl" }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: { id: "u1" }, isSuperAdmin: true, hasPermission: () => true }),
}));

import { resolveColumnLayout } from "@/components/shared/data-table/column-engine";
import { buildInvoiceColumns as buildSalesInvoiceColumns } from "@/config/sales/invoice-columns";
import { buildInvoiceColumns as buildPurchaseInvoiceColumns } from "@/config/purchasing/invoice-columns";

const handlers = {
  usersById: {},
  onView: () => {},
  onDuplicate: () => {},
  onPrint: () => {},
  onCancel: () => {},
  onArchive: () => {},
  onPost: () => {},
};

const row = {
  id: "inv",
  invoiceNumber: "INV-2026-000091",
  referenceNumber: null,
  status: "CONFIRMED",
  grandTotal: "200000.00",
  allocatedTotal: 100000,
  remainingBalance: 100000,
  paymentStatus: "PARTIALLY_PAID",
  currency: { code: "EGP" },
  partner: { name: "دار الهدى للنشر", phone: null },
  createdAt: "2026-10-11T12:56:50.000Z",
  createdBy: null,
};

type AnyColumn = ColumnDef<typeof row, unknown> & { id: string };

const tables: [string, AnyColumn[]][] = [
  ["sales invoices", buildSalesInvoiceColumns(handlers as never) as unknown as AnyColumn[]],
  ["purchase invoices", buildPurchaseInvoiceColumns(handlers as never) as unknown as AnyColumn[]],
];

const MONEY_IDS = ["grandTotal", "allocatedTotal", "remainingBalance"] as const;

function renderCell(column: AnyColumn): string {
  const cell = column.cell;
  if (typeof cell !== "function") return "";
  return renderToStaticMarkup(
    <>
      {(cell as (ctx: unknown) => React.ReactNode)({
        row: { original: row },
        getValue: () => null,
      })}
    </>,
  );
}

describe.each(tables)("R22 §5 — %s list columns", (_name, columns) => {
  const byId = new Map(columns.map((column) => [column.id, column]));

  it.each(MONEY_IDS)("%s is visible by default (total / paid / remaining at a glance)", (id) => {
    expect(byId.get(id)?.meta?.defaultHidden ?? false).toBe(false);
  });

  it.each(MONEY_IDS)("%s declares type money and resolves to the numeric end edge", (id) => {
    const column = byId.get(id)!;
    expect(column.meta?.type).toBe("money");
    expect(resolveColumnLayout(id, column.meta).align).toBe("end");
  });

  it.each(MONEY_IDS)("%s is sortable (numeric sort on the amount itself)", (id) => {
    expect(byId.get(id)?.enableSorting).not.toBe(false);
  });

  it.each(MONEY_IDS)("%s shows its currency code beside the figure", (id) => {
    expect(renderCell(byId.get(id)!)).toContain("EGP");
  });

  it("the document-status column carries no amount (money lives in end-aligned money columns)", () => {
    const html = renderCell(byId.get("status")!);
    expect(html).not.toMatch(/200,000/);
  });

  it("the payment-status column carries no amount (remaining has its own money column)", () => {
    const html = renderCell(byId.get("paymentStatus")!);
    expect(html).not.toMatch(/100,000/);
  });
});
