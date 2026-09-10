"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { EnterpriseButton } from "@/components/ui/button";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  commissionPlansService,
  type CommissionPlanRow,
  type UpdateCommissionPlanPayload,
} from "@/services/commission-plans-service";
import {
  buildCommissionPlansColumns,
  commissionPlansExportColumns,
  commissionPlanRowLabel,
  commissionPlanUpdateSchema,
  commissionPlanUpdateDefaultValues,
} from "@/config/hr/commission-plans";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

const BASIS_VALUES = ["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"] as const;

/** Adapts `commissionPlansService`'s narrow DTOs to `MasterDataPage`'s generic service shape. Only `name`/`description`/`basis` are ever edited through this quick modal — `ruleType`/`tiers` always change together via the full editor page, so `update` never sends `ruleType` here. There is no `GET :id/activity` route for Commission Plans (unlike most Master Data entities), so `activity` is stubbed to an empty list rather than hitting a route that doesn't exist. */
const listService = {
  ...commissionPlansService,
  create: (dto: Record<string, unknown>) =>
    commissionPlansService.create(
      dto as unknown as Parameters<typeof commissionPlansService.create>[0],
    ),
  update: (id: string, dto: Record<string, unknown>) =>
    commissionPlansService.update(id, dto as UpdateCommissionPlanPayload),
  activity: () => Promise.resolve([]),
};

export default function CommissionPlansPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();

  const columns = useMemo(() => buildCommissionPlansColumns(t), [t]);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      { name: "name", label: "hr.commissionPlans.fields.name", type: "text", required: true },
      { name: "description", label: "hr.commissionPlans.fields.description", type: "textarea" },
      {
        name: "basis",
        label: "hr.commissionPlans.fields.basis",
        type: "select",
        options: BASIS_VALUES.map((value) => ({
          value,
          label: t(`hr.commissionPlans.basis.${value}`),
        })),
      },
    ],
    [t],
  );

  return (
    <MasterDataPage<CommissionPlanRow>
      titleKey="hr.commissionPlans.title"
      descriptionKey="hr.commissionPlans.description"
      tableId="hr-commission-plans"
      service={listService}
      columns={columns}
      exportColumnKeys={commissionPlansExportColumns}
      formFields={formFields}
      schema={commissionPlanUpdateSchema}
      defaultValues={commissionPlanUpdateDefaultValues}
      permissionPrefix="hr.commission-plans"
      rowLabel={commissionPlanRowLabel}
      defaultSortBy="sortOrder"
      defaultSortOrder="asc"
      hideCreateButton
      getRowHref={(row) => `/hr/commission-plans/${row.id}`}
      extraActions={
        hasPermission("hr.commission-plans.create") ? (
          <EnterpriseButton type="button" onClick={() => router.push("/hr/commission-plans/new")}>
            <Plus />
            {t("hr.commissionPlans.addNew")}
          </EnterpriseButton>
        ) : undefined
      }
    />
  );
}
