"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, PencilLine } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ProductPicker } from "@/components/business/product-picker";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { DetailSummaryBar, DetailField } from "@/components/shared/detail-workspace";
import { inventoryService, type StockCard } from "@/services/inventory-service";
import { productCostService } from "@/services/product-cost-service";
import type { ProductRow } from "@/services/products-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";

function formatMoney(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ADR-0017 — read-only by default: on-hand qty / average cost / inventory
 * value come straight from the same `InventoryValuationService`-maintained
 * `StockCard` Cost Explorer reads, never a second calculation. "Record Cost"
 * is the manual-entry exception path the ADR keeps — permission-gated
 * separately (`expenses.manage`), never the primary way cost changes.
 */
function ProductCostPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [stockCard, setStockCard] = useState<StockCard | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordCost, setRecordCost] = useState("");
  const [recordReason, setRecordReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canManage = hasPermission("expenses.manage");

  const load = useCallback((productId: string) => {
    setIsLoading(true);
    inventoryService
      .getStockCard(productId)
      .then(setStockCard)
      .catch((error) => {
        setStockCard(null);
        toast.error(error instanceof ApiError ? error.message : "Failed to load product cost.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleProductChange = (next: ProductRow) => {
    setProduct(next);
    load(next.id);
  };

  const openRecordDialog = () => {
    setRecordCost(stockCard?.averageCost != null ? String(stockCard.averageCost) : "");
    setRecordReason("");
    setRecordOpen(true);
  };

  const handleRecordSave = async () => {
    if (!product) return;
    const cost = Number(recordCost);
    if (!recordCost || Number.isNaN(cost) || cost < 0) {
      toast.error(t("expensesProductCost.validation.costRequired"));
      return;
    }
    setIsSaving(true);
    try {
      await productCostService.recordCost(product.id, {
        cost,
        reason: recordReason || undefined,
      });
      toast.success(t("expensesProductCost.toasts.recorded"));
      setRecordOpen(false);
      load(product.id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageWorkspace
      title={t("expensesProductCost.title")}
      description={t("expensesProductCost.description")}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-sm grow">
          <ProductPicker
            value={product}
            onChange={handleProductChange}
            inventoryOnly
            sellableOnly={false}
          />
        </div>
        {product && canManage && (
          <EnterpriseButton type="button" variant="outline" size="sm" onClick={openRecordDialog}>
            <PencilLine className="size-3.5" />
            {t("expensesProductCost.actions.recordCost")}
          </EnterpriseButton>
        )}
      </div>

      {!product ? (
        <p className="text-caption text-muted-foreground">{t("expensesProductCost.empty")}</p>
      ) : isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <>
          <DetailSummaryBar>
            <DetailField
              label={t("expensesProductCost.fields.averageCost")}
              value={formatMoney(stockCard?.averageCost ?? null)}
            />
            <DetailField
              label={t("expensesProductCost.fields.onHand")}
              value={stockCard?.onHand ?? "—"}
            />
            <DetailField
              label={t("expensesProductCost.fields.stockValue")}
              value={formatMoney(stockCard?.stockValue ?? null)}
            />
            <DetailField
              label={t("expensesProductCost.fields.lastMovement")}
              value={
                stockCard?.lastMovement ? formatDateTime(stockCard.lastMovement.createdAt) : "—"
              }
            />
          </DetailSummaryBar>

          <Link
            href={`/expenses/cost-explorer?productId=${product.id}`}
            className="inline-flex w-fit items-center gap-1 text-body text-primary hover:underline"
          >
            {t("expensesProductCost.viewFullHistory")}
            <ArrowUpRight className="size-3.5" />
          </Link>
        </>
      )}

      <EnterpriseModal
        open={recordOpen}
        onOpenChange={setRecordOpen}
        title={t("expensesProductCost.recordDialog.title")}
        description={t("expensesProductCost.recordDialog.description")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" disabled={isSaving} onClick={handleRecordSave}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>{t("expensesProductCost.recordDialog.cost")}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={recordCost}
              onChange={(e) => setRecordCost(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("common.reason")}</Label>
            <Textarea value={recordReason} onChange={(e) => setRecordReason(e.target.value)} />
          </div>
        </div>
      </EnterpriseModal>
    </PageWorkspace>
  );
}

export default function ExpensesProductCostPage() {
  return (
    <PermissionGate permission="expenses.view">
      <ProductCostPageContent />
    </PermissionGate>
  );
}
