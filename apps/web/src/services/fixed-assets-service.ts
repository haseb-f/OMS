import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";
import { createMasterDataService, type MasterDataActivityEntry } from "./master-data-service";
import type { FixedAssetRow } from "@/config/master-data/entities";

const base = createMasterDataService<FixedAssetRow>("/fixed-assets");

export const fixedAssetsService = {
  ...base,
  create: (dto: Record<string, unknown>) => {
    const payload = compactPayload({ ...dto });
    if (Number(payload.usefulLifeMonths) < 1) delete payload.usefulLifeMonths;
    return base.create(payload);
  },
  update: (id: string, dto: Record<string, unknown>) => {
    const payload = compactPayload({ ...dto });
    if (Number(payload.usefulLifeMonths) < 1) delete payload.usefulLifeMonths;
    return base.update(id, payload);
  },
  capitalize: (id: string, dto: Record<string, unknown>) =>
    apiClient.post<FixedAssetRow>(`/fixed-assets/${id}/capitalize`, compactPayload(dto)),
  dispose: (id: string, dto: Record<string, unknown>) =>
    apiClient.post<FixedAssetRow>(`/fixed-assets/${id}/dispose`, compactPayload(dto)),
  runDepreciation: (dto: { asOf?: string } = {}) =>
    apiClient.post<{ asOf: string; postedCount: number; periodIds: string[] }>(
      "/fixed-assets/depreciation-run",
      dto,
    ),
};

export type { MasterDataActivityEntry };
