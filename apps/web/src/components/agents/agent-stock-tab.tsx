"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { ErrorState } from "@/components/shared/error-state";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import type { ColumnDef } from "@tanstack/react-table";
import type { WarehouseRow } from "@/config/master-data/entities";
import {
  agentsService,
  type AgentStockResult,
  type AgentStockRow,
} from "@/services/agents-service";
import { productsService, type ProductRow } from "@/services/products-service";
import { inventoryService } from "@/services/inventory-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { FieldNote } from "./field-note";

const quantity = (value: number) => <SemanticValue kind="number">{value}</SemanticValue>;

function buildStockColumns(): ColumnDef<AgentStockRow, unknown>[] {
  const qty = (
    id: keyof Pick<AgentStockRow, "onHand" | "reserved" | "available" | "shipped" | "returned">,
    importance: "critical" | "high" | "medium" | "low",
  ): ColumnDef<AgentStockRow, unknown> => ({
    id,
    meta: { titleKey: `agents.stock.${id}` as MessageKey, type: "quantity", importance },
    enableSorting: false,
    accessorFn: (row) => row[id],
    cell: ({ row }) => quantity(row.original[id]),
  });
  return [
    {
      id: "product",
      meta: {
        titleKey: "agents.stock.product",
        stacked: true,
        type: "name",
        importance: "critical",
        minWidth: 180,
        grow: 2,
      },
      enableSorting: false,
      accessorFn: (row) => `${row.product.name} ${row.product.sku ?? ""}`,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <Link href={`/products/${row.original.productId}`} className="hover:underline">
              {row.original.product.name}
            </Link>
          }
          secondary={
            row.original.product.sku ? (
              <SemanticValue kind="id">{row.original.product.sku}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "warehouse",
      meta: { titleKey: "agents.stock.warehouse", importance: "high", minWidth: 120 },
      enableSorting: false,
      accessorFn: (row) => row.warehouse?.name ?? "",
      cell: ({ row }) => row.original.warehouse?.name ?? <StockPlaceholder />,
    },
    qty("onHand", "critical"),
    qty("reserved", "medium"),
    qty("available", "high"),
    qty("shipped", "low"),
    qty("returned", "low"),
  ];
}

function StockPlaceholder() {
  const { t } = useLocale();
  return <span className="text-muted-foreground">{t("agents.stock.noWarehouse")}</span>;
}

export function AgentStockTab({ agentId, agentLabel }: { agentId: string; agentLabel: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canReceive = hasPermission("inventory.movements.create");
  const [stock, setStock] = useState<AgentStockResult | null>(null);
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [stockResult, productResult] = await Promise.all([
        agentsService.stock(agentId),
        productsService
          .list({ agentId, pageSize: 200 })
          .then((result) => result.items)
          .catch(() => [] as ProductRow[]),
      ]);
      setStock(stockResult);
      setProducts(productResult);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildStockColumns(), []);

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!stock || !products) return null;

  const stockable = products.filter((product) => product.isInventoryItem);

  return (
    <div className="flex flex-col gap-3">
      <DetailSection
        title={t("agents.stock.stockTitle")}
        actions={
          canReceive && stockable.length > 0 ? (
            <EnterpriseButton type="button" size="sm" onClick={() => setReceiveOpen(true)}>
              <PackagePlus />
              {t("agents.stock.receive")}
            </EnterpriseButton>
          ) : null
        }
      >
        <p className="text-caption text-muted-foreground">{t("agents.stock.receiveDescription")}</p>
        <EnterpriseDataTable
          tableId="agent-stock"
          printTitle={`${t("agents.stock.stockTitle")} — ${agentLabel}`}
          columns={columns}
          data={stock.items}
          getRowId={(row) => `${row.productId}:${row.warehouseId ?? "none"}`}
          onRefresh={() => void load()}
          emptyTitle={t("agents.stock.stockEmpty")}
          footerRow={{
            product: t("agents.stock.total"),
            onHand: quantity(stock.totals.onHand),
            reserved: quantity(stock.totals.reserved),
            available: quantity(stock.totals.available),
            shipped: quantity(stock.totals.shipped),
            returned: quantity(stock.totals.returned),
          }}
        />
      </DetailSection>

      {receiveOpen ? (
        <ReceiveStockDialog
          agentLabel={agentLabel}
          products={stockable}
          onOpenChange={setReceiveOpen}
          onReceived={() => void load()}
        />
      ) : null}
    </div>
  );
}

/**
 * Stock receipt for agent goods = the existing inventory adjustment (+) on
 * the agent-owned product; the server stamps the owner on the movement.
 */
function ReceiveStockDialog({
  agentLabel,
  products,
  onOpenChange,
  onReceived,
}: {
  agentLabel: string;
  products: ProductRow[];
  onOpenChange: (open: boolean) => void;
  onReceived: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [productId, setProductId] = useState(products.length === 1 ? products[0].id : "");
  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const required = t("agents.agreements.errors.required");
  const qtyValue = Number(qty);
  const qtyValid = Number.isInteger(qtyValue) && qtyValue > 0;

  const submit = async () => {
    if (!productId || !warehouse || !qtyValid) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      await inventoryService.adjustment({
        productId,
        warehouseId: warehouse.id,
        quantity: qtyValue,
        reason: t("agents.stock.reasonText", { agent: agentLabel }),
        notes: notes.trim() || undefined,
      });
      toast.success(t("agents.stock.received"));
      onReceived();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      title={t("agents.stock.receiveTitle")}
      description={agentLabel}
      isDirty={!!(qty || notes || warehouse)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitLabel={t("agents.stock.receive")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.stock.receiveTitle")}>
          <FormCardField
            required
            label={t("agents.stock.product")}
            htmlFor={`${fieldId}-product`}
            message={<FieldNote error={showErrors && !productId ? required : null} />}
          >
            <SearchableSelect
              id={`${fieldId}-product`}
              value={productId}
              onValueChange={setProductId}
              error={showErrors && !productId}
              placeholder={t("agents.agreements.choose")}
              subtitleDir="ltr"
              options={products.map((product) => ({
                value: product.id,
                label: product.displayName || product.name,
                description: product.sku,
                searchText: product.sku,
              }))}
            />
          </FormCardField>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.stock.warehouse")}
              htmlFor={`${fieldId}-warehouse`}
              message={<FieldNote error={showErrors && !warehouse ? required : null} />}
            >
              <WarehousePicker
                id={`${fieldId}-warehouse`}
                value={warehouse}
                onChange={setWarehouse}
                error={showErrors && !warehouse}
              />
            </FormCardField>
            <FormCardField
              size="xs"
              required
              label={t("agents.stock.quantity")}
              htmlFor={`${fieldId}-qty`}
              message={
                <FieldNote
                  error={
                    showErrors && !qtyValid ? t("agents.storeOrder.returnErrors.notInteger") : null
                  }
                />
              }
            >
              <Input
                id={`${fieldId}-qty`}
                dir="ltr"
                inputMode="numeric"
                value={qty}
                aria-invalid={showErrors && !qtyValid}
                onChange={(event) => setQty(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardField label={t("agents.stock.notes")} htmlFor={`${fieldId}-notes`}>
            <Input
              id={`${fieldId}-notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
