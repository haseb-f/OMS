"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { Plus, Trash2 } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection, ModalFieldFullWidth } from "@/components/shared/modal-section";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { CategoryQuickCreateDialog } from "@/components/business/category-quick-create-dialog";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  productsService,
  type ProductRow,
  type ProductType,
  type ProductVariantRow,
  type ProductAttachmentRow,
  type ProductComponentRow,
} from "@/services/products-service";
import {
  inventoryService,
  type StockCard,
  type InventoryMovementRow,
} from "@/services/inventory-service";
import type { SupplierRow } from "@/services/suppliers-service";
import type {
  CategoryRow,
  BrandRow,
  UnitRow,
  TaxRow,
  AnalyticAccountRow,
  WarehouseRow,
} from "@/config/master-data/entities";
import {
  productSchema,
  productDefaultValues,
  type ProductFormValues,
} from "@/config/products/schema";
import { ProductOpeningBalanceDialog } from "./product-opening-balance-dialog";
import { formatDate, formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/**
 * TASK-028 (Inventory Foundation & Cost Engine pass) — "The selected
 * Business Behavior must dynamically control which tabs appear." One lookup
 * table, not scattered conditionals. General now absorbs the old
 * Classification tab (type/category/unit/tax/brand/cost-center are core
 * identity, not a separate step); Cost and Stock Movements are new,
 * read-mostly tabs backed by the Cost Engine / Inventory ledger; BOM
 * (renamed from Kit) only applies to MANUFACTURED. Variants is kept for
 * every sellable/purchasable type — not part of this task's tab list, but
 * pre-existing functionality this task never asked to remove.
 */
const TAB_VISIBILITY: Record<ProductType, readonly string[]> = {
  PURCHASE_ONLY: [
    "general",
    "purchasing",
    "inventory",
    "cost",
    "stockMovements",
    "variants",
    "attachments",
  ],
  SALES_ONLY: [
    "general",
    "sales",
    "inventory",
    "cost",
    "stockMovements",
    "variants",
    "attachments",
  ],
  PURCHASE_AND_SALE: [
    "general",
    "sales",
    "purchasing",
    "inventory",
    "cost",
    "stockMovements",
    "variants",
    "attachments",
  ],
  MANUFACTURED: [
    "general",
    "sales",
    "purchasing",
    "inventory",
    "cost",
    "stockMovements",
    "bom",
    "variants",
    "attachments",
  ],
  SERVICE: ["general", "sales", "attachments"],
  EXPENSE_ITEM: ["general", "purchasing", "attachments"],
};

function toFormValues(source: ProductRow | null): ProductFormValues {
  if (!source) return productDefaultValues;
  return {
    name: source.name,
    nameEn: source.nameEn ?? "",
    internalName: source.internalName,
    displayName: source.displayName,
    barcode: source.barcode ?? "",
    qrCodeValue: source.qrCodeValue ?? "",
    imageUrl: source.imageUrl ?? "",
    description: source.description ?? "",
    shortDescription: source.shortDescription ?? "",
    longDescription: source.longDescription ?? "",
    internalNotes: source.internalNotes ?? "",
    tagsInput: (source.tags ?? []).join(", "),
    type: source.type,
    status: source.status,
    categoryId: source.categoryId,
    brandId: source.brandId ?? "",
    unitId: source.unitId,
    taxId: source.taxId ?? "",
    analyticAccountId: source.analyticAccountId ?? "",
    salesPrice: source.salesPrice ? Number(source.salesPrice) : undefined,
    salesTaxIncluded: source.salesTaxIncluded,
    salesDescription: source.salesDescription ?? "",
    allowDiscount: source.allowDiscount,
    isSellable: source.isSellable,
    purchasePrice: source.purchasePrice ? Number(source.purchasePrice) : undefined,
    preferredSupplierId: source.preferredSupplierId ?? "",
    purchaseDescription: source.purchaseDescription ?? "",
    isPurchasable: source.isPurchasable,
    isInventoryItem: source.isInventoryItem,
    reorderLevel: source.reorderLevel ? Number(source.reorderLevel) : undefined,
    reorderQuantity: source.reorderQuantity ? Number(source.reorderQuantity) : undefined,
    safetyStock: source.safetyStock ? Number(source.safetyStock) : undefined,
    minQuantity: source.minQuantity ? Number(source.minQuantity) : undefined,
    maxQuantity: source.maxQuantity ? Number(source.maxQuantity) : undefined,
    storageLocation: source.storageLocation ?? "",
    preferredWarehouseId: source.preferredWarehouseId ?? "",
    costingMethod: source.costingMethod ?? "",
    inventoryTracking: source.serialNumberTracking
      ? "SERIAL"
      : source.batchTracking
        ? "BATCH"
        : "NONE",
    weight: source.weight ? Number(source.weight) : undefined,
    width: source.width ? Number(source.width) : undefined,
    height: source.height ? Number(source.height) : undefined,
    length: source.length ? Number(source.length) : undefined,
  };
}

function toPayload(values: ProductFormValues) {
  const tags = values.tagsInput
    ? values.tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const { tagsInput: _tagsInput, inventoryTracking, ...rest } = values;
  void _tagsInput;
  return {
    ...rest,
    tags,
    brandId: values.brandId || undefined,
    taxId: values.taxId || undefined,
    analyticAccountId: values.analyticAccountId || undefined,
    preferredSupplierId: values.preferredSupplierId || undefined,
    preferredWarehouseId: values.preferredWarehouseId || undefined,
    costingMethod: values.costingMethod || undefined,
    // The form's single select converts back to the two API booleans
    // (ADR-0012) — `inventoryTracking` itself is never sent.
    serialNumberTracking: inventoryTracking === "SERIAL",
    batchTracking: inventoryTracking === "BATCH",
  };
}

export function ProductModal({
  open,
  onOpenChange,
  icon,
  editingProduct,
  duplicateSource,
  categories,
  brands,
  units,
  taxes,
  analyticAccounts,
  suppliers,
  warehouses,
  onSaved,
  onCategoryCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
  editingProduct: ProductRow | null;
  duplicateSource: ProductRow | null;
  categories: CategoryRow[];
  brands: BrandRow[];
  units: UnitRow[];
  taxes: TaxRow[];
  analyticAccounts: AnalyticAccountRow[];
  suppliers: SupplierRow[];
  warehouses: WarehouseRow[];
  onSaved: () => void;
  /** Appends the newly created category to the page's `categories` list — this modal never owns that state itself. */
  onCategoryCreated?: (category: CategoryRow) => void;
}) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState("general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedProduct, setSavedProduct] = useState<ProductRow | null>(editingProduct);
  const [originalType, setOriginalType] = useState<ProductType | null>(
    editingProduct?.type ?? null,
  );
  const [pendingType, setPendingType] = useState<ProductType | null>(null);
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const [categoryQuickCreateOpen, setCategoryQuickCreateOpen] = useState(false);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: productDefaultValues,
  });

  useEffect(() => {
    if (!open) return;
    setActiveTab("general");
    setSavedProduct(editingProduct);
    setOriginalType(editingProduct?.type ?? null);
    form.reset(toFormValues(editingProduct ?? duplicateSource));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingProduct, duplicateSource]);

  const isDirty = form.formState.isDirty;
  const isEditing = !!editingProduct;

  const watchedType = form.watch("type");
  const visibleTabs = TAB_VISIBILITY[watchedType] ?? TAB_VISIBILITY.PURCHASE_AND_SALE;

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) setActiveTab("general");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedType]);

  /**
   * TASK-028 — changing the Operation Type on an EXISTING product can hide
   * whole tabs (data is kept, just no longer shown), so it goes through the
   * warning dialog first rather than applying instantly. A brand-new
   * product (no `originalType` yet) has nothing to lose, so it applies
   * immediately — no dialog for every type pick while first creating one.
   */
  const handleTypeChange = (nextType: string) => {
    if (isEditing && originalType && nextType !== originalType) {
      setPendingType(nextType as ProductType);
      return;
    }
    form.setValue("type", nextType as ProductType, { shouldDirty: true });
  };

  const confirmTypeChange = () => {
    if (pendingType) form.setValue("type", pendingType, { shouldDirty: true });
    setPendingType(null);
  };

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const payload = toPayload(values);
      const saved = isEditing
        ? await productsService.update(editingProduct!.id, payload)
        : await productsService.create(payload);
      toast.success(t("products.saved"));
      setSavedProduct(saved);
      onSaved();
      if (!isEditing) {
        // Stay open so Variants/Attachments become usable against the new product.
        form.reset(toFormValues(saved));
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSubmitting(false);
    }
  });

  const modalTitle = isEditing
    ? t("products.editTitle")
    : duplicateSource
      ? t("products.duplicateTitle")
      : t("products.addTitle");

  return (
    <>
      <EnterpriseModal
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        icon={icon}
        title={modalTitle}
        description={t("products.description")}
        isDirty={isDirty}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={() => submit()} disabled={isSubmitting}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <Form {...form}>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList variant="line" className="mb-4 flex-wrap">
              <TabsTrigger value="general">{t("products.tabs.general")}</TabsTrigger>
              {visibleTabs.includes("sales") && (
                <TabsTrigger value="sales">{t("products.tabs.sales")}</TabsTrigger>
              )}
              {visibleTabs.includes("purchasing") && (
                <TabsTrigger value="purchasing">{t("products.tabs.purchasing")}</TabsTrigger>
              )}
              {visibleTabs.includes("inventory") && (
                <TabsTrigger value="inventory" disabled={!savedProduct}>
                  {t("products.tabs.inventory")}
                </TabsTrigger>
              )}
              {visibleTabs.includes("cost") && (
                <TabsTrigger value="cost" disabled={!savedProduct}>
                  {t("products.tabs.cost")}
                </TabsTrigger>
              )}
              {visibleTabs.includes("stockMovements") && (
                <TabsTrigger value="stockMovements" disabled={!savedProduct}>
                  {t("products.tabs.stockMovements")}
                </TabsTrigger>
              )}
              {visibleTabs.includes("bom") && (
                <TabsTrigger value="bom" disabled={!savedProduct}>
                  {t("products.tabs.bom")}
                </TabsTrigger>
              )}
              {visibleTabs.includes("variants") && (
                <TabsTrigger value="variants" disabled={!savedProduct}>
                  {t("products.tabs.variants")}
                </TabsTrigger>
              )}
              <TabsTrigger value="attachments" disabled={!savedProduct}>
                {t("products.tabs.attachments")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="flex flex-col gap-3">
              {savedProduct && (
                <div className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-caption text-muted-foreground">
                  <span>
                    {t("products.fields.sku")}:{" "}
                    <code dir="ltr" className="font-mono text-foreground">
                      {savedProduct.sku}
                    </code>
                  </span>
                  <span>
                    {t("products.fields.createdAt")}:{" "}
                    <span dir="ltr">{formatDate(savedProduct.createdAt)}</span>
                  </span>
                  <span>
                    {t("products.fields.updatedAt")}:{" "}
                    <span dir="ltr">{formatDate(savedProduct.updatedAt)}</span>
                  </span>
                </div>
              )}
              {!savedProduct && (
                <p className="text-caption text-muted-foreground">{t("products.fields.skuHint")}</p>
              )}

              <ModalSection title={t("products.tabs.general")} columns={3}>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("products.fields.name")} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nameEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.nameEn")}</FormLabel>
                      <FormControl>
                        <Input {...field} dir="ltr" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="internalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("products.fields.internalName")}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("products.fields.displayName")}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="barcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.barcode")}</FormLabel>
                      <FormControl>
                        <Input {...field} dir="ltr" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="qrCodeValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.qrCodeValue")}</FormLabel>
                      <FormControl>
                        <Input {...field} dir="ltr" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="imageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.imageUrl")}</FormLabel>
                      <FormControl>
                        <Input {...field} dir="ltr" placeholder="https://…" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.watch("imageUrl") && (
                  <div className="flex items-end">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.watch("imageUrl")}
                      alt=""
                      className="h-16 w-16 rounded-lg border border-border object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
                <ModalFieldFullWidth>
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.fields.description")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </ModalFieldFullWidth>
                <ModalFieldFullWidth>
                  <FormField
                    control={form.control}
                    name="internalNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.fields.internalNotes")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </ModalFieldFullWidth>
              </ModalSection>

              <ModalSection title={t("products.tabs.classification")} columns={3}>
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("products.fields.type")} <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={handleTypeChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="PURCHASE_ONLY">
                            {t("products.type.PURCHASE_ONLY")}
                          </SelectItem>
                          <SelectItem value="SALES_ONLY">
                            {t("products.type.SALES_ONLY")}
                          </SelectItem>
                          <SelectItem value="PURCHASE_AND_SALE">
                            {t("products.type.PURCHASE_AND_SALE")}
                          </SelectItem>
                          <SelectItem value="MANUFACTURED">
                            {t("products.type.MANUFACTURED")}
                          </SelectItem>
                          <SelectItem value="SERVICE">{t("products.type.SERVICE")}</SelectItem>
                          <SelectItem value="EXPENSE_ITEM">
                            {t("products.type.EXPENSE_ITEM")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-caption text-muted-foreground">
                        {t(`products.typeHint.${field.value}`)}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.status")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="DRAFT">{t("products.status.DRAFT")}</SelectItem>
                          <SelectItem value="ACTIVE">{t("products.status.ACTIVE")}</SelectItem>
                          <SelectItem value="INACTIVE">{t("products.status.INACTIVE")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("products.fields.category")} <span className="text-destructive">*</span>
                      </FormLabel>
                      <div className="flex items-center gap-1.5">
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categories.length ? (
                              categories.map((category) => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))
                            ) : (
                              <div className="px-2 py-3 text-center text-caption text-muted-foreground">
                                {t("common.noDataAvailable")}
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                        <EnterpriseButton
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={t("products.addCategory")}
                          title={t("products.addCategory")}
                          onClick={() => setCategoryQuickCreateOpen(true)}
                        >
                          <Plus className="size-4" />
                        </EnterpriseButton>
                      </div>
                      {categories.length === 0 && (
                        <p className="text-caption text-muted-foreground">
                          {t("products.noCategoryYet")}
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="brandId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.brand")}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {brands.map((brand) => (
                            <SelectItem key={brand.id} value={brand.id}>
                              {brand.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unitId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("products.fields.unit")} <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="taxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.taxGroup")}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {taxes.map((tax) => (
                            <SelectItem key={tax.id} value={tax.id}>
                              {tax.name} ({tax.rate}%)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="analyticAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.costCenter")}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {analyticAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ModalFieldFullWidth>
                  <FormField
                    control={form.control}
                    name="tagsInput"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.fields.tags")}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="VIP, Seasonal, New" />
                        </FormControl>
                        <p className="text-caption text-muted-foreground">
                          {t("products.fields.tagsHint")}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </ModalFieldFullWidth>
              </ModalSection>
            </TabsContent>

            <TabsContent value="sales" className="flex flex-col gap-3">
              <ModalSection title={t("products.tabs.sales")} columns={2}>
                <FormField
                  control={form.control}
                  name="salesPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.salesPrice")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          step="0.01"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ModalFieldFullWidth>
                  <FormField
                    control={form.control}
                    name="salesDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.fields.salesDescription")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </ModalFieldFullWidth>
                <label className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="isSellable"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    )}
                  />
                  <span className="text-body">{t("products.fields.availableForSale")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="salesTaxIncluded"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    )}
                  />
                  <span className="text-body">{t("products.fields.salesTaxIncluded")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="allowDiscount"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    )}
                  />
                  <span className="text-body">{t("products.fields.allowDiscount")}</span>
                </label>
              </ModalSection>
            </TabsContent>

            <TabsContent value="purchasing" className="flex flex-col gap-3">
              <ModalSection title={t("products.tabs.purchasing")} columns={2}>
                <FormField
                  control={form.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.purchasePrice")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          step="0.01"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="preferredSupplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.preferredSupplier")}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("products.noSupplier")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ModalFieldFullWidth>
                  <FormField
                    control={form.control}
                    name="purchaseDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("products.fields.purchaseDescription")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </ModalFieldFullWidth>
                <label className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="isPurchasable"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    )}
                  />
                  <span className="text-body">{t("products.fields.availableForPurchase")}</span>
                </label>
              </ModalSection>
            </TabsContent>

            <TabsContent value="inventory" className="flex flex-col gap-3">
              {savedProduct && (
                <InventoryStockSummary
                  product={savedProduct}
                  onOpeningBalance={() => setOpeningBalanceOpen(true)}
                />
              )}
              <ModalSection title={t("products.tabs.inventory")} columns={3}>
                <label className="col-span-full flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name="isInventoryItem"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    )}
                  />
                  <span className="text-body">{t("products.fields.trackInventory")}</span>
                </label>
                <FormField
                  control={form.control}
                  name="reorderLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.reorderLevel")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reorderQuantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.reorderQuantity")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="safetyStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.safetyStock")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minQuantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.minQuantity")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxQuantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.maxQuantity")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="storageLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.storageLocation")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="inventoryTracking"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.inventoryTracking")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="NONE">
                            {t("products.inventoryTracking.NONE")}
                          </SelectItem>
                          <SelectItem value="BATCH">
                            {t("products.inventoryTracking.BATCH")}
                          </SelectItem>
                          <SelectItem value="SERIAL">
                            {t("products.inventoryTracking.SERIAL")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="preferredWarehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.preferredWarehouse")}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses.map((warehouse) => (
                            <SelectItem key={warehouse.id} value={warehouse.id}>
                              {warehouse.code} — {warehouse.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.weight")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="width"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.width")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="height"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.height")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="length"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.length")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          dir="ltr"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ModalFieldFullWidth>
                  <p className="text-caption text-muted-foreground">
                    {t("products.fields.dimensionsHint")}
                  </p>
                </ModalFieldFullWidth>
              </ModalSection>
            </TabsContent>

            <TabsContent value="cost" className="flex flex-col gap-3">
              <ModalSection title={t("products.tabs.cost")} columns={3}>
                <FormField
                  control={form.control}
                  name="costingMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.costingMethod")}</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="AVERAGE">
                            {t("products.costingMethod.AVERAGE")}
                          </SelectItem>
                          <SelectItem value="FIFO">{t("products.costingMethod.FIFO")}</SelectItem>
                          <SelectItem value="STANDARD">
                            {t("products.costingMethod.STANDARD")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-caption text-muted-foreground">
                        {t("products.cost.methodHint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormItem>
                  <FormLabel>{t("products.cost.currentCost")}</FormLabel>
                  <div
                    className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm"
                    dir="ltr"
                  >
                    {savedProduct?.currentCost
                      ? Number(savedProduct.currentCost).toLocaleString()
                      : "—"}
                  </div>
                </FormItem>
                <FormItem>
                  <FormLabel>{t("products.cost.lastCostUpdate")}</FormLabel>
                  <div
                    dir="ltr"
                    className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm"
                  >
                    {savedProduct?.lastCostUpdate
                      ? formatDateTime(savedProduct.lastCostUpdate)
                      : "—"}
                  </div>
                </FormItem>
                <ModalFieldFullWidth>
                  <p className="text-caption text-muted-foreground">
                    {t("products.cost.architectureHint")}
                  </p>
                </ModalFieldFullWidth>
              </ModalSection>
            </TabsContent>

            <TabsContent value="stockMovements">
              {savedProduct && <StockMovementsPanel productId={savedProduct.id} />}
            </TabsContent>

            <TabsContent value="bom">
              {savedProduct && <KitComponentsPanel kitProductId={savedProduct.id} />}
            </TabsContent>

            <TabsContent value="variants">
              {savedProduct && <VariantsPanel productId={savedProduct.id} />}
            </TabsContent>

            <TabsContent value="attachments">
              {savedProduct && <AttachmentsPanel productId={savedProduct.id} />}
            </TabsContent>
          </Tabs>
        </Form>
      </EnterpriseModal>

      <ConfirmationDialog
        open={!!pendingType}
        onOpenChange={(nextOpen) => !nextOpen && setPendingType(null)}
        tone="warning"
        title={t("products.typeChangeWarningTitle")}
        description={t("products.typeChangeWarningDescription")}
        onConfirm={confirmTypeChange}
        confirmLabel={t("common.confirm")}
      />

      <ProductOpeningBalanceDialog
        open={openingBalanceOpen}
        onOpenChange={setOpeningBalanceOpen}
        product={savedProduct}
        warehouses={warehouses}
      />

      <CategoryQuickCreateDialog
        open={categoryQuickCreateOpen}
        onOpenChange={setCategoryQuickCreateOpen}
        onCreated={(category) => {
          onCategoryCreated?.(category);
          form.setValue("categoryId", category.id, { shouldDirty: true, shouldValidate: true });
        }}
      />
    </>
  );
}

/**
 * TASK-028 (Inventory Foundation & Cost Engine pass) — live read of the
 * movement-derived stock position (ADR-0013: on-hand/reserved/available are
 * never stored, always summed from `InventoryMovement`), plus a shortcut
 * into the existing Opening Balance business operation. Incoming/Outgoing
 * have no real data source yet — Purchasing/Sales don't create inventory
 * movements — so they render as an honest "—" placeholder rather than a
 * fabricated number.
 */
function InventoryStockSummary({
  product,
  onOpeningBalance,
}: {
  product: ProductRow;
  onOpeningBalance: () => void;
}) {
  const { t } = useLocale();
  const [stockCard, setStockCard] = useState<StockCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    inventoryService
      .getStockCard(product.id)
      .then(setStockCard)
      .catch(() => setStockCard(null))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const inStock = (stockCard?.onHand ?? 0) > 0;

  return (
    <ModalSection title={t("products.inventory.stockSummary")} columns={3}>
      <FormItem>
        <FormLabel>{t("inventory.fields.onHand")}</FormLabel>
        <div
          dir="ltr"
          className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm"
        >
          {isLoading ? "…" : (stockCard?.onHand ?? 0).toLocaleString()}
        </div>
      </FormItem>
      <FormItem>
        <FormLabel>{t("inventory.fields.reserved")}</FormLabel>
        <div
          dir="ltr"
          className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm"
        >
          {isLoading ? "…" : (stockCard?.reserved ?? 0).toLocaleString()}
        </div>
      </FormItem>
      <FormItem>
        <FormLabel>{t("inventory.fields.available")}</FormLabel>
        <div
          dir="ltr"
          className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm"
        >
          {isLoading ? "…" : (stockCard?.available ?? 0).toLocaleString()}
        </div>
      </FormItem>
      <FormItem>
        <FormLabel>{t("products.inventory.incoming")}</FormLabel>
        <div className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
          —
        </div>
      </FormItem>
      <FormItem>
        <FormLabel>{t("products.inventory.outgoing")}</FormLabel>
        <div className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
          —
        </div>
      </FormItem>
      <FormItem>
        <FormLabel>{t("products.openingBalance.warehouse")}</FormLabel>
        <div className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
          {product.preferredWarehouse?.name ?? "—"}
        </div>
      </FormItem>
      <FormItem>
        <FormLabel>{t("products.inventory.status")}</FormLabel>
        <div className="flex h-11 items-center">
          {isLoading ? (
            <span className="text-sm text-muted-foreground">…</span>
          ) : (
            <StatusBadge
              tone={inStock ? "success" : "neutral"}
              label={t(inStock ? "products.inventory.inStock" : "products.inventory.outOfStock")}
            />
          )}
        </div>
      </FormItem>
      <ModalFieldFullWidth>
        <EnterpriseButton type="button" variant="outline" size="sm" onClick={onOpeningBalance}>
          <Plus className="size-3.5" />
          {t("products.openingBalance.title")}
        </EnterpriseButton>
      </ModalFieldFullWidth>
    </ModalSection>
  );
}

/**
 * TASK-028 — read-only audit trail of this product's own movements, reusing
 * the same `GET /inventory/movements?productId=` business-operation client
 * the system-wide Inventory Ledger page uses. Every row already carries
 * Reference/Type/Warehouse/Qty/Before/After/Cost/User/Date from the ledger
 * (ADR-0013) — nothing here is computed or fabricated.
 */
function StockMovementsPanel({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    inventoryService
      .getMovements({ productId })
      .then(setMovements)
      .catch(() => setMovements([]))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const columns: ColumnDef<InventoryMovementRow, unknown>[] = [
    {
      id: "referenceType",
      meta: { titleKey: "products.stockMovements.reference" },
      accessorFn: (row) => row.referenceType || row.movementNumber,
      cell: ({ row }) =>
        row.original.referenceType ? (
          <span dir="ltr" className="text-xs">
            {row.original.referenceType}
            {row.original.referenceId ? ` #${row.original.referenceId.slice(0, 8)}` : ""}
          </span>
        ) : (
          <code dir="ltr" className="text-xs">
            {row.original.movementNumber}
          </code>
        ),
    },
    {
      id: "type",
      meta: { titleKey: "inventory.fields.type" },
      accessorFn: (row) => t(`inventory.movementType.${row.type}` as MessageKey),
    },
    {
      id: "warehouse",
      meta: { titleKey: "products.openingBalance.warehouse" },
      accessorFn: (row) => row.warehouse?.name ?? "",
    },
    {
      id: "quantity",
      meta: { titleKey: "inventory.fields.quantity" },
      accessorFn: (row) => row.quantity,
      cell: ({ row }) => <span dir="ltr">{row.original.quantity}</span>,
    },
    {
      id: "quantityBefore",
      meta: { titleKey: "products.stockMovements.before" },
      accessorFn: (row) => row.quantityBefore,
      cell: ({ row }) => <span dir="ltr">{row.original.quantityBefore}</span>,
    },
    {
      id: "quantityAfter",
      meta: { titleKey: "inventory.fields.balanceAfter" },
      accessorFn: (row) => row.quantityAfter,
      cell: ({ row }) => <span dir="ltr">{row.original.quantityAfter}</span>,
    },
    {
      id: "unitCost",
      meta: { titleKey: "products.stockMovements.cost" },
      accessorFn: (row) => row.unitCost ?? "",
      cell: ({ row }) =>
        row.original.unitCost != null ? (
          <span dir="ltr">{Number(row.original.unitCost).toLocaleString()}</span>
        ) : (
          "—"
        ),
    },
    {
      id: "createdByUser",
      meta: { titleKey: "products.fields.createdBy" },
      accessorFn: (row) => row.createdByUser?.fullName ?? "",
      cell: ({ row }) => row.original.createdByUser?.fullName ?? "—",
    },
    {
      id: "createdAt",
      meta: { titleKey: "inventory.fields.date" },
      accessorFn: (row) => formatDateTime(row.createdAt),
      cell: ({ row }) => <span dir="ltr">{formatDateTime(row.original.createdAt)}</span>,
    },
  ];

  return (
    <EnterpriseDataTable
      tableId="product-stock-movements"
      printTitle={t("products.stockMovements.reference")}
      columns={columns}
      data={movements}
      isLoading={isLoading}
      emptyTitle={t("products.stockMovements.empty")}
    />
  );
}

function VariantsPanel({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [variants, setVariants] = useState<ProductVariantRow[]>([]);
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [weight, setWeight] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = () => {
    productsService.variants
      .list(productId)
      .then(setVariants)
      .catch(() => setVariants([]));
  };

  useEffect(load, [productId]);

  const addVariant = async () => {
    const attributes: Record<string, string> = {};
    if (color) attributes.color = color;
    if (size) attributes.size = size;
    if (weight) attributes.weight = weight;
    if (Object.keys(attributes).length === 0) return;

    setIsSaving(true);
    try {
      await productsService.variants.create(productId, { attributes });
      toast.success(t("products.variantSaved"));
      setColor("");
      setSize("");
      setWeight("");
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSaving(false);
    }
  };

  const removeVariant = async (id: string) => {
    try {
      await productsService.variants.remove(productId, id);
      toast.success(t("products.variantRemoved"));
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  return (
    <ModalSection title={t("products.tabs.variants")} columns={3}>
      <div>
        <label className="text-body font-medium">{t("products.fields.color")}</label>
        <Input value={color} onChange={(e) => setColor(e.target.value)} className="mt-2" />
      </div>
      <div>
        <label className="text-body font-medium">{t("products.fields.size")}</label>
        <Input value={size} onChange={(e) => setSize(e.target.value)} className="mt-2" />
      </div>
      <div>
        <label className="text-body font-medium">{t("products.fields.variantWeight")}</label>
        <Input value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-2" />
      </div>
      <ModalFieldFullWidth>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={addVariant}
          disabled={isSaving}
        >
          <Plus className="size-3.5" />
          {t("products.actions.addVariant")}
        </EnterpriseButton>
      </ModalFieldFullWidth>
      <ModalFieldFullWidth>
        {variants.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("products.variantsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {variants.map((variant) => (
              <div
                key={variant.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {variant.sku}
                  </code>
                  {Object.entries(variant.attributes).map(([key, value]) => (
                    <EnterpriseBadge key={key} variant="outline">
                      {key}: {value}
                    </EnterpriseBadge>
                  ))}
                </div>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeVariant(variant.id)}
                  aria-label={t("products.actions.deleteVariant")}
                >
                  <Trash2 className="size-3.5" />
                </EnterpriseButton>
              </div>
            ))}
          </div>
        )}
      </ModalFieldFullWidth>
    </ModalSection>
  );
}

function KitComponentsPanel({ kitProductId }: { kitProductId: string }) {
  const { t } = useLocale();
  const [components, setComponents] = useState<ProductComponentRow[]>([]);
  const [candidateProducts, setCandidateProducts] = useState<ProductRow[]>([]);
  const [componentProductId, setComponentProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = () => {
    productsService.components
      .list(kitProductId)
      .then(setComponents)
      .catch(() => setComponents([]));
  };

  useEffect(load, [kitProductId]);

  // A Kit's own BOM can't include itself — everything else is a candidate.
  useEffect(() => {
    productsService
      .list({ pageSize: 200, includeArchived: false })
      .then((result) => setCandidateProducts(result.items.filter((p) => p.id !== kitProductId)))
      .catch(() => setCandidateProducts([]));
  }, [kitProductId]);

  const addComponent = async () => {
    if (!componentProductId || !quantity) return;
    setIsSaving(true);
    try {
      await productsService.components.create(kitProductId, {
        componentProductId,
        quantity: Number(quantity),
      });
      toast.success(t("products.kit.componentSaved"));
      setComponentProductId("");
      setQuantity("");
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSaving(false);
    }
  };

  const removeComponent = async (id: string) => {
    try {
      await productsService.components.remove(kitProductId, id);
      toast.success(t("products.kit.componentRemoved"));
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  return (
    <ModalSection title={t("products.kit.title")} columns={3}>
      <div className="col-span-2">
        <label className="text-body font-medium">{t("products.kit.component")}</label>
        <Select value={componentProductId || undefined} onValueChange={setComponentProductId}>
          <SelectTrigger className="mt-2 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {candidateProducts.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.displayName} — <span dir="ltr">{product.sku}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-body font-medium">{t("products.kit.quantity")}</label>
        <Input
          type="number"
          dir="ltr"
          min={1}
          step="0.001"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="mt-2"
        />
      </div>
      <ModalFieldFullWidth>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={addComponent}
          disabled={isSaving}
        >
          <Plus className="size-3.5" />
          {t("products.kit.addComponent")}
        </EnterpriseButton>
      </ModalFieldFullWidth>
      <ModalFieldFullWidth>
        {components.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("products.kit.componentsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {components.map((component) => (
              <div
                key={component.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{component.componentProduct?.displayName}</span>
                  <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {component.componentProduct?.sku}
                  </code>
                  <EnterpriseBadge variant="outline" dir="ltr">
                    × {component.quantity}
                  </EnterpriseBadge>
                </div>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeComponent(component.id)}
                  aria-label={t("products.kit.removeComponent")}
                >
                  <Trash2 className="size-3.5" />
                </EnterpriseButton>
              </div>
            ))}
          </div>
        )}
      </ModalFieldFullWidth>
    </ModalSection>
  );
}

function AttachmentsPanel({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [attachments, setAttachments] = useState<ProductAttachmentRow[]>([]);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = () => {
    productsService.attachments
      .list(productId)
      .then(setAttachments)
      .catch(() => setAttachments([]));
  };

  useEffect(load, [productId]);

  const addAttachment = async () => {
    if (!fileUrl) return;
    setIsSaving(true);
    try {
      await productsService.attachments.create(productId, {
        fileUrl,
        fileName: fileName || undefined,
      });
      toast.success(t("products.attachmentAdded"));
      setFileUrl("");
      setFileName("");
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalSection title={t("products.tabs.attachments")} columns={2}>
      <div>
        <label className="text-body font-medium">{t("products.fields.fileUrl")}</label>
        <Input
          dir="ltr"
          value={fileUrl}
          onChange={(e) => setFileUrl(e.target.value)}
          className="mt-2"
        />
      </div>
      <div>
        <label className="text-body font-medium">{t("products.fields.fileName")}</label>
        <Input value={fileName} onChange={(e) => setFileName(e.target.value)} className="mt-2" />
      </div>
      <ModalFieldFullWidth>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={addAttachment}
          disabled={isSaving}
        >
          <Plus className="size-3.5" />
          {t("products.actions.addAttachment")}
        </EnterpriseButton>
      </ModalFieldFullWidth>
      <ModalFieldFullWidth>
        {attachments.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("products.attachmentsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border p-2 text-sm text-primary underline-offset-2 hover:underline"
              >
                {attachment.fileName || attachment.fileUrl}
              </a>
            ))}
          </div>
        )}
      </ModalFieldFullWidth>
    </ModalSection>
  );
}
