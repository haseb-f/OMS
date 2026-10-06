import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";
import { buildQueryString } from "@/lib/query-string";
import { createMasterDataService, type MasterDataActivityEntry } from "./master-data-service";
import type { FixedAssetRow } from "@/config/master-data/entities";
import type {
  ScheduleJournalRef,
  SchedulePreview,
  ScheduleRow,
  SourceInvoiceRef,
} from "./accounting-schedules-service";

export type DepreciationMethodValue = "STRAIGHT_LINE" | "DECLINING_BALANCE";

export interface FixedAssetSchedulePreview extends SchedulePreview {
  method: DepreciationMethodValue;
  cost: number;
  salvageValue: number;
  depreciableAmount: number;
  usefulLifeMonths: number | null;
}

/** `GET /fixed-assets/:id` — the asset with its schedule, entries and running amounts. */
export interface FixedAssetDetail extends FixedAssetRow, SourceInvoiceRef {
  purchaseInvoiceId: string | null;
  purchaseInvoiceItemId: string | null;
  capitalizedAt: string | null;
  disposedAt: string | null;
  disposalAmount: string | number | null;
  disposalNotes: string | null;
  /** R13b — proceeds settled as a supplier credit (Dr the partner's payable). */
  disposalPartner?: { id: string; name: string; partnerNumber?: string } | null;
  /** R13b — the purchase return that derecognized the asset (its JE is the disposal entry). */
  purchaseReturn?: { id: string; returnNumber: string; status: string } | null;
  /** R13b — directly attributable costs added by later purchase invoice lines. */
  costAdditions: FixedAssetCostAddition[];
  receivingAccount?: { id: string; name: string; code?: string } | null;
  partner?: { id: string; name: string; partnerNumber?: string } | null;
  depreciationPeriods: ScheduleRow[];
  journalEntries: {
    capitalization: ScheduleJournalRef | null;
    capitalizationSource: "PURCHASE_INVOICE" | "FIXED_ASSET_CAPITALIZATION";
    disposal: ScheduleJournalRef | null;
    disposalSource: "FIXED_ASSET_DISPOSAL" | "PURCHASE_RETURN";
  };
  summary: {
    cost: number;
    salvageValue: number;
    accumulatedDepreciation: number;
    bookValue: number;
    remainingDepreciable: number;
    postedPeriods: number;
    pendingPeriods: number;
    cancelledPeriods: number;
    failedPeriods: number;
    costAdditions: number;
  };
}

export interface FixedAssetCostAddition {
  id: string;
  amount: string | number;
  addedOn: string;
  respreadPeriods: number;
  purchaseInvoiceItem: {
    id: string;
    description: string | null;
    purchaseInvoice: { id: string; invoiceNumber: string };
  };
}

/** `GET /fixed-assets/cost-addition-targets` — assets an invoice line may add its cost to. */
export interface CostAdditionTarget {
  id: string;
  code: string | null;
  name: string;
  status: "DRAFT" | "CAPITALIZED";
  cost: number;
}

/** A FIXED_ASSET line of a Draft purchase invoice, not linked to an asset yet. */
export interface LinkableInvoiceLine {
  id: string;
  description: string | null;
  quantity: number;
  netAmount: number;
  assetUsefulLifeMonths: number | null;
  product?: { name: string; displayName: string | null } | null;
  purchaseInvoice: {
    id: string;
    invoiceNumber: string;
    referenceNumber: string | null;
    partner?: { name: string } | null;
    currency?: { code: string } | null;
  };
}

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
  detail: (id: string) => apiClient.get<FixedAssetDetail>(`/fixed-assets/${id}`),
  /** Stored schedule once capitalized; otherwise what capitalizing would create. */
  schedulePreview: (id: string) =>
    apiClient.get<FixedAssetSchedulePreview>(`/fixed-assets/${id}/schedule-preview`),
  capitalize: (id: string, dto: Record<string, unknown>) =>
    apiClient.post<FixedAssetRow>(`/fixed-assets/${id}/capitalize`, compactPayload(dto)),
  dispose: (id: string, dto: Record<string, unknown>) =>
    apiClient.post<FixedAssetRow>(`/fixed-assets/${id}/dispose`, compactPayload(dto)),
  linkableInvoiceLines: (search?: string) =>
    apiClient.get<LinkableInvoiceLine[]>(
      `/fixed-assets/linkable-invoice-lines${buildQueryString({ search })}`,
    ),
  linkInvoiceLine: (id: string, purchaseInvoiceItemId: string) =>
    apiClient.post<FixedAssetDetail>(`/fixed-assets/${id}/invoice-line`, {
      purchaseInvoiceItemId,
    }),
  costAdditionTargets: (search?: string) =>
    apiClient.get<CostAdditionTarget[]>(
      `/fixed-assets/cost-addition-targets${buildQueryString({ search })}`,
    ),
  unlinkInvoiceLine: (id: string) =>
    apiClient.delete<FixedAssetDetail>(`/fixed-assets/${id}/invoice-line`),
};

export type { MasterDataActivityEntry };
