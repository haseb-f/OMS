import { apiClient } from "./api-client";
import type {
  PartnerAgreementFrequency,
  PartnerAgreementStatus,
  PartnerBalance,
  PartnerProfitBasis,
  PartnershipState,
  PeriodStatement,
  StatementPeriodRow,
} from "./company-partners-service";

/**
 * R15 (D15-14) — a company partner's own portal (`/partner-portal/*`). Every
 * call is scoped by the server to the signed-in partner login: there is no
 * partner id anywhere in these URLs.
 */

/** How the partner was paid — a method label, never the company account. */
export type PartnerPaymentMethod = "CASH" | "BANK" | "OTHER";

export interface PortalTerms {
  profitSharePercent: number;
  basis: PartnerProfitBasis;
  frequency: PartnerAgreementFrequency;
  status: PartnerAgreementStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PortalPayment {
  paymentNumber: string;
  date: string;
  amount: number;
  method: PartnerPaymentMethod;
  reference: string | null;
  reversed: boolean;
  reversedOn: string | null;
}

export interface PortalMe {
  partner: { name: string; partnerNumber: string };
  partnership: PartnershipState;
  /** In force today, else the latest one. */
  currentAgreement: PortalTerms | null;
  agreements: PortalTerms[];
  login: { email: string; fullName: string; lastLoginAt: string | null } | null;
}

export interface PortalSummary {
  currency: { id: string; code: string } | null;
  partnership: PartnershipState;
  range: { from: string; to: string };
  /** The latest period of the default range (the running one while the partnership lasts). */
  currentPeriod: StatementPeriodRow | null;
  estimated: number;
  position: PartnerBalance;
  lastPayment: {
    date: string;
    amount: number;
    method: PartnerPaymentMethod;
    reversed: boolean;
  } | null;
}

export interface PortalStatement extends PeriodStatement {
  partner: { name: string; partnerNumber: string };
  terms: PortalTerms[];
  payments: PortalPayment[];
}

export interface PortalPeriodDetail extends StatementPeriodRow {
  adjustmentHistory: Array<{
    adjustmentId: string;
    date: string;
    reason: string;
    amount: number;
  }>;
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const partnerPortalService = {
  me: () => apiClient.get<PortalMe>("/partner-portal/me"),
  summary: () => apiClient.get<PortalSummary>("/partner-portal/summary"),
  /** Every reviewed / closed period, newest first. */
  periods: () => apiClient.get<StatementPeriodRow[]>("/partner-portal/periods"),
  period: (periodId: string) =>
    apiClient.get<PortalPeriodDetail>(`/partner-portal/periods/${periodId}`),
  statement: (range: { from?: string; to?: string }) =>
    apiClient.get<PortalStatement>(`/partner-portal/statement${query(range)}`),
};
