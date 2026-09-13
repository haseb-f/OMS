import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type {
  MasterDataActivityEntry,
  MasterDataListParams,
  MasterDataListResult,
} from "./master-data-service";

export type InvestorEntityType = "PERSON" | "ORGANIZATION";
export type InvestorStatus = "ACTIVE" | "INACTIVE";

export interface InvestorRow {
  id: string;
  partnerId: string;
  name: string;
  entityType: InvestorEntityType;
  phone: string | null;
  email: string | null;
  notes: string | null;
  commercialRegistration: string | null;
  status: InvestorStatus;
  nationalId: string | null;
  residencyId: string | null;
  iban: string | null;
  userId: string | null;
  userEmail: string | null;
  activeInvestmentsCount: number;
  completedInvestmentsCount: number;
  totalConfirmedFunding: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateInvestorPayload {
  name: string;
  entityType?: InvestorEntityType;
  phone?: string;
  email?: string;
  commercialRegistration?: string;
  nationalId?: string;
  residencyId?: string;
  iban?: string;
  notes?: string;
}

export interface UpdateInvestorPayload extends Partial<CreateInvestorPayload> {
  status?: InvestorStatus;
}

const basePath = "/investors";

export const investorsService = {
  list: (params: MasterDataListParams = {}) =>
    apiClient.get<MasterDataListResult<InvestorRow>>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<InvestorRow>(`${basePath}/${id}`),
  create: (dto: CreateInvestorPayload) => apiClient.post<InvestorRow>(basePath, dto),
  update: (id: string, dto: UpdateInvestorPayload) =>
    apiClient.patch<InvestorRow>(`${basePath}/${id}`, dto),
  archive: (id: string) => apiClient.post<InvestorRow>(`${basePath}/${id}/archive`),
  restore: (id: string) => apiClient.post<InvestorRow>(`${basePath}/${id}/restore`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
  /** Lightweight search for pickers (Opportunity "Add Investor" combobox). */
  search: (query: string) =>
    apiClient
      .get<MasterDataListResult<InvestorRow>>(
        `${basePath}${buildQueryString({ search: query || undefined, pageSize: 20 })}`,
      )
      .then((result) => result.items),
};
