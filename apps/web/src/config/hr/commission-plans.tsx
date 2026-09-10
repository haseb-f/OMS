"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { statusColumn } from "@/config/master-data/shared-columns";
import type { CommissionPlanRow } from "@/services/commission-plans-service";
import type { MessageKey } from "@/i18n/translate";

export function buildCommissionPlansColumns(
  t: (key: MessageKey) => string,
): ColumnDef<CommissionPlanRow, unknown>[] {
  return [
    {
      id: "name",
      meta: { titleKey: "hr.commissionPlans.fields.name" },
      accessorFn: (row) => row.name,
      cell: (info) => info.getValue() as string,
    },
    {
      id: "basis",
      meta: { titleKey: "hr.commissionPlans.fields.basis" },
      accessorFn: (row) => t(`hr.commissionPlans.basis.${row.basis}` as MessageKey),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "ruleType",
      meta: { titleKey: "hr.commissionPlans.fields.ruleType" },
      accessorFn: (row) => t(`hr.commissionPlans.ruleType.${row.ruleType}` as MessageKey),
      cell: (info) => info.getValue() as string,
    },
    statusColumn<CommissionPlanRow>(),
  ];
}

export const commissionPlansExportColumns = ["name", "basis", "ruleType"];

export const commissionPlanRowLabel = (row: CommissionPlanRow) => row.name;

/** Quick-edit modal fields only — `ruleType`/`tiers` always change together via the full editor page (`/hr/commission-plans/[id]`), never through this generic modal, so a `ruleType` change here could never leave stale tiers inconsistent with the new rule type. */
export const commissionPlanUpdateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  basis: z.enum(["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"]).optional(),
});

export const commissionPlanUpdateDefaultValues = {
  name: "",
  description: "",
  basis: "COLLECTED_SALES" as const,
};
