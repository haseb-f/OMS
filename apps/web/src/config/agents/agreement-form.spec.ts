import { describe, expect, it } from "vitest";
import {
  agreementFormFrom,
  emptyAgreementForm,
  validateAgreementForm,
  type AgreementFormState,
} from "./agreement-form";
import type { AgentAgreement } from "@/services/agents-service";

const complete: AgreementFormState = {
  effectiveFrom: "2026-10-01",
  effectiveTo: "",
  commissionRatePercent: "12.5",
  commissionEarningEvent: "DELIVERED",
  returnCommissionTreatment: "REVERSE",
  customerShippingChargeOwner: "COMPANY",
  providerFeesBorneBy: "AGENT",
  shippingFeePerShipment: "0",
  returnFeePerShipment: "15",
  serviceFeePerOrder: "2.5",
  allowAgentDestinations: "no",
  payoutHoldDays: "7",
  notes: "",
};

describe("agreement form", () => {
  it("starts with every term blank — no silent defaults", () => {
    const { errors, payload } = validateAgreementForm(emptyAgreementForm());
    expect(payload).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(
      [
        "allowAgentDestinations",
        "commissionEarningEvent",
        "commissionRatePercent",
        "customerShippingChargeOwner",
        "effectiveFrom",
        "payoutHoldDays",
        "providerFeesBorneBy",
        "returnCommissionTreatment",
        "returnFeePerShipment",
        "serviceFeePerOrder",
        "shippingFeePerShipment",
      ].sort(),
    );
  });

  it("builds the explicit API payload (zero fees are valid when entered)", () => {
    const { errors, payload } = validateAgreementForm(complete);
    expect(errors).toEqual({});
    expect(payload).toEqual({
      effectiveFrom: "2026-10-01",
      effectiveTo: undefined,
      commissionRatePercent: 12.5,
      commissionEarningEvent: "DELIVERED",
      returnCommissionTreatment: "REVERSE",
      customerShippingChargeOwner: "COMPANY",
      providerFeesBorneBy: "AGENT",
      shippingFeePerShipment: 0,
      returnFeePerShipment: 15,
      serviceFeePerOrder: 2.5,
      allowAgentDestinations: false,
      payoutHoldDays: 7,
      notes: undefined,
    });
  });

  it("enforces the DTO ranges and precision", () => {
    const { errors } = validateAgreementForm({
      ...complete,
      effectiveTo: "2026-09-01",
      commissionRatePercent: "100.5",
      shippingFeePerShipment: "1.234",
      payoutHoldDays: "1.5",
      serviceFeePerOrder: "-1",
    });
    expect(errors).toEqual({
      effectiveTo: "range",
      commissionRatePercent: "range",
      shippingFeePerShipment: "decimals",
      payoutHoldDays: "decimals",
      serviceFeePerOrder: "range",
    });
    expect(validateAgreementForm({ ...complete, commissionRatePercent: "5.12345" }).errors).toEqual(
      { commissionRatePercent: "decimals" },
    );
  });

  it("round-trips a stored agreement into the editor", () => {
    const agreement = {
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      effectiveTo: null,
      commissionRatePercent: "12.5000",
      commissionEarningEvent: "PAYMENT_VERIFIED",
      returnCommissionTreatment: "RETAIN",
      customerShippingChargeOwner: "AGENT",
      providerFeesBorneBy: "COMPANY",
      shippingFeePerShipment: "0.00",
      returnFeePerShipment: "15.00",
      serviceFeePerOrder: "2.50",
      allowAgentDestinations: true,
      payoutHoldDays: 0,
      notes: null,
    } as unknown as AgentAgreement;
    const form = agreementFormFrom(agreement);
    expect(form.effectiveFrom).toBe("2026-10-01");
    expect(form.commissionRatePercent).toBe("12.5");
    expect(form.allowAgentDestinations).toBe("yes");
    expect(validateAgreementForm(form).payload?.payoutHoldDays).toBe(0);
  });
});
