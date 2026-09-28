import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { resolvePrintCompany } from "./print-brand";
import { getColumnDisplayValue } from "@/components/shared/data-table/data-table-column-value";
import {
  storeOrderPaymentText,
  storeOrderShippingText,
} from "@/components/store-orders/store-order-row-cells";
import { buildStoreOrderColumns } from "@/config/store-orders/order-columns";
import { isShortTextColumn } from "@/components/accounting/financial-report/financial-report-export";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { StoreOrderRow } from "@/services/store-orders-service";

const ar = (key: MessageKey) => translate(messages.ar, key);

describe("resolvePrintCompany", () => {
  const none = { name: "", logoUrl: null };
  it("uses the active company", () => {
    expect(
      resolvePrintCompany({
        activeCompany: { name: "Softland", logoUrl: "/logo.png" },
        configured: { name: "Configured", logoUrl: null },
        placeholderName: "not set",
      }),
    ).toEqual({ name: "Softland", logoUrl: "/logo.png" });
  });
  it("falls back to the user's first named company", () => {
    expect(
      resolvePrintCompany({
        activeCompany: null,
        companies: [
          { name: "", logoUrl: null },
          { name: "Branch Co", logoUrl: null },
        ],
        configured: none,
        placeholderName: "not set",
      }),
    ).toEqual({ name: "Branch Co", logoUrl: null });
  });
  it("then the configured deployment profile", () => {
    expect(
      resolvePrintCompany({
        activeCompany: null,
        companies: [],
        configured: { name: "Configured Co", logoUrl: "/c.png" },
        placeholderName: "not set",
      }),
    ).toEqual({ name: "Configured Co", logoUrl: "/c.png" });
  });
  it("else a clearly-marked placeholder — never the product name", () => {
    const result = resolvePrintCompany({
      activeCompany: null,
      companies: [],
      configured: none,
      placeholderName: ar("printDocument.companyNotSet"),
    });
    expect(result).toEqual({ name: "لم يُحدَّد ملف الشركة", logoUrl: null, placeholder: true });
    expect(result.name).not.toContain("OMS");
  });
});

const order = {
  id: "o1",
  internalOrderId: "STO-2026-000129",
  paymentStatus: "FULLY_PAID_RECONCILED",
  paymentType: "PREPAID",
  declaredPaymentStatus: "PAID",
  declaredAmount: "150",
  total: "150",
  currency: { code: "EGP" },
  shippingStage: "READY_FOR_SHIPPING",
  shippingStatus: { id: "s1", code: "DELIVERED", name: "تم التسليم", color: "green" },
  shipments: [{ trackingNumber: "BST-1" }],
} as unknown as StoreOrderRow;

describe("store-order print values", () => {
  it("payment: the translated Finance label, total and declaration — never the raw code", () => {
    const text = storeOrderPaymentText(order, ar);
    expect(text).not.toMatch(/FULLY_PAID_RECONCILED|PAID\b/);
    expect(text).toContain(ar("storeOrders.paymentStatus.FULLY_PAID_RECONCILED"));
    expect(text).toContain("150.00");
  });
  it("shipping: the catalog status the screen shows (not the stage code) and tracking", () => {
    expect(storeOrderShippingText(order, ar)).toBe("تم التسليم · BST-1");
    const noCatalog = { ...order, shippingStatus: null, shipments: [] } as unknown as StoreOrderRow;
    expect(storeOrderShippingText(noCatalog, ar)).toBe(
      ar("storeOrders.shippingStage.READY_FOR_SHIPPING" as MessageKey),
    );
  });
  it("the store-order columns print through displayValue", () => {
    const columns = buildStoreOrderColumns({ onView: () => {} });
    const byId = (id: string) => columns.find((column) => column.id === id)!;
    expect(getColumnDisplayValue(byId("shippingStage"), order, ar)).toBe("تم التسليم · BST-1");
    expect(getColumnDisplayValue(byId("paymentStatus"), order, ar)).not.toContain(
      "FULLY_PAID_RECONCILED",
    );
  });
});

describe("getColumnDisplayValue", () => {
  const column = {
    id: "status",
    accessorFn: (row: { status: string }) => row.status,
    meta: {
      displayValue: (row: { status: string }, t: (k: MessageKey) => string) =>
        t(`label.${row.status}` as MessageKey),
    },
  } as unknown as ColumnDef<{ status: string }, unknown>;
  it("prefers displayValue when it can translate", () => {
    expect(getColumnDisplayValue(column, { status: "OPEN" }, (key) => `T(${key})`)).toBe(
      "T(label.OPEN)",
    );
  });
  it("falls back to the accessor without a translator", () => {
    expect(getColumnDisplayValue(column, { status: "OPEN" })).toBe("OPEN");
  });
});

describe("isShortTextColumn (report print nowrap)", () => {
  it("keeps short codes on one line and lets prose wrap", () => {
    const rows = [
      {
        date: "12 Sep 2026",
        entry: "JE-2026-000123",
        name: "A long account description that wraps",
      },
      { date: "", entry: "JE-2026-000124", name: "x" },
    ];
    expect(isShortTextColumn(rows, "date")).toBe(true);
    expect(isShortTextColumn(rows, "entry")).toBe(true);
    expect(isShortTextColumn(rows, "name")).toBe(false);
    expect(isShortTextColumn([{ empty: "" }], "empty")).toBe(false);
  });
});
