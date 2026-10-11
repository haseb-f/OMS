import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShippingAgreementDetail } from "./shipping-agreements-api";
import { TooltipProvider } from "@/components/ui/tooltip";

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

const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), createVersion: vi.fn() }));
vi.mock("./shipping-agreements-api", () => ({ shippingAgreementsApi: api }));

import {
  ShippingAgreementEditorDialog,
  type ShippingEditorTarget,
} from "./shipping-agreement-editor-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The visible text without the bidi isolates the preview wraps figures in. */
const plain = (text: string | null) => (text ?? "").replace(/[⁦-⁩]/g, "");
const previews = () =>
  screen.queryAllByTestId("charge-preview").map((node) => plain(node.textContent));

const active = {
  id: "v1",
  agreementNumber: "ASA-2026-0001",
  versionNumber: 1,
  status: "ACTIVE",
  effectiveFrom: "2020-01-01T00:00:00.000Z",
  effectiveTo: null,
  notes: null,
  codCollectionFee: 10,
  rates: [
    {
      id: "r1",
      service: "ANY",
      countryId: null,
      country: null,
      city: "",
      scope: "ALL",
      amount: 25,
      codFee: "ADDED",
    },
  ],
} as unknown as ShippingAgreementDetail;

const open = (target: ShippingEditorTarget, onChanged = vi.fn()) =>
  render(
    <TooltipProvider>
      <ShippingAgreementEditorDialog
        agentId="agent"
        currencyCode="SAR"
        target={target}
        defaultFrom="2026-10-11"
        onOpenChange={() => undefined}
        onChanged={onChanged}
      />
    </TooltipProvider>,
  );

const type = (label: RegExp, value: string, index = 0) =>
  fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } });

describe("ShippingAgreementEditorDialog (R17 compact form)", () => {
  it("default rate first + COD fee → live preview «prepaid 25 — COD 25 + 10 = 35», saved as one ANY row", async () => {
    api.create.mockResolvedValue({
      ...active,
      id: "draft",
      status: "DRAFT",
      agreementNumber: "ASA-2026-0007",
    });
    const onChanged = vi.fn();
    open({ kind: "new" }, onChanged);
    expect(previews()).toEqual([]);
    type(/agentShippingAgreements.editor.defaultRate/, "25");
    type(/agentShippingAgreements.editor.codFee/, "10");
    expect(previews()).toEqual([
      "agentShippingAgreements.preview.prepaid:25.00 SAR — agentShippingAgreements.preview.codAdded:25.00,10.00,35.00 SAR",
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "agentShippingAgreements.editor.createDraft" }),
    );
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("agent", {
        effectiveFrom: "2026-10-11",
        effectiveTo: null,
        notes: null,
        rates: [{ service: "ANY", amount: 25, codFee: "ADDED" }],
        codCollectionFee: 10,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(
      "agentShippingAgreements.toasts.created:ASA-2026-0007",
    );
  });

  it("the explicit 'amount includes the COD fee' choice: COD 35, never 35 + 10", () => {
    open({ kind: "new" });
    type(/agentShippingAgreements.editor.defaultRate/, "35");
    type(/agentShippingAgreements.editor.codFee/, "10");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "agentShippingAgreements.editor.includesCodFee" }),
    );
    expect(previews()).toEqual([
      "agentShippingAgreements.preview.prepaid:35.00 SAR — agentShippingAgreements.preview.codIncluded:35.00 SAR",
    ]);
  });

  it("a new agreement needs its default rate; a repeated service × destination is refused locally", async () => {
    open({ kind: "new" });
    fireEvent.click(
      screen.getByRole("button", { name: "agentShippingAgreements.editor.createDraft" }),
    );
    expect(
      await screen.findByText("agentShippingAgreements.editor.errors.defaultAmount"),
    ).toBeTruthy();
    type(/agentShippingAgreements.editor.defaultRate/, "25");
    // "Add rate" → a second ANY × all destinations row duplicates the default.
    fireEvent.click(screen.getByRole("button", { name: "agentShippingAgreements.editor.addRate" }));
    expect(screen.getAllByTestId("extra-rate")).toHaveLength(1);
    type(/agentShippingAgreements.editor.amount/, "30");
    fireEvent.click(
      screen.getByRole("button", { name: "agentShippingAgreements.editor.createDraft" }),
    );
    expect(await screen.findByText("agentShippingAgreements.editor.errors.duplicate")).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("Edit on the ACTIVE agreement: the save-instant notice, no period, saved as a new version (spec v2: 30 + 12 = 42)", async () => {
    api.createVersion.mockResolvedValue({ ...active, id: "v2", versionNumber: 2 });
    open({ kind: "version", agreement: active });
    expect(screen.getByText("agents.agreements.version.notice")).toBeTruthy();
    expect(screen.queryByText("agentShippingAgreements.editor.period")).toBeNull();
    const save = screen.getByRole("button", { name: "agentShippingAgreements.editor.saveVersion" });
    // Nothing changed yet → nothing to save.
    expect(save.hasAttribute("disabled")).toBe(true);
    type(/agentShippingAgreements.editor.defaultRate/, "30");
    type(/agentShippingAgreements.editor.codFee/, "12");
    expect(previews()[0]).toContain("30.00,12.00,42.00 SAR");
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.createVersion).toHaveBeenCalledWith("agent", "v1", {
        rates: [{ service: "ANY", amount: 30, codFee: "ADDED" }],
        codCollectionFee: 12,
        notes: null,
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "agentShippingAgreements.toasts.versioned:ASA-2026-0001,2",
    );
    expect(api.update).not.toHaveBeenCalled();
  });
});
