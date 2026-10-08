import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-reference-data", () => ({ useCountries: () => [] }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  toast: { success: toastSuccess, error: vi.fn(), warning: vi.fn() },
}));

const api = vi.hoisted(() => ({ create: vi.fn(), addRate: vi.fn() }));
vi.mock("./shipping-agreements-api", () => ({ shippingAgreementsApi: api }));

import { ShippingAgreementEditorDialog } from "./shipping-agreement-editor-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const created = {
  id: "draft",
  agreementNumber: "ASA-2026-0007",
  status: "DRAFT",
  effectiveFrom: "2026-10-08T00:00:00.000Z",
  effectiveTo: null,
  notes: null,
  rates: [],
  coverage: { complete: true, destinations: [], missing: [] },
};

describe("ShippingAgreementEditorDialog", () => {
  it("creates the draft from the proposed date (number generated), then offers its charges", async () => {
    api.create.mockResolvedValue(created);
    const onChanged = vi.fn();
    render(
      <ShippingAgreementEditorDialog
        agentId="agent"
        currencyCode="EGP"
        draft={null}
        defaultFrom="2026-10-08"
        onOpenChange={() => undefined}
        onChanged={onChanged}
      />,
    );
    // No charge entry before the draft exists.
    expect(screen.getByText("agentShippingAgreements.editor.afterCreate")).toBeTruthy();
    expect(screen.queryByText("agentShippingAgreements.editor.add")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "agentShippingAgreements.editor.createDraft" }),
    );
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("agent", {
        effectiveFrom: "2026-10-08",
        effectiveTo: null,
        notes: null,
      }),
    );
    expect(onChanged).toHaveBeenCalledWith(created);
    expect(toastSuccess).toHaveBeenCalledWith(
      "agentShippingAgreements.toasts.created:ASA-2026-0007",
    );

    // The charges section is now live; a charge without its service is refused locally.
    const add = await screen.findByRole("button", { name: "agentShippingAgreements.editor.add" });
    fireEvent.change(screen.getByLabelText(/agentShippingAgreements.editor.amount/), {
      target: { value: "60" },
    });
    fireEvent.click(add);
    expect(await screen.findByText("agentShippingAgreements.editor.errors.service")).toBeTruthy();
    expect(api.addRate).not.toHaveBeenCalled();
  });
});
