import { formatAmount } from "@/lib/money";
import type {
  AgentAgreement,
  AgentChargeOwner,
  AgentEarningEvent,
  AgentReturnTreatment,
  AgentShippingPolicy,
  AgreementInput,
} from "@/services/agents-service";

/**
 * Agreement editor state (spec §2, decision D3). Every term starts blank and
 * must be chosen/entered explicitly — the form never pre-selects a rate,
 * earning event, owner or fee.
 */
export interface AgreementFormState {
  effectiveFrom: string;
  effectiveTo: string;
  /** commission-policy.md A3 — default rate for physical products. */
  productCommissionRatePercent: string;
  /** Default rate for services / courses. */
  serviceCommissionRatePercent: string;
  shippingPolicy: AgentShippingPolicy | "";
  commissionEarningEvent: AgentEarningEvent | "";
  returnCommissionTreatment: AgentReturnTreatment | "";
  customerShippingChargeOwner: AgentChargeOwner | "";
  providerFeesBorneBy: AgentChargeOwner | "";
  shippingFeePerShipment: string;
  returnFeePerShipment: string;
  serviceFeePerOrder: string;
  allowAgentDestinations: "yes" | "no" | "";
  payoutHoldDays: string;
  notes: string;
}

export type AgreementFormField = keyof AgreementFormState;
export type AgreementFieldError =
  | "required"
  | "range"
  | "invalid"
  | "decimals"
  /** Would recover the same shipping twice under actual-cost reimbursement (A3). */
  | "doubleShipping"
  /** A flat shipping fee the chosen policy would never charge. */
  | "notCharged";

export function emptyAgreementForm(): AgreementFormState {
  return {
    effectiveFrom: "",
    effectiveTo: "",
    productCommissionRatePercent: "",
    serviceCommissionRatePercent: "",
    shippingPolicy: "",
    commissionEarningEvent: "",
    returnCommissionTreatment: "",
    customerShippingChargeOwner: "",
    providerFeesBorneBy: "",
    shippingFeePerShipment: "",
    returnFeePerShipment: "",
    serviceFeePerOrder: "",
    allowAgentDestinations: "",
    payoutHoldDays: "",
    notes: "",
  };
}

const dateOnly = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");
const plain = (value: string | number) => String(Number(value));

export function agreementFormFrom(agreement: AgentAgreement): AgreementFormState {
  return {
    effectiveFrom: dateOnly(agreement.effectiveFrom),
    effectiveTo: dateOnly(agreement.effectiveTo),
    productCommissionRatePercent: plain(agreement.productCommissionRatePercent),
    serviceCommissionRatePercent: plain(agreement.serviceCommissionRatePercent),
    shippingPolicy: agreement.shippingPolicy,
    commissionEarningEvent: agreement.commissionEarningEvent,
    returnCommissionTreatment: agreement.returnCommissionTreatment,
    customerShippingChargeOwner: agreement.customerShippingChargeOwner,
    providerFeesBorneBy: agreement.providerFeesBorneBy,
    shippingFeePerShipment: plain(agreement.shippingFeePerShipment),
    returnFeePerShipment: plain(agreement.returnFeePerShipment),
    serviceFeePerOrder: plain(agreement.serviceFeePerOrder),
    allowAgentDestinations: agreement.allowAgentDestinations ? "yes" : "no",
    payoutHoldDays: String(agreement.payoutHoldDays),
    notes: agreement.notes ?? "",
  };
}

function decimalsOf(raw: string): number {
  const [, fraction = ""] = raw.trim().split(".");
  return fraction.length;
}

function amount(
  raw: string,
  maxDecimals: number,
  bounds: { min: number; max?: number },
): number | AgreementFieldError {
  if (raw.trim() === "") return "required";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "invalid";
  if (decimalsOf(raw) > maxDecimals) return "decimals";
  if (value < bounds.min || (bounds.max !== undefined && value > bounds.max)) return "range";
  return value;
}

/**
 * Validates the editor and, when complete, returns the API payload. Rules
 * mirror the API DTO: rate 0–100 (4 dp), fees ≥ 0 (2 dp), hold days an
 * integer 0–3650, end date not before start date.
 */
