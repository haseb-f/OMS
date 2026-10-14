import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/** R22 D4 — the manual-entry voucher tabs appear only for `accounting.journal-entries.view`. */
const rights = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ hasPermission: (key: string) => rights.granted.has(key) }),
}));
vi.mock("@/providers/locale-provider", async () => {
  const { messages } = await import("@/i18n/messages");
  const { translate } = await import("@/i18n/translate");
  return {
    useLocale: () => ({
      t: (key: Parameters<typeof translate>[1]) => translate(messages.ar, key),
      locale: "ar",
      direction: "rtl",
    }),
  };
});
vi.mock("./manual-voucher-list", () => ({
  MANUAL_VOUCHER_VIEW_PERMISSION: "accounting.journal-entries.view",
}));

import { CustomerMoneyTabs, SupplierMoneyTabs } from "./voucher-list-tabs";

afterEach(() => {
  cleanup();
  rights.granted = new Set();
});

const tabs = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);

describe("voucher list tabs (R22 D4)", () => {
  it("receipts page: «تحصيلات أخرى» only with the journal-entry view right", () => {
    rights.granted = new Set(["sales.refunds.view"]);
    render(<CustomerMoneyTabs view="receipts" onChange={() => {}} />);
    expect(tabs()).toEqual(["سندات القبض", "المبالغ المردودة"]);
    cleanup();
    rights.granted = new Set(["sales.refunds.view", "accounting.journal-entries.view"]);
    render(<CustomerMoneyTabs view="receipts" onChange={() => {}} />);
    expect(tabs()).toContain("تحصيلات أخرى");
  });

  it("supplier payments page: «مدفوعات أخرى» and «تحويلات بين الحسابات» only with the view right", () => {
    render(<SupplierMoneyTabs view="payments" onChange={() => {}} />);
    expect(tabs()).toEqual([]);
    cleanup();
    rights.granted = new Set(["accounting.journal-entries.view"]);
    render(<SupplierMoneyTabs view="payments" onChange={() => {}} />);
    expect(tabs()).toEqual(["سندات صرف الموردين", "مدفوعات أخرى", "تحويلات بين الحسابات"]);
  });
});
