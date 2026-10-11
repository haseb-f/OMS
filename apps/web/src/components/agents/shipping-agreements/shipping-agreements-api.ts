import { apiClient } from "@/services/api-client";
import type {
  AgentShippingCodFeeMode,
  AgentShippingRateService,
  AgentShippingService,
} from "@/services/agents-service";

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
  versionNumber?: number;
}

interface ShippingAgreementHead {
  id: string;
  agreementNumber: string;
  agentId: string;
  currencyId: string;
  status: ShippingAgreementStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** R17 §2 — instant bounds of the version (null = the day range alone). */
  activeFrom: string | null;
  activeTo: string | null;
  versionNumber: number;
  /** R17 §3 — fixed fee COD orders pay on top of an ADDED row (null = none). */
  codCollectionFee: number | null;
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
  service: AgentShippingRateService;
  countryId: string | null;
  country: ShippingCountryRef | null;
  /** '' = the whole country (or all destinations). */
  city: string;
  scope: ShippingDestinationScope;
  amount: number;
  codFee: AgentShippingCodFeeMode;
}

/** What an order to a destination is charged per service (null = missing). */
export interface ShippingCoverageCell {
  rateId: string;
  /** The charge (base + COD fee when ADDED). */
  amount: number;
  base: number;
  codFeeMode: AgentShippingCodFeeMode | "NONE";
  /** Charged by a broader row (country / all destinations), not its own. */
  inherited: boolean;
  /** The winning row's service (ANY = the default rate). */
  rowService: AgentShippingRateService;
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
  supersededBy:
    (ShippingAgreementRef & { effectiveFrom: string; activeFrom: string | null }) | null;
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
  service: AgentShippingRateService;
  /** Omitted = all destinations. */
  countryId?: string;
  /** Omitted = the whole country. */
  city?: string;
  amount: number;
  codFee?: AgentShippingCodFeeMode;
}

export interface ShippingAgreementPeriodInput {
  effectiveFrom: string;
  /** null clears the end date (open-ended). */
  effectiveTo: string | null;
  notes: string | null;
}

/** R17 — the compact form's terms: every rate row + the COD collection fee. */
export interface ShippingAgreementTermsInput {
  rates: ShippingAgreementRateInput[];
  codCollectionFee: number | null;
}

const base = (agentId: string) => `/agents/${agentId}/shipping-agreements`;

export const shippingAgreementsApi = {
  list: (agentId: string) => apiClient.get<ShippingAgreementList>(base(agentId)),
  get: (agentId: string, id: string) =>
    apiClient.get<ShippingAgreementDetail>(`${base(agentId)}/${id}`),
  /** A new DRAFT with its terms (number generated). */
  create: (
    agentId: string,
    dto: ShippingAgreementPeriodInput & Partial<ShippingAgreementTermsInput>,
  ) =>
    apiClient.post<ShippingAgreementDetail>(base(agentId), {
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? undefined,
      notes: dto.notes ?? undefined,
      ...(dto.rates ? { rates: dto.rates } : {}),
      ...(dto.codCollectionFee !== undefined ? { codCollectionFee: dto.codCollectionFee } : {}),
    }),
  /** DRAFT only; `rates` (when given) replaces every row. */
  update: (
    agentId: string,
    id: string,
    dto: ShippingAgreementPeriodInput & Partial<ShippingAgreementTermsInput>,
  ) => apiClient.patch<ShippingAgreementDetail>(`${base(agentId)}/${id}`, dto),
  /**
   * R17 §2 — "Edit" on the ACTIVE agreement: a new version in force from the
   * save instant; the current version closes at that instant.
   */
  createVersion: (
    agentId: string,
    id: string,
    dto: ShippingAgreementTermsInput & { notes: string | null },
  ) => apiClient.post<ShippingAgreementDetail>(`${base(agentId)}/${id}/versions`, dto),
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
