"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  transactionTypesColumns,
  transactionTypesStaticFields,
  transactionTypesSchema,
  transactionTypesDefaultValues,
  transactionTypesExportColumns,
  transactionTypeRowLabel,
  TRANSACTION_MATCHING_TARGETS,
  TRANSACTION_ACCOUNTING_TREATMENTS,
} from "@/config/master-data/entities";
import { transactionTypesService } from "@/services/transaction-types-service";
import { useLocale } from "@/providers/locale-provider";

/** One tab's full table — a thin `MasterDataPage` wrapper fixed to its own direction via `extraListParams`, so الوارد/الصادر never share a single mixed list (spec section 3/6). */
function TransactionTypeDirectionTab({ direction }: { direction: "IN" | "OUT" }) {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      transactionTypesStaticFields[0],
      transactionTypesStaticFields[1],
      {
        name: "direction",
        label: "masterData.transactionTypes.fields.direction",
        type: "select",
        required: true,
        options: [
          { value: "IN", label: t("masterData.transactionTypes.direction.IN") },
          { value: "OUT", label: t("masterData.transactionTypes.direction.OUT") },
        ],
      },
      {
        name: "matchingTarget",
        label: "masterData.transactionTypes.fields.matchingTarget",
        type: "select",
        options: TRANSACTION_MATCHING_TARGETS.map((value) => ({
          value,
          label: t(`masterData.transactionTypes.matchingTarget.${value}`),
        })),
      },
      {
        name: "defaultAccountId",
        label: "masterData.transactionTypes.fields.defaultAccount",
        type: "account",
      },
      {
        name: "defaultAccountingTreatment",
        label: "masterData.transactionTypes.fields.accountingTreatment",
        type: "select",
        required: true,
        options: TRANSACTION_ACCOUNTING_TREATMENTS.map((value) => ({
          value,
          label: t(`masterData.transactionTypes.accountingTreatment.${value}`),
        })),
      },
      {
        name: "isActive",
        label: "masterData.transactionTypes.fields.isActive",
        type: "boolean",
      },
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.transactionTypes.title"
      descriptionKey={
        direction === "IN"
          ? "masterData.transactionTypes.descriptionIncoming"
          : "masterData.transactionTypes.descriptionOutgoing"
      }
      tableId={`transaction-types-${direction.toLowerCase()}`}
      service={transactionTypesService}
      columns={transactionTypesColumns}
      exportColumnKeys={transactionTypesExportColumns}
      formFields={formFields}
      schema={transactionTypesSchema}
      defaultValues={transactionTypesDefaultValues(direction)}
      rowLabel={transactionTypeRowLabel}
      permissionPrefix="masterdata.transaction-types"
      defaultSortBy="sortOrder"
      extraListParams={{ direction }}
      isRowProtected={(row) => row.isSystem}
    />
  );
}

export default function TransactionTypesPage() {
  const { t } = useLocale();
  const [inCount, setInCount] = useState<number | null>(null);
  const [outCount, setOutCount] = useState<number | null>(null);

  const loadCounts = useCallback(() => {
    transactionTypesService
      .list({ direction: "IN", pageSize: 1 })
      .then((result) => setInCount(result.total))
      .catch(() => undefined);
    transactionTypesService
      .list({ direction: "OUT", pageSize: 1 })
      .then((result) => setOutCount(result.total))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  return (
    <Tabs defaultValue="IN" className="flex flex-col gap-3" onValueChange={loadCounts}>
      <TabsList variant="line">
        <TabsTrigger value="IN" className="gap-1.5">
          {t("masterData.transactionTypes.tabs.incoming")}
          {inCount !== null && (
            <span className="text-caption text-muted-foreground tabular-nums">{inCount}</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="OUT" className="gap-1.5">
          {t("masterData.transactionTypes.tabs.outgoing")}
          {outCount !== null && (
            <span className="text-caption text-muted-foreground tabular-nums">{outCount}</span>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="IN">
        <TransactionTypeDirectionTab direction="IN" />
      </TabsContent>
      <TabsContent value="OUT">
        <TransactionTypeDirectionTab direction="OUT" />
      </TabsContent>
    </Tabs>
  );
}
