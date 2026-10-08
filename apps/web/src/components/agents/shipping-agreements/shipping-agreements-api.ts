import { apiClient } from "@/services/api-client";
import type { AgentShippingService } from "@/services/agents-service";

/**
 * Agent shipping agreement API (R15 D15-13) — `agents/:agentId/shipping-agreements`,
 * internal only: reads with `agents.view`, every write with
 * `agents.agreements.manage`. Dates are Cairo calendar days ("YYYY-MM-DD").
 */

export type ShippingAgreementStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
/** How specific a destination is: a city, a whole country, or all destinations. */
export type ShippingDestinationScope = "CITY" | "COUNTRY" | "ALL";

export interface ShippingCountryRef {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
}

export interface ShippingAgreementUserRef {
  id: string;
  fullName: string;
}

export interface ShippingAgreementRef {
  id: string;
  agreementNumber: string;
}

interface ShippingAgreementHead {
  id: string;
  agreementNumber: string;
  agentId: string;
  currencyId: string;
  status: ShippingAgreementStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  createdAt: string;
  supersedes: ShippingAgreementRef | null;
}

export interface ShippingAgreementListItem extends ShippingAgreementHead {
  currency: { id: string; code: string; symbol: string | null };
  supersededBy: ShippingAgreementRef | null;
  rateCount: number;
}

export interface ShippingAgreementList {
  /** The ACTIVE agreement in force today, if any. */
  inForceId: string | null;
  /** Newest first; discarded drafts are not listed. */
  items: ShippingAgreementListItem[];
}

export interface ShippingAgreementRate {
  id: string;
  service: AgentShippingService;
  countryId: string | null;
  country: ShippingCountryRef | null;
  /** '' = the whole country (or all destinations). */
  city: string;
  scope: ShippingDestinationScope;
  amount: number;
}

/** What an order to a destination is charged per service (null = missing). */
export interface ShippingCoverageCell {
  rateId: string;
  amount: number;
  /** Charged by a broader row (country / all destinations), not its own. */
  inherited: boolean;
}

export interface ShippingCoverageDestination {
  key: string;
  countryId: string | null;
  country: ShippingCountryRef | null;
  city: string;
  scope: ShippingDestinationScope;
  cells: Record<AgentShippingService, ShippingCoverageCell | null>;
}

export interface ShippingAgreementOverlap {
  id: string;
  agreementNumber: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** What Activate would do now — drafts only. */
export interface ShippingAgreementActivation {
  ready: boolean;
  problems: Array<"SHIPPING_AGREEMENT_NO_RATES" | "SHIPPING_AGREEMENT_OVERLAP">;
  overlapping: ShippingAgreementOverlap[];
  /** Activating with "replace from" closes the overlapping agreement on this day. */
  replaceCloses: string | null;
}

export interface ShippingAgreementActivity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  user: ShippingAgreementUserRef | null;
}

export interface ShippingAgreementDetail extends ShippingAgreementHead {
  currency: { id: string; code: string; name: string; symbol: string | null };
  supersededBy: (ShippingAgreementRef & { effectiveFrom: string }) | null;
  inForceToday: boolean;
  createdByUser: ShippingAgreementUserRef | null;
  activatedByUser: ShippingAgreementUserRef | null;
  deactivatedByUser: ShippingAgreementUserRef | null;
  rates: ShippingAgreementRate[];
  coverage: {
    complete: boolean;
    destinations: ShippingCoverageDestination[];
    missing: Array<{
      destinationKey: string;
      countryId: string | null;
      country: ShippingCountryRef | null;
      city: string;
      service: AgentShippingService;
    }>;
  };
  activation: ShippingAgreementActivation | null;
  activity: ShippingAgreementActivity[];
}

export interface ShippingAgreementRateInput {
  service: AgentShippingService;
  /** Omitted = all destinations. */
  countryId?: string;
  /** Omitted = the whole country. */
  city?: string;
  amount: number;
}

export interface ShippingAgreementPeriodInput {
  effectiveFrom: string;
  /** null clears the end date (open-ended). */
  effectiveTo: string | null;
  notes: string | null;
}

const base = (agentId: string) => `/agents/${agentId}/shipping-agreements`;

export const shippingAgreementsApi = {
  list: (agentId: string) => apiClient.get<ShippingAgreementList>(base(agentId)),
  get: (agentId: string, id: string) =>
    apiClient.get<ShippingAgreementDetail>(`${base(agentId)}/${id}`),
  create: (agentId: string, dto: ShippingAgreementPeriodInput) =>
    apiClient.post<ShippingAgreementDetail>(base(agentId), {
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? undefined,
      notes: dto.notes ?? undefined,
    }),
  update: (agentId: string, id: string, dto: ShippingAgreementPeriodInput) =>
    apiClient.patch<ShippingAgreementDetail>(`${base(agentId)}/${id}`, dto),
  addRate: (agentId: string, id: string, dto: ShippingAgreementRateInput) =>
    apiClient.post<ShippingAgreementDetail>(`${base(agentId)}/${id}/rates`, dto),
  updateRate: (agentId: string, id: string, rateId: string, dto: ShippingAgreementRateInput) =>
    apiClient.patch<ShippingAgreementDetail>(`${base(agentId)}/${id}/rates/${rateId}`, dto),
  removeRate: (agentId: string, id: string, rateId: string) =>
    apiClient.delete<ShippingAgreementDetail>(`${base(agentId)}/${id}/rates/${rateId}`),
  discard: (agentId: string, id: string) =>
    apiClient.post<{ id: string; discarded: true }>(`${base(agentId)}/${id}/discard`),
  /** A new DRAFT with the same rates, from tomorrow (Cairo) by default. */
  duplicate: (agentId: string, id: string) =>
    apiClient.post<ShippingAgreementDetail>(`${base(agentId)}/${id}/duplicate`, {}),
  activate: (agentId: string, id: string, replaceFrom: boolean) =>
    apiClient.post<ShippingAgreementDetail>(`${base(agentId)}/${id}/activate`, { replaceFrom }),
  deactivate: (agentId: string, id: string, reason: string) =>
    apiClient.post<ShippingAgreementDetail>(`${base(agentId)}/${id}/deactivate`, { reason }),
};
