import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";

/** R14 W5 — company partners and profit sharing ("الشركاء"). */

export type PartnerProfitBasis = "GROSS_PROFIT" | "NET_PROFIT";
export type PartnerAgreementFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";
export type PartnerAgreementStatus = "DRAFT" | "ACTIVE" | "ENDED";
export type PartnerProfitPeriodStatus = "PREVIEW" | "CLOSED";

export interface PartnerBalance {
  approved: number;
  paid: number;
  payable: number;
  advance: number;
}

export interface PartnerAgreementRow {
  id: string;
  partnerId: string;
  partnerName?: string;
  profitSharePercent: number;
  basis: PartnerProfitBasis;
  effectiveFrom: string;
  effectiveTo: string | null;
  frequency: PartnerAgreementFrequency;
  status: PartnerAgreementStatus;
  supersedesId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CompanyPartnerRow extends PartnerBalance {
  id: string;
  partnerId: string;
  name: string;
  partnerNumber: string;
  phone: string | null;
  email: string | null;
  ownershipPercent: number | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  currentAgreement: PartnerAgreementRow | null;
}

export interface CompanyPartnerDetail extends CompanyPartnerRow {
  agreements: PartnerAgreementRow[];
}

export interface PartnerCandidate {
  id: string;
  name: string;
  partnerNumber: string;
  phone: string | null;
  mobile: string | null;
}

export interface ProfitFigures {
  netRevenue: number;
  costOfSales: number;
  grossProfit: number;
  otherExpensesNet: number;
  netProfit: number;
}

export interface PartnerSegment {
  agreementId: string;
  partnerId: string;
  basis: PartnerProfitBasis;
  percent: number;
  from: string;
  to: string;
  days: number;
  figures: ProfitFigures;
  baseAmount: number;
  lossClamped: boolean;
  amount: number;
}

export interface PartnerProfitCalculation {
  from: string;
  to: string;
  computedAt: string;
  frequency: PartnerAgreementFrequency | null;
  currency: { id: string; code: string } | null;
  figures: ProfitFigures;
  partners: Array<{
    partnerId: string;
    partnerName: string;
    amount: number;
    segments: PartnerSegment[];
  }>;
  totalEntitlement: number;
  warnings: string[];
}

export interface PartnerProfitPeriodRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  frequency: PartnerAgreementFrequency;
  status: PartnerProfitPeriodStatus;
  originalTotal: number;
  adjustmentTotal: number;
  total: number;
  adjustmentCount: number;
  reviewedAt: string | null;
  closedAt: string | null;
  journalEntryId: string | null;
}

export interface PartnerEntitlementRow {
  id: string;
  partnerId: string;
  partnerName: string;
  agreementId: string;
  adjustmentId: string | null;
  kind: "ORIGINAL" | "ADJUSTMENT";
  basis: PartnerProfitBasis;
  segmentFrom: string;
  segmentTo: string;
  baseAmount: number;
  percent: number;
  days: number;
  amount: number;
  journalEntryId: string | null;
}

export interface PartnerProfitPeriodDetail extends PartnerProfitPeriodRow {
  snapshot: PartnerProfitCalculation;
  entitlements: PartnerEntitlementRow[];
  adjustments: Array<{
    id: string;
    reason: string;
    entryDate: string;
    journalEntryId: string | null;
    createdAt: string;
  }>;
}

