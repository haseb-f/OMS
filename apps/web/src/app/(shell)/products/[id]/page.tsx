"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, CheckCircle2, Package, Pencil } from "lucide-react";
import {
  DetailField,
  DetailFieldRow,
  DetailGroup,
  DetailSplitLayout,
  RecordHighlightsHeader,
} from "@/components/shared/detail-workspace";
import { RowActionsMenu } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityTabs } from "@/components/business/entity-tabs";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { PermissionGate } from "@/components/shared/permission-gate";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import {
  productsService,
  type ProductActivityEntry as ProductActivityRow,
  type ProductRow,
} from "@/services/products-service";
import { createMasterDataService } from "@/services/master-data-service";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import type {
  CategoryRow,
  BrandRow,
  UnitRow,
  TaxRow,
  AnalyticAccountRow,
  WarehouseRow,
} from "@/config/master-data/entities";
import { ProductModal } from "../product-modal";

const categoriesService = createMasterDataService<CategoryRow>("/product-categories");
const brandsService = createMasterDataService<BrandRow>("/product-brands");
const unitsService = createMasterDataService<UnitRow>("/units");
const taxesService = createMasterDataService<TaxRow>("/taxes");
const analyticAccountsService = createMasterDataService<AnalyticAccountRow>("/analytic-accounts");
const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

const STATUS_TONE: Record<ProductRow["status"], StatusTone> = {
  DRAFT: "warning",
  ACTIVE: "success",
  INACTIVE: "neutral",
};

function formatMoney(value: string | null): string | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : undefined;
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
  const [activities, setActivities] = useState<ProductActivityRow[] | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [taxes, setTaxes] = useState<TaxRow[]>([]);
  const [analyticAccounts, setAnalyticAccounts] = useState<AnalyticAccountRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editInitialTab, setEditInitialTab] = useState<string | undefined>(undefined);
  const [isActivating, setIsActivating] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  useBreadcrumbLabel(product?.displayName ?? product?.name ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setProduct(await productsService.get(params.id));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
      setProduct(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, t]);

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

  useEffect(() => {
    const notifyLoadFailed = () => undefined;
    categoriesService
      .list({ pageSize: 200 })
      .then((r) => setCategories(r.items))
      .catch(notifyLoadFailed);
    brandsService
      .list({ pageSize: 200 })
      .then((r) => setBrands(r.items))
      .catch(notifyLoadFailed);
    unitsService
      .list({ pageSize: 200 })
      .then((r) => setUnits(r.items))
      .catch(notifyLoadFailed);
    taxesService
      .list({ pageSize: 200 })
      .then((r) => setTaxes(r.items))
      .catch(notifyLoadFailed);
    analyticAccountsService
      .list({ pageSize: 200 })
      .then((r) => setAnalyticAccounts(r.items))
      .catch(notifyLoadFailed);
    suppliersService
      .list({ pageSize: 200 })
      .then((r) => setSuppliers(r.items))
      .catch(notifyLoadFailed);
    warehousesService
      .list({ pageSize: 200 })
      .then((r) => setWarehouses(r.items))
      .catch(notifyLoadFailed);
  }, []);

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
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsActivating(false);
    }
  };

  const confirmArchive = async () => {
    if (!product) return;
    setIsArchiving(true);
    try {
      await productsService.archive(product.id);
      toast.success(t("products.archived"));
      setArchiveOpen(false);
      router.push("/products");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsArchiving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <EmptyState icon={Package} title={t("common.noResults")} />
      </div>
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
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-caption text-muted-foreground">
              {t("products.detail.draftExcludedHint")}
            </div>
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
        value={formatMoney(product.salesPrice)}
        ltr
      />
      <DetailFieldRow
        label={t("products.fields.purchasePrice")}
        value={formatMoney(product.purchasePrice)}
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
      <RecordHighlightsHeader
        identity={
          <span className="inline-flex min-w-0 items-center gap-2">
            <span dir="ltr" className="text-ui-title font-semibold">
              {product.sku}
            </span>
            <span className="min-w-0 truncate text-body text-muted-foreground">
              {product.displayName || product.name}
            </span>
          </span>
        }
        status={
          <>
            <StatusBadge
              label={t(`products.status.${product.status}`)}
              tone={STATUS_TONE[product.status]}
            />
            <StatusBadge label={t(`products.type.${product.type}`)} tone="info" />
          </>
        }
        metrics={
          <>
            <DetailField label={t("products.fields.category")} value={product.category?.name} />
            <DetailField label={t("products.fields.unit")} value={product.unit?.name} />
            <DetailField
              label={t("products.fields.salesPrice")}
              value={formatMoney(product.salesPrice)}
            />
            <DetailField
              label={t("products.fields.purchasePrice")}
              value={formatMoney(product.purchasePrice)}
            />
          </>
        }
        primaryActions={
          isDraft && canEdit ? (
            <EnterpriseButton
              type="button"
              variant="success"
              size="sm"
              onClick={() => void handleActivate()}
              disabled={isActivating}
            >
              <CheckCircle2 className="size-3.5" />
              {t("products.detail.activate")}
            </EnterpriseButton>
          ) : null
        }
        moreActions={
          <RowActionsMenu
            label={t("common.moreActions")}
            actions={[
              {
                key: "edit",
                label: t("common.edit"),
                icon: Pencil,
                hidden: !canEdit,
                onSelect: () => openEdit(undefined),
              },
              {
                key: "archive",
                label: t("common.archive"),
                icon: Archive,
                hidden: !canArchive || !!product.deletedAt,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setArchiveOpen(true),
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
                <span className="text-caption text-muted-foreground">{timelineEntries.length}</span>
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
        onCategoryCreated={(category) => setCategories((prev) => [...prev, category])}
        initialTab={editInitialTab}
      />

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("common.confirmArchiveTitle")}
        description={`${product.displayName} — ${t("common.confirmArchiveDescription")}`}
        onConfirm={() => void confirmArchive()}
        confirmLabel={t("common.archive")}
        isConfirming={isArchiving}
      />
    </div>
  );
}

export default function ProductDetailPage() {
  return (
    <PermissionGate permission="products.view">
      <ProductDetailContent />
    </PermissionGate>
  );
}
