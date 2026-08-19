"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Plus, Eye, Pencil, Copy, Archive as ArchiveIcon, RotateCcw } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { StatusBadge } from "@/components/business/status-badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu } from "@/components/shared/data-table";
import { productsColumns, productsExportColumns } from "@/config/products/columns";
import { ProductModal } from "./product-modal";
import { ProductCreateDialog } from "./product-create-dialog";
import { ProductSuccessDialog } from "./product-success-dialog";
import { ProductOpeningBalanceDialog } from "./product-opening-balance-dialog";
import { productsService, type ProductRow } from "@/services/products-service";
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
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";

const categoriesService = createMasterDataService<CategoryRow>("/product-categories");
const brandsService = createMasterDataService<BrandRow>("/product-brands");
const unitsService = createMasterDataService<UnitRow>("/units");
const taxesService = createMasterDataService<TaxRow>("/taxes");
const analyticAccountsService = createMasterDataService<AnalyticAccountRow>("/analytic-accounts");
const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

function ProductsPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("products.create");
  const canView = hasPermission("products.view");
  const canEdit = hasPermission("products.edit");
  const canArchive = hasPermission("products.archive");

  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [includeArchived, setIncludeArchived] = usePathRestorableState("includeArchived", false);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState({});

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [taxes, setTaxes] = useState<TaxRow[]>([]);
  const [analyticAccounts, setAnalyticAccounts] = useState<AnalyticAccountRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<ProductRow | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const [createdProduct, setCreatedProduct] = useState<ProductRow | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<ProductRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProductRow | null>(null);
  const [previewProduct, setPreviewProduct] = useState<ProductRow | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    productsService
      .list({ search: search || undefined, page, pageSize, sortBy, sortOrder, includeArchived })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((error) =>
        toast.error(error instanceof ApiError ? error.message : t("common.noResults")),
      )
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page, pageSize, sortBy, sortOrder, includeArchived]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const notifyLoadFailed = (name: string, error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : t("common.loadListFailed", { name }));
    };
    categoriesService
      .list({ pageSize: 200 })
      .then((r) => setCategories(r.items))
      .catch((error: unknown) => {
        setCategories([]);
        notifyLoadFailed(t("products.fields.category"), error);
      });
    brandsService
      .list({ pageSize: 200 })
      .then((r) => setBrands(r.items))
      .catch(() => setBrands([]));
    unitsService
      .list({ pageSize: 200 })
      .then((r) => setUnits(r.items))
      .catch(() => setUnits([]));
    taxesService
      .list({ pageSize: 200 })
      .then((r) => setTaxes(r.items))
      .catch(() => setTaxes([]));
    analyticAccountsService
      .list({ pageSize: 200 })
      .then((r) => setAnalyticAccounts(r.items))
      .catch(() => setAnalyticAccounts([]));
    suppliersService
      .list({ pageSize: 200 })
      .then((r) => setSuppliers(r.items))
      .catch(() => setSuppliers([]));
    warehousesService
      .list({ pageSize: 200 })
      .then((r) => setWarehouses(r.items))
      .catch(() => setWarehouses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => setCreateDialogOpen(true);
  const openEdit = (product: ProductRow) => {
    setEditingProduct(product);
    setDuplicateSource(null);
    setModalOpen(true);
  };
  const openDuplicate = (product: ProductRow) => {
    setEditingProduct(null);
    setDuplicateSource(product);
    setModalOpen(true);
  };

  const handleCreated = (product: ProductRow) => {
    setCreatedProduct(product);
    setSuccessDialogOpen(true);
    load();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await productsService.archive(archiveTarget.id);
      toast.success(t("products.archived"));
      setArchiveTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    try {
      await productsService.restore(restoreTarget.id);
      toast.success(t("products.restored"));
      setRestoreTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  const bulkArchiveSelected = async () => {
    const ids = Object.keys(rowSelection);
    await Promise.all(ids.map((id) => productsService.archive(id).catch(() => undefined)));
    setRowSelection({});
    toast.success(t("products.archived"));
    load();
  };

  const tableColumns = useMemo(
    () =>
      [
        ...productsColumns,
        {
          id: "__actions",
          meta: { titleKey: "common.actions" as const },
          enableHiding: false,
          enableSorting: false,
          cell: ({ row }: { row: { original: ProductRow } }) => {
            const product = row.original;
            const isArchived = !!product.deletedAt;
            return (
              <RowActionsMenu
                label={t("common.actions")}
                actions={[
                  {
                    key: "preview",
                    label: t("common.view"),
                    icon: Eye,
                    hidden: !canView,
                    onSelect: () => setPreviewProduct(product),
                  },
                  {
                    key: "edit",
                    label: t("common.edit"),
                    icon: Pencil,
                    hidden: !canEdit || isArchived,
                    onSelect: () => openEdit(product),
                  },
                  {
                    key: "duplicate",
                    label: t("products.actions.duplicate"),
                    icon: Copy,
                    hidden: !canCreate || isArchived,
                    onSelect: () => openDuplicate(product),
                  },
                  {
                    key: "archive",
                    label: t("common.archive"),
                    icon: ArchiveIcon,
                    hidden: !canArchive || isArchived,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => setArchiveTarget(product),
                  },
                  {
                    key: "restore",
                    label: t("common.restore"),
                    icon: RotateCcw,
                    hidden: !canArchive || !isArchived,
                    separatorBefore: true,
                    onSelect: () => setRestoreTarget(product),
                  },
                ]}
              />
            );
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    [canView, canEdit, canCreate, canArchive, t],
  );

  return (
    <PageWorkspace
      title={t("products.title")}
      description={t("products.description")}
      actions={
        <>
          <ModuleImportButtons importType="PRODUCTS" onImported={load} />
          {canCreate && (
            <EnterpriseButton type="button" onClick={openCreate}>
              <Plus />
              {t("products.addNew")}
            </EnterpriseButton>
          )}
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <EnterpriseButton
            type="button"
            variant={includeArchived ? "secondary" : "outline"}
            size="sm"
            onClick={() => setIncludeArchived((value) => !value)}
          >
            {t("common.showArchived")}
          </EnterpriseButton>
        }

        tableId="products"
        printTitle={t("products.printTitle")}
        columns={tableColumns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(nextSortBy, nextSortOrder) => {
          setSortBy(nextSortBy);
          setSortOrder(nextSortOrder);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        isLoading={isLoading}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        bulkActions={
          canArchive && (
            <EnterpriseButton
              type="button"
              variant="destructive"
              size="sm"
              onClick={bulkArchiveSelected}
            >
              {t("common.archive")}
            </EnterpriseButton>
          )
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(productsColumns, productsExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items as unknown as Record<string, unknown>[],
            selectedKeys,
            "products.csv",
          )
        }
      />

      <ProductCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        icon={Package}
        categories={categories}
        units={units}
        onCreated={handleCreated}
      />

      <ProductSuccessDialog
        open={successDialogOpen}
        onOpenChange={setSuccessDialogOpen}
        product={createdProduct}
        onAddAnother={() => {
          setSuccessDialogOpen(false);
          setCreateDialogOpen(true);
        }}
        onOpenProduct={() => {
          setSuccessDialogOpen(false);
          if (createdProduct) openEdit(createdProduct);
        }}
        onReturnToList={() => setSuccessDialogOpen(false)}
        onCreateOpeningBalance={() => {
          setSuccessDialogOpen(false);
          setOpeningBalanceOpen(true);
        }}
      />

      <ProductOpeningBalanceDialog
        open={openingBalanceOpen}
        onOpenChange={setOpeningBalanceOpen}
        product={createdProduct}
        warehouses={warehouses}
      />

      <ProductModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        icon={Package}
        editingProduct={editingProduct}
        duplicateSource={duplicateSource}
        categories={categories}
        brands={brands}
        units={units}
        taxes={taxes}
        analyticAccounts={analyticAccounts}
        suppliers={suppliers}
        warehouses={warehouses}
        onSaved={load}
        onCategoryCreated={(category) => setCategories((prev) => [...prev, category])}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("common.confirmArchiveTitle")}
        description={
          archiveTarget && `${archiveTarget.displayName} — ${t("common.confirmArchiveDescription")}`
        }
        onConfirm={confirmArchive}
        confirmLabel={t("common.archive")}
      />

      <ConfirmationDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={t("common.confirmRestoreTitle")}
        description={
          restoreTarget && `${restoreTarget.displayName} — ${t("common.confirmRestoreDescription")}`
        }
        onConfirm={confirmRestore}
        confirmLabel={t("common.restore")}
      />

      <Sheet open={!!previewProduct} onOpenChange={(open) => !open && setPreviewProduct(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{previewProduct?.displayName}</SheetTitle>
            <SheetDescription dir="ltr">{previewProduct?.sku}</SheetDescription>
          </SheetHeader>
          {previewProduct && (
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
              <div className="flex items-center gap-2">
                <StatusBadge tone="info" label={t(`products.type.${previewProduct.type}`)} />
                <StatusBadge
                  tone={previewProduct.deletedAt ? "neutral" : "success"}
                  label={t(previewProduct.deletedAt ? "common.archived" : "common.active")}
                />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.category")}
                  </dt>
                  <dd>{previewProduct.category?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.brand")}
                  </dt>
                  <dd>{previewProduct.brand?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.salesPrice")}
                  </dt>
                  <dd dir="ltr">
                    {previewProduct.salesPrice
                      ? Number(previewProduct.salesPrice).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.purchasePrice")}
                  </dt>
                  <dd dir="ltr">
                    {previewProduct.purchasePrice
                      ? Number(previewProduct.purchasePrice).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.barcode")}
                  </dt>
                  <dd dir="ltr">{previewProduct.barcode ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.trackInventory")}
                  </dt>
                  <dd>{previewProduct.isInventoryItem ? t("common.active") : "—"}</dd>
                </div>
              </dl>
              {previewProduct.description && (
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.description")}
                  </dt>
                  <dd className="text-sm">{previewProduct.description}</dd>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-sm">
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.createdAt")}
                  </dt>
                  <dd dir="ltr">{formatDateTime(previewProduct.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.updatedAt")}
                  </dt>
                  <dd dir="ltr">{formatDateTime(previewProduct.updatedAt)}</dd>
                </div>
              </dl>
              {canEdit && !previewProduct.deletedAt && (
                <EnterpriseButton
                  type="button"
                  onClick={() => {
                    openEdit(previewProduct);
                    setPreviewProduct(null);
                  }}
                >
                  {t("common.edit")}
                </EnterpriseButton>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageWorkspace>
  );
}

export default function ProductsPage() {
  return (
    <PermissionGate permission="products.view">
      <ProductsPageContent />
    </PermissionGate>
  );
}
