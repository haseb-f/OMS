"use client";

import { useState } from "react";
import { Info, PackageCheck } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { FormCardSection, FormCardStack } from "@/components/shared/form-card/form-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { FieldNote } from "@/components/agents/field-note";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";
import {
  storeOrderMoneyService,
  type ReturnItemCondition,
  type StoreOrderReturn,
  type StoreOrderReturnItem,
} from "./store-order-money-service";
import { buildInspectionLines } from "./store-order-money";

/**
 * "Receive & inspect" (R15, D15-10): the physical receipt of a requested
 * return. Per line the condition decides the destination — saleable back to
 * a stock warehouse, damaged to the damaged-goods warehouse (the server
 * defaults both and refuses a warehouse of the wrong kind); confirming
 * restocks and posts the credit note (revenue and cost of goods reversed).
 */
export function StoreOrderReceiveReturnDialog({
  storeOrderId,
  salesReturn,
  onOpenChange,
  onReceived,
}: {
  storeOrderId: string;
  salesReturn: StoreOrderReturn;
  onOpenChange: (open: boolean) => void;
  onReceived: () => void;
}) {
  const { t } = useLocale();
  const [conditions, setConditions] = useState<Record<string, ReturnItemCondition>>({});
  const [warehouses, setWarehouses] = useState<Record<string, WarehouseRow | undefined>>({});
  const [isSaving, setIsSaving] = useState(false);
  const anyDamaged = salesReturn.items.some((item) => conditions[item.id] === "DAMAGED");

  const setCondition = (itemId: string, condition: ReturnItemCondition) => {
    setConditions((current) => ({ ...current, [itemId]: condition }));
    // A chosen warehouse belongs to the previous condition's kind.
    setWarehouses((current) => ({ ...current, [itemId]: undefined }));
  };

  const submit = async () => {
    setIsSaving(true);
    try {
      const received = await storeOrderMoneyService.receiveReturn(
        storeOrderId,
        salesReturn.id,
        buildInspectionLines(
          salesReturn.items,
          conditions,
          Object.fromEntries(
            Object.entries(warehouses).map(([itemId, warehouse]) => [itemId, warehouse?.id]),
          ),
        ),
      );
      reportSuccess(t("storeOrderMoney.receiveDialog.received", { number: received.returnNumber }));
      onReceived();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const columns: CompactDetailColumn<StoreOrderReturnItem>[] = [
    {
      id: "product",
      header: t("storeOrderMoney.receiveDialog.product"),
      cell: (item) => (
        <span className="flex flex-col">
          <span>{item.product.name}</span>
          <span dir="ltr" className="text-caption text-muted-foreground">
            {item.product.sku}
          </span>
        </span>
      ),
    },
    {
      id: "quantity",
      header: t("storeOrderMoney.receiveDialog.quantity"),
      align: "end",
      cell: (item) => <SemanticValue kind="number">{item.quantity}</SemanticValue>,
    },
    {
      id: "condition",
      header: t("storeOrderMoney.receiveDialog.condition"),
      cell: (item) => (
        <SearchableSelect
          aria-label={`${t("storeOrderMoney.receiveDialog.condition")} — ${item.product.name}`}
          value={conditions[item.id] ?? "SALEABLE"}
          onValueChange={(value) =>
            setCondition(item.id, value === "DAMAGED" ? "DAMAGED" : "SALEABLE")
          }
          options={[
            { value: "SALEABLE", label: t("storeOrderMoney.receiveDialog.saleable") },
            { value: "DAMAGED", label: t("storeOrderMoney.receiveDialog.damaged") },
          ]}
        />
      ),
    },
    {
      id: "warehouse",
      header: t("storeOrderMoney.receiveDialog.warehouse"),
      cell: (item) => (
        <div className="flex min-w-40 flex-col gap-0.5">
          <WarehousePicker
            aria-label={`${t("storeOrderMoney.receiveDialog.warehouse")} — ${item.product.name}`}
            value={warehouses[item.id] ?? null}
            onChange={(warehouse) =>
              setWarehouses((current) => ({ ...current, [item.id]: warehouse }))
            }
          />
          <FieldNote
            hint={
              warehouses[item.id]
                ? null
                : conditions[item.id] === "DAMAGED"
                  ? t("storeOrderMoney.receiveDialog.damagedDefault")
                  : t("storeOrderMoney.receiveDialog.saleableDefault")
            }
          />
        </div>
      ),
    },
  ];

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      icon={PackageCheck}
      title={t("storeOrderMoney.receiveDialog.title", { number: salesReturn.returnNumber })}
      description={t("storeOrderMoney.receiveDialog.description")}
      isDirty={Object.keys(conditions).length > 0 || Object.values(warehouses).some(Boolean)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitLabel={t("storeOrderMoney.receiveDialog.submit")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection
          title={salesReturn.returnNumber}
          description={
            salesReturn.reason
              ? t("storeOrderMoney.receiveDialog.reason", { reason: salesReturn.reason })
              : undefined
          }
        >
          <CompactDetailTable
            stacked
            columns={columns}
            rows={salesReturn.items}
            rowKey={(item) => item.id}
          />
          {anyDamaged ? (
            <Alert tone="info">
              <Info />
              <AlertDescription>{t("storeOrderMoney.receiveDialog.damagedNote")}</AlertDescription>
            </Alert>
          ) : null}
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
