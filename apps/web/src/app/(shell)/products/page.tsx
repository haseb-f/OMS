"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Eye, Pencil, Copy, Archive as ArchiveIcon, RotateCcw } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
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
import { RowActionsMenu, SelectFilter } from "@/components/shared/data-table";
import { productsColumns, productsExportColumns } from "@/config/products/columns";
import { ProductGridCard } from "@/config/products/product-grid-card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { ProductSuccessDialog } from "./product-success-dialog";
import { ProductOpeningBalanceDialog } from "./product-opening-balance-dialog";
import {
  productsService,
  type ProductListParams,
  type ProductRow,
} from "@/services/products-service";
import { useWarehouses } from "@/hooks/use-reference-data";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { formatNumber } from "@/lib/format-number";
import { fetchAllPages } from "@/lib/fetch-all-pages";

/** "" = no filter; "true" / "false" filter on the flag. */
const toBooleanFilter = (value: string) => (value === "" ? undefined : value === "true");

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

  const warehouses = useWarehouses();

  // R13 facets — each one is a list API filter.
  const [itemTypeFilter, setItemTypeFilter] = usePathRestorableState("itemType", "");
  const [supplyMethodFilter, setSupplyMethodFilter] = usePathRestorableState("supplyMethod", "");
  const [sellableFilter, setSellableFilter] = usePathRestorableState("sellable", "");
  const [purchasableFilter, setPurchasableFilter] = usePathRestorableState("purchasable", "");
  const [trackedFilter, setTrackedFilter] = usePathRestorableState("tracked", "");
  const [ownershipFilter, setOwnershipFilter] = usePathRestorableState("ownership", "");

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<ProductRow | null>(null);

  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const [createdProduct, setCreatedProduct] = useState<ProductRow | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<ProductRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProductRow | null>(null);
  const [previewProduct, setPreviewProduct] = useState<ProductRow | null>(null);

  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      sortBy,
      sortOrder,
      includeArchived,
      itemType: (itemTypeFilter || undefined) as ProductListParams["itemType"],
      supplyMethod: (supplyMethodFilter || undefined) as ProductListParams["supplyMethod"],
      isSellable: toBooleanFilter(sellableFilter),
      isPurchasable: toBooleanFilter(purchasableFilter),
      isInventoryItem: toBooleanFilter(trackedFilter),
      ownership: (ownershipFilter || undefined) as ProductListParams["ownership"],
    }),
    [
      search,
      sortBy,
      sortOrder,
      includeArchived,
      itemTypeFilter,
      supplyMethodFilter,
      sellableFilter,
      purchasableFilter,
      trackedFilter,
      ownershipFilter,
    ],
  );

  const load = useCallback(() => {
    setIsLoading(true);
    productsService
      .list({ ...listFilters, page, pageSize })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((error) => reportApiError(error, "common.noResults"))
      .finally(() => setIsLoading(false));
  }, [listFilters, page, pageSize]);

  // Print: every row matching the current filters/sort, not just the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        productsService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingProduct(null);
    setDuplicateSource(null);
    setFormOpen(true);
  };
  const openEdit = (product: ProductRow) => {
    setEditingProduct(product);
    setDuplicateSource(null);
    setFormOpen(true);
  };
  const openDuplicate = (product: ProductRow) => {
    setEditingProduct(null);
    setDuplicateSource(product);
    setFormOpen(true);
  };

  const handleSaved = (product: ProductRow, mode: "create" | "edit") => {
    if (mode === "create") {
      setCreatedProduct(product);
      setSuccessDialogOpen(true);
    }
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
      reportApiError(error, "common.failedToSave");
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
      reportApiError(error, "common.failedToSave");
    }
  };

  const bulkArchiveSelected = async () => {
    const ids = Object.keys(rowSelection);
    // Success only for what the server confirmed — a swallowed rejection must
    // never turn into a green toast (usability-financial-reports §5).
    const results = await Promise.allSettled(ids.map((id) => productsService.archive(id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    setRowSelection({});
    if (failed > 0) {
      toast.error(t("masterData.actions.bulkArchivePartialFailure", { count: failed }));
    } else {
      toast.success(t("products.archived"));
    }
    load();
  };

  // One actions control for both views (table cell + Grid card): same permissions.
  const renderRowActions = (product: ProductRow) => {
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
          cell: ({ row }: { row: { original: ProductRow } }) => renderRowActions(row.original),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    // `renderRowActions` closes over the same permission flags and `t` listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canView, canEdit, canCreate, canArchive, t],
  );

  return (
    <PageWorkspace
      dense
      title={t("products.title")}
      description={t("products.description")}
      actions={
        <HeaderActions
          inline={<ModuleImportButtons importType="PRODUCTS" onImported={load} />}
          primary={{
            key: "add-new",
            label: t("products.addNew"),
            icon: Plus,
            hidden: !canCreate,
            onSelect: openCreate,
          }}
        />
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <SelectFilter
              label={t("products.facets.itemType")}
              value={itemTypeFilter}
              onChange={(value) => {
                setItemTypeFilter(value);
                setPage(1);
              }}
              options={[
                { value: "PRODUCT", label: t("products.attr.itemType.PRODUCT") },
                { value: "SERVICE", label: t("products.attr.itemType.SERVICE") },
                { value: "UNSET", label: t("products.facets.itemTypeUnset") },
              ]}
            />
            <SelectFilter
              label={t("products.attr.supplyMethod.label")}
              value={supplyMethodFilter}
              onChange={(value) => {
                setSupplyMethodFilter(value);
                setPage(1);
              }}
              allLabel={t("products.facets.allSupplyMethods")}
              options={(["PURCHASED", "ASSEMBLED", "KIT"] as const).map((value) => ({
                value,
                label: t(`products.attr.supplyMethod.${value}`),
              }))}
            />
            {(
              [
                ["sellable", "products.attr.canSell", sellableFilter, setSellableFilter],
                [
                  "purchasable",
                  "products.attr.canPurchase",
                  purchasableFilter,
                  setPurchasableFilter,
                ],
                ["tracked", "products.attr.trackStock", trackedFilter, setTrackedFilter],
              ] as const
            ).map(([key, label, value, setValue]) => (
              <SelectFilter
                key={key}
                label={t(label)}
                value={value}
                onChange={(next) => {
                  setValue(next);
                  setPage(1);
                }}
                options={[
                  { value: "true", label: t("common.yes") },
                  { value: "false", label: t("common.no") },
                ]}
              />
            ))}
            <SelectFilter
              label={t("agentPricing.ownership.label")}
              value={ownershipFilter}
              onChange={(value) => {
                setOwnershipFilter(value);
                setPage(1);
              }}
              options={[
                { value: "COMPANY", label: t("agentPricing.ownership.COMPANY") },
                { value: "AGENT", label: t("agentPricing.ownership.AGENT") },
              ]}
            />
            <EnterpriseButton
              type="button"
              variant={includeArchived ? "secondary" : "outline"}
              size="sm"
              onClick={() => setIncludeArchived((value) => !value)}
            >
              {t("common.showArchived")}
            </EnterpriseButton>
          </>
        }
        tableId="products"
        printTitle={t("products.printTitle")}
        columns={tableColumns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        fetchAllRows={fetchAllRows}
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
        selectionResetKey={listFilters}
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
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <ProductGridCard
            row={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            href={`/products/${row.id}`}
            actionsNode={renderRowActions(row)}
          />
        )}
        getRowHref={(row) => `/products/${row.id}`}
        exportColumns={exportColumnsFromKeys(productsColumns, productsExportColumns, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items as unknown as Record<string, unknown>[],
            selectedKeys,
            "products.csv",
            labels,
          )
        }
      />

      <ProductSuccessDialog
        open={successDialogOpen}
        onOpenChange={setSuccessDialogOpen}
        product={createdProduct}
        onAddAnother={() => {
          setSuccessDialogOpen(false);
          openCreate();
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

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingProduct={editingProduct}
        duplicateSource={duplicateSource}
        onSaved={handleSaved}
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
                <StatusBadge
                  tone="info"
                  label={
                    previewProduct.itemType
                      ? t(`products.attr.itemType.${previewProduct.itemType}`)
                      : t("productCommission.itemType.UNSET")
                  }
                />
                {previewProduct.itemType !== "SERVICE" && (
                  <StatusBadge
                    tone="neutral"
                    label={t(`products.attr.supplyMethod.${previewProduct.supplyMethod}`)}
                  />
                )}
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
                    {previewProduct.salesPrice ? formatNumber(previewProduct.salesPrice) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">
                    {t("products.fields.purchasePrice")}
                  </dt>
                  <dd dir="ltr">
                    {previewProduct.purchasePrice
                      ? formatNumber(previewProduct.purchasePrice)
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
