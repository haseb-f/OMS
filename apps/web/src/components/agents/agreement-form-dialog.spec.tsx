import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentAgreement } from "@/services/agents-service";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  toast: { success: toastSuccess, error: vi.fn(), warning: vi.fn() },
}));
const agreementsApi = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  createVersion: vi.fn(),
}));
vi.mock("@/services/agents-service", () => ({
  agentsService: { agreements: agreementsApi },
}));

import { AgreementFormDialog } from "./agreement-form-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const active = {
  id: "agr-1",
  agentId: "agent",
  agreementNumber: "AGR-2026-0001",
  status: "ACTIVE",
  versionNumber: 1,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
  productCommissionRatePercent: "35",
  serviceCommissionRatePercent: "25",
  shippingPolicy: "PREDETERMINED_CHARGE",
  commissionEarningEvent: "DELIVERED",
  returnCommissionTreatment: "REVERSE",
  customerShippingChargeOwner: "COMPANY",
  providerFeesBorneBy: "AGENT",
  shippingFeePerShipment: "0",
  returnFeePerShipment: "0",
  serviceFeePerOrder: "0",
  allowAgentDestinations: false,
  payoutHoldDays: 0,
  notes: null,
} as unknown as AgentAgreement;

describe("AgreementFormDialog — R17 §2 Edit on the ACTIVE agreement", () => {
  it("shows the save-instant notice, hides the period and saves the changed terms as a new version", async () => {
    agreementsApi.createVersion.mockResolvedValue({
      ...active,
      id: "agr-2",
      agreementNumber: "AGR-2026-0002",
      versionNumber: 2,
    });
    const onSaved = vi.fn();
    render(
      <AgreementFormDialog
        agentId="agent"
        currencyCode="SAR"
        agreement={active}
        onOpenChange={() => undefined}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText("agents.agreements.version.notice")).toBeTruthy();
    expect(screen.queryByText("agents.agreements.sections.period")).toBeNull();
    const save = screen.getByRole("button", { name: "agents.agreements.version.save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText(/agents.agreements.fields.productRate/), {
      target: { value: "30" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(agreementsApi.createVersion).toHaveBeenCalledTimes(1));
    const [agentId, agreementId, dto] = agreementsApi.createVersion.mock.calls[0];
    expect([agentId, agreementId]).toEqual(["agent", "agr-1"]);
    expect(dto).toMatchObject({
      productCommissionRatePercent: 30,
      serviceCommissionRatePercent: 25,
    });
    // Dates and currency follow the current version — never sent.
    expect(dto).not.toHaveProperty("effectiveFrom");
    expect(dto).not.toHaveProperty("effectiveTo");
    expect(agreementsApi.update).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("agents.agreements.toasts.versioned:AGR-2026-0002,2");
    expect(onSaved).toHaveBeenCalled();
  });
});
