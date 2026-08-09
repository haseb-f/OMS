import { apiClient } from "./api-client";
import type { AnalyticPlanRow, AnalyticAccountRow } from "@/config/master-data/entities";

export interface AnalyticDistributionLine {
  id: string;
  documentType: string;
  documentId: string;
  analyticPlanId: string;
  analyticPlan: AnalyticPlanRow;
  analyticAccountId: string;
  analyticAccount: AnalyticAccountRow;
  createdAt: string;
  createdBy: string | null;
}

export interface AnalyticDistributionLineInput {
  analyticPlanId: string;
  analyticAccountId: string;
}

/**
 * One client behind the generic Analytic Distribution engine (TASK-025
 * Part 2) — every document type calls the same `documentType` +
 * `documentId` pair instead of a per-module distribution API.
 */
export const analyticDistributionsService = {
  get: (documentType: string, documentId: string) =>
    apiClient.get<AnalyticDistributionLine[]>(
      `/analytic-distributions?documentType=${encodeURIComponent(documentType)}&documentId=${encodeURIComponent(documentId)}`,
    ),
  set: (documentType: string, documentId: string, lines: AnalyticDistributionLineInput[]) =>
    apiClient.put<AnalyticDistributionLine[]>("/analytic-distributions", {
      documentType,
      documentId,
      lines,
    }),
};
