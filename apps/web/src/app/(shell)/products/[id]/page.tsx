"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, CheckCircle2, Package, Pencil } from "lucide-react";
import {
  DetailField,
  DetailFieldRow,
  DetailGroup,
  DetailSplitLayout,
  EditorWorkspace,
  RecordHighlightsHeader,
  StatusStrip,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityTabs } from "@/components/business/entity-tabs";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { PermissionGate } from "@/components/shared/permission-gate";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { formatAmount } from "@/lib/money";
import { formatDateTime } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import {
  productsService,
  type ProductActivityEntry as ProductActivityRow,
  type ProductRow,
} from "@/services/products-service";
import {
  useProductCategories,
  useProductBrands,
  useUnits,
  useTaxes,
  useAnalyticAccounts,
  useSuppliers,
  useWarehouses,
} from "@/hooks/use-reference-data";
import { ProductModal } from "../product-modal";

const STATUS_TONE: Record<ProductRow["status"], StatusTone> = {
  DRAFT: "warning",
  ACTIVE: "success",
  INACTIVE: "neutral",
};

/** A price field for display — `undefined` (field hidden) when not set. */
function priceText(value: string | null): string | undefined {
  if (value == null || value === "") return undefined;
  return Number.isFinite(Number(value)) ? formatAmount(value) : undefined;
}

function ProductDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("products.edit");
  const canArchive = hasPermission("products.archive");

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [activities, setActivities] = useState<ProductActivityRow[] | null>(null);

  const categories = useProductCategories();
  const brands = useProductBrands();
  const units = useUnits();
  const taxes = useTaxes();
  const analyticAccounts = useAnalyticAccounts();
  const suppliers = useSuppliers();
  const warehouses = useWarehouses();

  const [editOpen, setEditOpen] = useState(false);
  const [editInitialTab, setEditInitialTab] = useState<string | undefined>(undefined);
  const [isActivating, setIsActivating] = useState(false);

  useBreadcrumbLabel(product?.displayName ?? product?.name ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setProduct(await productsService.get(params.id));
    } catch (error) {
      setLoadError({
        notFound: error instanceof ApiError && error.status === 404,
        message: apiErrorMessage(error, "errors.loadFailed"),
      });
      setProduct(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await productsService.activity(params.id));
    } catch {
      setActivities([]);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadActivities();
  }, [loadActivities]);

  const openEdit = (tab?: string) => {
    setEditInitialTab(tab);
    setEditOpen(true);
  };

  const handleActivate = async () => {
    if (!product) return;
    setIsActivating(true);
    try {
      const activated = await productsService.activate(product.id);
      setProduct(activated);
      toast.success(t("products.detail.activated"));
      void loadActivities();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setIsActivating(false);
    }
  };

  const confirmArchive = async () => {
    if (!product) return;
    try {
      await productsService.archive(product.id);
      toast.success(t("products.archived"));
      router.push("/products");
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    }
  };

  if (isLoading) {
    return (
      <EditorWorkspace>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </EditorWorkspace>
    );
  }
  if (!product) {
    return (
      <EditorWorkspace>
        {loadError && !loadError.notFound ? (
          <ErrorState description={loadError.message} onRetry={() => void load()} />
        ) : (
          <EmptyState icon={Package} title={t("common.noResults")} />
        )}
      </EditorWorkspace>
    );
  }

  const editButton = (tab: string) =>
    canEdit ? (
      <IconActionButton label={t("common.edit")} onClick={() => openEdit(tab)}>
        <Pencil className="size-3.5" />
      </IconActionButton>
    ) : null;

  const timelineEntries: TimelineEntry[] = (activities ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description || entry.type,
    timestamp: formatDateTime(entry.createdAt),
    actor: entry.createdBy ?? undefined,
    status: "done",
  }));

  const isDraft = product.status === "DRAFT" || product.status === "INACTIVE";

  const overview = (
    <DetailSplitLayout
      main={
        <>
          <DetailGroup title={t("products.detail.sections.basics")} actions={editButton("general")}>
            <DetailFieldRow label={t("products.fields.name")} value={product.name} />
            <DetailFieldRow label={t("products.fields.nameEn")} value={product.nameEn} />
            <DetailFieldRow label={t("products.fields.sku")} value={product.sku} ltr />
            <DetailFieldRow label={t("products.fields.barcode")} value={product.barcode} ltr />
            <DetailFieldRow label={t("products.fields.description")} value={product.description} />
          </DetailGroup>
          {product.status === "DRAFT" && (
            <Alert tone="warning">
              <AlertDescription>{t("products.detail.draftExcludedHint")}</AlertDescription>
            </Alert>
          )}
        </>
      }
      sidebar={
        <DetailGroup title={t("products.detail.sections.status")}>
          <DetailFieldRow
            label={t("products.fields.status")}
            value={t(`products.status.${product.status}`)}
          />
          <DetailFieldRow
            label={t("products.fields.type")}
            value={t(`products.type.${product.type}`)}
          />
          <DetailFieldRow label={t("products.fields.category")} value={product.category?.name} />
          <DetailFieldRow label={t("products.fields.brand")} value={product.brand?.name} />
          <DetailFieldRow label={t("products.fields.unit")} value={product.unit?.name} />
          <DetailFieldRow
            label={t("products.fields.preferredSupplier")}
            value={product.preferredSupplier?.name}
          />
          <DetailFieldRow label={t("products.fields.taxGroup")} value={product.tax?.name} />
          <DetailFieldRow
            label={t("products.fields.createdAt")}
            value={formatDateTime(product.createdAt)}
            ltr
          />
          <DetailFieldRow
            label={t("products.fields.updatedAt")}
            value={formatDateTime(product.updatedAt)}
            ltr
          />
        </DetailGroup>
      }
    />
  );

  const pricing = (
    <DetailGroup title={t("products.wizard.steps.pricing")} actions={editButton("sales")}>
      <DetailFieldRow
        label={t("products.fields.salesPrice")}
        value={priceText(product.salesPrice)}
        ltr
      />
      <DetailFieldRow
        label={t("products.fields.purchasePrice")}
        value={priceText(product.purchasePrice)}
        ltr
      />
      <DetailFieldRow label={t("products.fields.taxGroup")} value={product.tax?.name} />
      <DetailFieldRow
        label={t("products.fields.preferredSupplier")}
        value={product.preferredSupplier?.name}
      />
      <DetailFieldRow
        label={t("products.fields.allowDiscount")}
        value={product.allowDiscount ? t("common.yes") : undefined}
      />
      {!product.salesPrice &&
      !product.purchasePrice &&
      !product.tax &&
      !product.preferredSupplier ? (
        <p className="col-span-full py-1.5 text-caption text-muted-foreground">
          {t("products.wizard.notProvided")}
        </p>
      ) : null}
    </DetailGroup>
  );

  const inventory = (
    <DetailGroup title={t("products.wizard.steps.inventory")} actions={editButton("inventory")}>
      <DetailFieldRow
        label={t("products.fields.trackInventory")}
        value={product.isInventoryItem ? t("common.yes") : undefined}
      />
      <DetailFieldRow label={t("products.fields.reorderLevel")} value={product.reorderLevel} ltr />
      <DetailFieldRow
        label={t("products.fields.preferredWarehouse")}
        value={product.preferredWarehouse?.name}
      />
      <DetailFieldRow label={t("products.fields.weight")} value={product.weight} ltr />
      <DetailFieldRow label={t("products.fields.width")} value={product.width} ltr />
      <DetailFieldRow label={t("products.fields.height")} value={product.height} ltr />
      <DetailFieldRow label={t("products.fields.length")} value={product.length} ltr />
      {!product.isInventoryItem &&
      !product.reorderLevel &&
      !product.preferredWarehouse &&
      !product.weight ? (
        <p className="col-span-full py-1.5 text-caption text-muted-foreground">
          {t("products.wizard.notProvided")}
        </p>
      ) : null}
    </DetailGroup>
  );

  const activity = (
    <DetailGroup title={t("products.detail.tabs.activity")}>
      {timelineEntries.length > 0 ? (
        <div className="py-2">
          <AuditTimeline entries={timelineEntries} />
        </div>
      ) : (
        <p className="py-3 text-caption text-muted-foreground">
          {t("products.wizard.notProvided")}
        </p>
      )}
    </DetailGroup>
  );

  const flag = (on: boolean) => (
    <StatusBadge label={on ? t("common.yes") : t("common.no")} tone={on ? "success" : "neutral"} />
  );

  return (
    <EditorWorkspace>
      <RecordHighlightsHeader
        identity={product.displayName || product.name}
        reference={product.sku}
        status={
          <StatusBadge
            label={t(`products.status.${product.status}`)}
            tone={STATUS_TONE[product.status]}
          />
        }
        statusStrip={
          <StatusStrip
            label={t("products.detail.sections.status")}
            groups={[
              {
                key: "classification",
                items: [
                  {
                    key: "type",
                    label: t("products.fields.type"),
                    status: <StatusBadge label={t(`products.type.${product.type}`)} tone="info" />,
                  },
                ],
              },
              {
                key: "availability",
                items: [
                  {
                    key: "sale",
                    label: t("products.fields.availableForSale"),
                    status: flag(product.isSellable),
                  },
                  {
                    key: "purchase",
                    label: t("products.fields.availableForPurchase"),
                    status: flag(product.isPurchasable),
                  },
                  {
                    key: "inventory",
                    label: t("products.fields.trackInventory"),
                    status: flag(product.isInventoryItem),
                  },
                ],
              },
            ]}
          />
        }
        metrics={
          <>
            <DetailField label={t("products.fields.category")} value={product.category?.name} />
            <DetailField label={t("products.fields.unit")} value={product.unit?.name} />
            <DetailField
              label={t("products.fields.salesPrice")}
              value={
                priceText(product.salesPrice) ? (
                  <span className="num">{priceText(product.salesPrice)}</span>
                ) : undefined
              }
            />
            <DetailField
              label={t("products.fields.purchasePrice")}
              value={
                priceText(product.purchasePrice) ? (
                  <span className="num">{priceText(product.purchasePrice)}</span>
                ) : undefined
              }
            />
          </>
        }
        actions={
          <HeaderActions
            primary={
              isDraft
                ? {
                    key: "activate",
                    label: t("products.detail.activate"),
                    icon: CheckCircle2,
                    variant: "success",
                    hidden: !canEdit,
                    loading: isActivating,
                    onSelect: () => void handleActivate(),
                  }
                : {
                    key: "edit",
                    label: t("common.edit"),
                    icon: Pencil,
                    hidden: !canEdit,
                    onSelect: () => openEdit(undefined),
                  }
            }
            secondary={[
              {
                key: "edit",
                label: t("common.edit"),
                icon: Pencil,
                hidden: !canEdit || !isDraft,
                onSelect: () => openEdit(undefined),
              },
            ]}
            destructive={[
              {
                key: "archive",
                label: t("common.archive"),
                icon: Archive,
                hidden: !canArchive || !!product.deletedAt,
                confirm: {
                  title: t("common.confirmArchiveTitle"),
                  description: `${product.displayName} — ${t("common.confirmArchiveDescription")}`,
                  confirmLabel: t("common.archive"),
                },
                onSelect: confirmArchive,
              },
            ]}
          />
        }
      />

      <EntityTabs
        defaultValue="overview"
        tabs={[
          { value: "overview", label: t("products.detail.tabs.overview"), content: overview },
          { value: "pricing", label: t("products.detail.tabs.pricing"), content: pricing },
          { value: "inventory", label: t("products.detail.tabs.inventory"), content: inventory },
          {
            value: "activity",
            label: t("products.detail.tabs.activity"),
            badge:
              timelineEntries.length > 0 ? (
                <span className="num text-caption text-muted-foreground">
                  {timelineEntries.length}
                </span>
              ) : undefined,
            content: activity,
          },
        ]}
      />

      <ProductModal
        open={editOpen}
        onOpenChange={setEditOpen}
        icon={Package}
        editingProduct={product}
        duplicateSource={null}
        categories={categories}
        brands={brands}
        units={units}
        taxes={taxes}
        analyticAccounts={analyticAccounts}
        suppliers={suppliers}
        warehouses={warehouses}
        onSaved={() => {
          void load();
        }}
        onCategoryCreated={(category) => useProductCategories.add(category)}
        initialTab={editInitialTab}
      />
    </EditorWorkspace>
  );
}

export default function ProductDetailPage() {
  return (
    <PermissionGate permission="products.view">
      <ProductDetailContent />
    </PermissionGate>
  );
}
