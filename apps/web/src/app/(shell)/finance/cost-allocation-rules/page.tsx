"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  costAllocationRulesColumns,
  costAllocationRulesFormFieldsHead,
  costAllocationRulesFormFieldsTail,
  costAllocationRulesSchema,
  costAllocationRulesDefaultValues,
  costAllocationRulesExportColumns,
  costAllocationRuleRowLabel,
  COST_ALLOCATION_METHOD_VALUES,
  COST_ALLOCATION_DIMENSION_VALUES,
  type CostAllocationRuleRow,
} from "@/config/master-data/entities";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { DetailSection } from "@/components/shared/detail-workspace";
import { CostAllocationRunsPanel } from "@/components/finance/cost-allocation-runs-panel";
import { costAllocationService } from "@/services/cost-allocation-service";
import type { MessageKey } from "@/i18n/translate";

const service = costAllocationService;

/** M4 (Cost Module completion) — Rule CRUD (standard Master Data shape) plus a Runs panel below, matching the "one coherent Cost Module" integration the rest of M1-M3 already follows. */
function CostAllocationRulesPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [rules, setRules] = useState<CostAllocationRuleRow[]>([]);

  useEffect(() => {
    service
      .list({ pageSize: 200 })
      .then((r) => setRules(r.items.filter((rule) => rule.isActive)))
      .catch(() => setRules([]));
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...costAllocationRulesFormFieldsHead,
      {
        name: "method",
        label: "masterData.costAllocationRules.method",
        type: "select",
        required: true,
        options: COST_ALLOCATION_METHOD_VALUES.map((v) => ({
          value: v,
          label: t(`masterData.costAllocationRules.methodValues.${v}` as MessageKey),
        })),
      },
      {
        name: "targetDimension",
        label: "masterData.costAllocationRules.targetDimension",
        type: "select",
        required: true,
        options: COST_ALLOCATION_DIMENSION_VALUES.map((v) => ({
          value: v,
          label: t(`masterData.costAllocationRules.dimensionValues.${v}` as MessageKey),
        })),
      },
      ...costAllocationRulesFormFieldsTail,
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      <MasterDataPage
        titleKey="masterData.costAllocationRules.title"
        descriptionKey="masterData.costAllocationRules.description"
        tableId="cost-allocation-rules"
        service={service}
        columns={costAllocationRulesColumns}
        exportColumnKeys={costAllocationRulesExportColumns}
        formFields={formFields}
        schema={costAllocationRulesSchema}
        defaultValues={costAllocationRulesDefaultValues}
        permissionPrefix="masterdata.cost-allocation-rules"
        rowLabel={costAllocationRuleRowLabel}
      />

      {hasPermission("masterdata.cost-allocation-rules.run") && (
        <DetailSection title={t("masterData.costAllocationRules.runs.title")}>
          <CostAllocationRunsPanel rules={rules} />
        </DetailSection>
      )}
    </div>
  );
}

export default function FinanceCostAllocationRulesPage() {
  return (
    <PermissionGate permission="masterdata.cost-allocation-rules.view">
      <CostAllocationRulesPageContent />
    </PermissionGate>
  );
}
