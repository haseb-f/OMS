"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  fulfillmentCostRulesColumns,
  fulfillmentCostRulesFormFieldsHead,
  fulfillmentCostRulesFormFieldsTail,
  fulfillmentCostRulesSchema,
  fulfillmentCostRulesDefaultValues,
  fulfillmentCostRulesExportColumns,
  fulfillmentCostRuleRowLabel,
  type DirectFulfillmentCostRuleRow,
} from "@/config/master-data/entities";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useCurrencies } from "@/hooks/use-reference-data";

const service = createMasterDataService<DirectFulfillmentCostRuleRow>("/fulfillment-cost-rules");

/** ADR-0018 (Order Economics M2.2) — the Packaging/Direct Fulfillment cost source; V1 scope is one flat cost per fulfilled Order. */
function FulfillmentCostRulesPageContent() {
  const currencies = useCurrencies();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...fulfillmentCostRulesFormFieldsHead,
      {
        name: "currencyId",
        label: "masterData.fields.currency",
        type: "select",
        required: true,
        options: currencies.map((currency) => ({
          value: currency.id,
          label: `${currency.code} — ${currency.name}`,
        })),
      },
      ...fulfillmentCostRulesFormFieldsTail,
    ],
    [currencies],
  );

  return (
    <MasterDataPage
      titleKey="masterData.fulfillmentCostRules.title"
      descriptionKey="masterData.fulfillmentCostRules.description"
      tableId="fulfillment-cost-rules"
      service={service}
      columns={fulfillmentCostRulesColumns}
      exportColumnKeys={fulfillmentCostRulesExportColumns}
      formFields={formFields}
      schema={fulfillmentCostRulesSchema}
      defaultValues={fulfillmentCostRulesDefaultValues}
      permissionPrefix="masterdata.fulfillment-cost-rules"
      rowLabel={fulfillmentCostRuleRowLabel}
    />
  );
}

export default function FinanceFulfillmentCostRulesPage() {
  return (
    <PermissionGate permission="masterdata.fulfillment-cost-rules.view">
      <FulfillmentCostRulesPageContent />
    </PermissionGate>
  );
}