export interface PartnerPaymentRow {
  id: string;
  paymentNumber: string;
  partnerId: string;
  partnerName: string;
  amount: number;
  date: string;
  financialAccount: { id: string; code: string; name: string };
  reference: string | null;
  notes: string | null;
  journalEntryId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export interface PartnerStatement {
  partner: {
    partnerId: string;
    name: string;
    partnerNumber: string;
    ownershipPercent: number | null;
    status: "ACTIVE" | "INACTIVE";
  };
  range: { from: string; to: string };
  currency: { id: string; code: string } | null;
  agreements: PartnerAgreementRow[];
  estimate: {
    figures: ProfitFigures;
    segments: PartnerSegment[];
    amount: number;
    computedAt: string;
    warnings: string[];
  };
  approved: {
    periods: Array<{
      periodId: string;
      periodFrom: string;
      periodTo: string;
      original: number;
      adjustments: number;
      total: number;
      journalEntryId: string | null;
      adjustmentIds: string[];
    }>;
    total: number;
  };
  payments: PartnerPaymentRow[];
  paidInRange: number;
  balance: PartnerBalance;
  currentAgreements: PartnerAgreementRow[];
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const companyPartnersService = {
  list: () => apiClient.get<CompanyPartnerRow[]>("/company-partners/profiles"),
  get: (partnerId: string) =>
    apiClient.get<CompanyPartnerDetail>(`/company-partners/profiles/${partnerId}`),
  candidates: (search?: string) =>
    apiClient.get<PartnerCandidate[]>(`/company-partners/profiles/candidates${query({ search })}`),
  create: (dto: {
    partnerId?: string;
    name?: string;
    phone?: string;
    email?: string;
    ownershipPercent?: number;
    notes?: string;
  }) => apiClient.post<CompanyPartnerDetail>("/company-partners/profiles", compactPayload(dto)),
  update: (
    partnerId: string,
    dto: {
      ownershipPercent?: number | null;
      notes?: string | null;
      status?: "ACTIVE" | "INACTIVE";
    },
  ) => apiClient.patch<CompanyPartnerDetail>(`/company-partners/profiles/${partnerId}`, dto),
  statement: (partnerId: string, range: { from?: string; to?: string }) =>
    apiClient.get<PartnerStatement>(
      `/company-partners/profiles/${partnerId}/statement${query(range)}`,
    ),

  agreements: (partnerId?: string) =>
    apiClient.get<PartnerAgreementRow[]>(`/company-partners/agreements${query({ partnerId })}`),
  createAgreement: (dto: {
    partnerId: string;
    profitSharePercent: number;
    basis: PartnerProfitBasis;
    effectiveFrom: string;
    effectiveTo?: string;
    frequency: PartnerAgreementFrequency;
    notes?: string;
  }) => apiClient.post<PartnerAgreementRow>("/company-partners/agreements", compactPayload(dto)),
  endAgreement: (id: string, effectiveTo: string) =>
    apiClient.post<PartnerAgreementRow>(`/company-partners/agreements/${id}/end`, {
      effectiveTo,
    }),
  supersedeAgreement: (
    id: string,
    dto: {
      effectiveFrom: string;
      profitSharePercent: number;
      basis?: PartnerProfitBasis;
      notes?: string;
    },
  ) =>
    apiClient.post<PartnerAgreementRow>(
      `/company-partners/agreements/${id}/supersede`,
      compactPayload(dto),
    ),

  preview: (from: string, to: string) =>
    apiClient.get<PartnerProfitCalculation>(
      `/company-partners/periods/preview${query({ from, to })}`,
    ),
  periods: () => apiClient.get<PartnerProfitPeriodRow[]>("/company-partners/periods"),
  period: (id: string) =>
    apiClient.get<PartnerProfitPeriodDetail>(`/company-partners/periods/${id}`),
  saveReview: (periodFrom: string, periodTo: string) =>
    apiClient.post<PartnerProfitPeriodDetail>("/company-partners/periods", {
      periodFrom,
      periodTo,
    }),
  closePeriod: (id: string) =>
    apiClient.post<PartnerProfitPeriodDetail>(`/company-partners/periods/${id}/close`),
  adjustPeriod: (id: string, reason: string) =>
    apiClient.post<PartnerProfitPeriodDetail>(`/company-partners/periods/${id}/adjustments`, {
      reason,
    }),

  payments: (partnerId?: string) =>
    apiClient.get<PartnerPaymentRow[]>(`/company-partners/payments${query({ partnerId })}`),
  createPayment: (dto: {
    partnerId: string;
    amount: number;
    date: string;
    financialAccountId: string;
    reference?: string;
    notes?: string;
  }) =>
    apiClient.post<PartnerPaymentRow & { balance: PartnerBalance }>(
      "/company-partners/payments",
      compactPayload(dto),
    ),
  reversePayment: (id: string, reason: string) =>
    apiClient.post<PartnerPaymentRow & { balance: PartnerBalance }>(
      `/company-partners/payments/${id}/reverse`,
      { reason },
    ),
};
