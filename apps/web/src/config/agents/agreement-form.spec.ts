import { describe, expect, it } from "vitest";
import {
  agreementFormFrom,
  emptyAgreementForm,
  formatClassRates,
  validateAgreementForm,
  withShippingPolicy,
  type AgreementFormState,
} from "./agreement-form";
import type { AgentAgreement } from "@/services/agents-service";

const complete: AgreementFormState = {
  effectiveFrom: "2026-10-01",
  effectiveTo: "",
  productCommissionRatePercent: "35",
  serviceCommissionRatePercent: "25",
  shippingPolicy: "FLAT_FEE_PER_SHIPMENT",
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
        "productCommissionRatePercent",
        "serviceCommissionRatePercent",
        "shippingPolicy",
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
      productCommissionRatePercent: 35,
      serviceCommissionRatePercent: 25,
      shippingPolicy: "FLAT_FEE_PER_SHIPMENT",
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

  it("allows an explicit 0% class rate", () => {
    const { errors, payload } = validateAgreementForm({
      ...complete,
      serviceCommissionRatePercent: "0",
    });
    expect(errors).toEqual({});
    expect(payload?.serviceCommissionRatePercent).toBe(0);
  });

  it("enforces the DTO ranges and precision", () => {
    const { errors } = validateAgreementForm({
      ...complete,
      effectiveTo: "2026-09-01",
      productCommissionRatePercent: "100.5",
      shippingFeePerShipment: "1.234",
      payoutHoldDays: "1.5",
      serviceFeePerOrder: "-1",
    });
    expect(errors).toEqual({
      effectiveTo: "range",
      productCommissionRatePercent: "range",
      shippingFeePerShipment: "decimals",
      payoutHoldDays: "decimals",
      serviceFeePerOrder: "range",
    });
    expect(
      validateAgreementForm({ ...complete, serviceCommissionRatePercent: "5.12345" }).errors,
    ).toEqual({ serviceCommissionRatePercent: "decimals" });
  });

  it("predetermined shipping: customer shipping belongs to the company, no second fee (A3)", () => {
    const { errors, payload } = validateAgreementForm({
      ...complete,
      shippingPolicy: "PREDETERMINED_CHARGE",
      customerShippingChargeOwner: "AGENT",
      shippingFeePerShipment: "10",
    });
    expect(payload).toBeNull();
    expect(errors).toEqual({
      customerShippingChargeOwner: "doubleShipping",
      shippingFeePerShipment: "doubleShipping",
    });
    const filled = withShippingPolicy(
      { ...complete, customerShippingChargeOwner: "AGENT", shippingFeePerShipment: "10" },
      "PREDETERMINED_CHARGE",
    );
    expect(filled).toMatchObject({
      customerShippingChargeOwner: "COMPANY",
      shippingFeePerShipment: "0",
    });
    expect(validateAgreementForm(filled).errors).toEqual({});
  });

  it("a company-borne shipping policy never keeps a flat fee it would not charge", () => {
    expect(
      validateAgreementForm({
        ...complete,
        shippingPolicy: "NONE",
        shippingFeePerShipment: "15",
      }).errors,
    ).toEqual({ shippingFeePerShipment: "notCharged" });
    expect(
      withShippingPolicy({ ...complete, shippingFeePerShipment: "15" }, "NONE")
        .shippingFeePerShipment,
    ).toBe("0");
  });

  it("round-trips a stored agreement into the editor", () => {
    const agreement = {
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      effectiveTo: null,
      productCommissionRatePercent: "35.0000",
      serviceCommissionRatePercent: "12.5000",
      shippingPolicy: "NONE",
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
    expect(form.productCommissionRatePercent).toBe("35");
    expect(form.serviceCommissionRatePercent).toBe("12.5");
    expect(form.shippingPolicy).toBe("NONE");
    expect(form.allowAgentDestinations).toBe("yes");
    expect(validateAgreementForm(form).payload?.payoutHoldDays).toBe(0);
    expect(formatClassRates(agreement)).toBe("35.00% / 12.50%");
  });
});
