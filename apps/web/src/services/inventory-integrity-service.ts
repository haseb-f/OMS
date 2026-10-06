import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

/** R13 `GET /inventory/integrity` (api-contract.md §5) — invariants I1–I7. Read-only. */
export type IntegrityStatus = "PASS" | "WARN" | "FAIL";
export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7";

export interface IntegrityViolation {
  rule: string;
  severity: Exclude<IntegrityStatus, "PASS">;
  message: string;
  [detail: string]: unknown;
}

export interface InvariantResult {
  id: InvariantId;
  title: string;
  status: IntegrityStatus;
  checked: number;
  violationCount: number;
  violations: IntegrityViolation[];
  truncated: boolean;
  notes: string[];
  metrics: Record<string, string | number | null>;
}

export interface IntegrityReport {
  generatedAt: string;
  durationMs: number;
  filter: { productIds: string[] | null; warehouseId: string | null };
  status: IntegrityStatus;
  summary: Record<IntegrityStatus, number>;
  invariants: InvariantResult[];
}

export const inventoryIntegrityService = {
  run: (params: { productIds?: string[]; warehouseId?: string } = {}) =>
    apiClient.get<IntegrityReport>(
      `/inventory/integrity${buildQueryString({
        productIds: params.productIds?.length ? params.productIds.join(",") : undefined,
        warehouseId: params.warehouseId || undefined,
      })}`,
    ),
};