export function validateAgreementForm(form: AgreementFormState): {
  errors: Partial<Record<AgreementFormField, AgreementFieldError>>;
  payload: AgreementInput | null;
} {
  const errors: Partial<Record<AgreementFormField, AgreementFieldError>> = {};
  if (!form.effectiveFrom) errors.effectiveFrom = "required";
  if (form.effectiveTo && form.effectiveFrom && form.effectiveTo < form.effectiveFrom) {
    errors.effectiveTo = "range";
  }
  const productRate = amount(form.productCommissionRatePercent, 4, { min: 0, max: 100 });
  if (typeof productRate !== "number") errors.productCommissionRatePercent = productRate;
  const serviceRate = amount(form.serviceCommissionRatePercent, 4, { min: 0, max: 100 });
  if (typeof serviceRate !== "number") errors.serviceCommissionRatePercent = serviceRate;
  if (!form.shippingPolicy) errors.shippingPolicy = "required";
  const shipping = amount(form.shippingFeePerShipment, 2, { min: 0 });
  if (typeof shipping !== "number") errors.shippingFeePerShipment = shipping;
  const returnFee = amount(form.returnFeePerShipment, 2, { min: 0 });
  if (typeof returnFee !== "number") errors.returnFeePerShipment = returnFee;
  const service = amount(form.serviceFeePerOrder, 2, { min: 0 });
  if (typeof service !== "number") errors.serviceFeePerOrder = service;
  const hold = amount(form.payoutHoldDays, 0, { min: 0, max: 3650 });
  if (typeof hold !== "number") errors.payoutHoldDays = hold;
  if (!form.commissionEarningEvent) errors.commissionEarningEvent = "required";
  if (!form.returnCommissionTreatment) errors.returnCommissionTreatment = "required";
  if (!form.customerShippingChargeOwner) errors.customerShippingChargeOwner = "required";
  if (!form.providerFeesBorneBy) errors.providerFeesBorneBy = "required";
  if (!form.allowAgentDestinations) errors.allowAgentDestinations = "required";
  if (form.shippingPolicy === "NONE" && typeof shipping === "number" && shipping !== 0) {
    errors.shippingFeePerShipment = "notCharged";
  }
  if (form.shippingPolicy === "PREDETERMINED_CHARGE") {
    for (const field of predeterminedConflicts(form, shipping)) {
      errors[field] ??= "doubleShipping";
    }
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null };
  return {
    errors,
    payload: {
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || undefined,
      productCommissionRatePercent: productRate as number,
      serviceCommissionRatePercent: serviceRate as number,
      shippingPolicy: form.shippingPolicy as AgentShippingPolicy,
      commissionEarningEvent: form.commissionEarningEvent as AgentEarningEvent,
      returnCommissionTreatment: form.returnCommissionTreatment as AgentReturnTreatment,
      customerShippingChargeOwner: form.customerShippingChargeOwner as AgentChargeOwner,
      providerFeesBorneBy: form.providerFeesBorneBy as AgentChargeOwner,
      shippingFeePerShipment: shipping as number,
      returnFeePerShipment: returnFee as number,
      serviceFeePerOrder: service as number,
      allowAgentDestinations: form.allowAgentDestinations === "yes",
      payoutHoldDays: hold as number,
      notes: form.notes.trim() || undefined,
    },
  };
}

/**
 * Predetermined shipping (commission-policy.md A3/A6): the customer shipping
 * belongs to the company and settles the agent shipping charge, so the owner
 * is the company and there is no second per-shipment fee.
 */
export function predeterminedConflicts(
  form: Pick<AgreementFormState, "customerShippingChargeOwner">,
  shipping: number | AgreementFieldError,
): AgreementFormField[] {
  const conflicts: AgreementFormField[] = [];
  if (form.customerShippingChargeOwner && form.customerShippingChargeOwner !== "COMPANY") {
    conflicts.push("customerShippingChargeOwner");
  }
  if (typeof shipping === "number" && shipping !== 0) {
    conflicts.push("shippingFeePerShipment");
  }
  return conflicts;
}

/**
 * Choosing a shipping policy fills the terms it requires (visible and
 * editable — the owner still sees every value before saving).
 */
export function withShippingPolicy(
  form: AgreementFormState,
  policy: AgreementFormState["shippingPolicy"],
): AgreementFormState {
  if (policy === "NONE") {
    return { ...form, shippingPolicy: policy, shippingFeePerShipment: "0" };
  }
  if (policy === "PREDETERMINED_CHARGE") {
    return {
      ...form,
      shippingPolicy: policy,
      customerShippingChargeOwner: "COMPANY",
      shippingFeePerShipment: "0",
    };
  }
  return { ...form, shippingPolicy: policy };
}

/** "35% / 25%" — product / service default rates (A3), for compact displays. */
export function formatClassRates(agreement: {
  productCommissionRatePercent: string | number;
  serviceCommissionRatePercent: string | number;
}): string {
  const pct = (value: string | number) => `${formatAmount(Number(value))}%`;
  return `${pct(agreement.productCommissionRatePercent)} / ${pct(agreement.serviceCommissionRatePercent)}`;
}
