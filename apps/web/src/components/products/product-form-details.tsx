"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useFormContext, useWatch } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ModalFieldFullWidth } from "@/components/shared/modal-section";
import { PartnerPicker } from "@/components/business/partner-picker";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { ReferenceSelectField, SwitchRow } from "@/components/products/product-form-fields";
import {
  NumberFormField,
  SelectFormField,
  TextareaFormField,
  TextFormField,
} from "@/components/shared/form-fields";
import {
  useProductBrands,
  useAnalyticAccounts,
  useSuppliers,
  useTaxes,
  useWarehouses,
} from "@/hooks/use-reference-data";
import { cachedLookup } from "@/lib/lookup-cache";
import { useLocale } from "@/providers/locale-provider";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import type { ProductRow } from "@/services/products-service";
import type { BarcodeDuplicate } from "@/config/products/product-errors";
import type { ProductFormValues } from "@/config/products/schema";

/**
 * The fields of the product form's disclosure sections. Each component renders
 * the CELLS of the `ModalSection` grid that discloses it (no section chrome of
 * its own), so the form stays one shared section pattern.
 */

/** Sales + purchasing. A group shows only while the product is sellable / purchasable. */
export function ProductPricingFields({
  sourceProduct,
  taxFromCategory,
  onTaxChange,
}: {
  sourceProduct: ProductRow | null;
  taxFromCategory: boolean;
  onTaxChange: (taxId: string) => void;
}) {
  const { t } = useLocale();
  const { control, setValue } = useFormContext<ProductFormValues>();
  const taxes = useTaxes();
  const suppliers = useSuppliers();
  const [isSellable, isPurchasable, salesTaxIncluded, allowDiscount, preferredPartnerId] = useWatch(
    {
      control,
      name: [
        "isSellable",
        "isPurchasable",
        "salesTaxIncluded",
        "allowDiscount",
        "preferredPartnerId",
      ],
    },
  );

  const taxOptions = useMemo(
    () =>
      taxes.map((tax) => ({
        value: tax.id,
        label: `${tax.name} (${tax.rate}%)`,
        searchText: tax.code,
      })),
    [taxes],
  );

  // The picker holds a Partner row; the form holds its id. Resolve a stored id
  // from the cached supplier list, else by one batched catalog lookup — a
  // supplier beyond the list's first rows still displays.
  const [preferredSupplier, setPreferredSupplier] = useState<PartnerPickerRow | null>(null);
  useEffect(() => {
    if (!preferredPartnerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreferredSupplier(null);
      return;
    }
    if (preferredSupplier?.id === preferredPartnerId) return;
    const known = suppliers.find((supplier) => supplier.id === preferredPartnerId);
    if (known) {
      setPreferredSupplier(known);
      return;
    }
    let cancelled = false;
    cachedLookup(`partners:ids:${preferredPartnerId}`, () =>
      partnersService.catalog({ ids: [preferredPartnerId], pageSize: 1, role: ["SUPPLIER"] }),
    )
      .then((result) => !cancelled && setPreferredSupplier(result.items[0] ?? null))
      .catch(() => !cancelled && setPreferredSupplier(null));
    return () => {
      cancelled = true;
    };
    // `preferredSupplier` is the value being resolved, not an input of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredPartnerId, suppliers]);

  return (
    <>
      <ReferenceSelectField
        name="taxId"
        label={t("products.fields.taxGroup")}
        optional
        allowClear
        options={taxOptions}
        placeholder={t("common.none")}
        selectedLabel={
          sourceProduct?.tax ? `${sourceProduct.tax.name} (${sourceProduct.tax.rate}%)` : undefined
        }
        hint={taxFromCategory ? t("products.form.taxFromCategory") : undefined}
        onValueChange={onTaxChange}
      />
      {isSellable ? (
        <>
          <NumberFormField
            control={control}
            name="salesPrice"
            label={t("products.fields.salesPrice")}
            step="0.01"
            min={0}
          />
          <SwitchRow
            id="product-allow-discount"
            label={t("products.fields.allowDiscount")}
            checked={allowDiscount}
            onCheckedChange={(value) => setValue("allowDiscount", value, { shouldDirty: true })}
          />
          <SwitchRow
            id="product-tax-included"
            label={t("products.fields.salesTaxIncluded")}
            checked={salesTaxIncluded}
            onCheckedChange={(value) => setValue("salesTaxIncluded", value, { shouldDirty: true })}
          />
          <ModalFieldFullWidth>
            <TextareaFormField
              control={control}
              name="salesDescription"
              label={t("products.fields.salesDescription")}
              rows={2}
              optional
            />
          </ModalFieldFullWidth>
        </>
      ) : null}
      {isPurchasable ? (
        <>
          <NumberFormField
            control={control}
            name="purchasePrice"
            label={t("products.fields.expectedPurchasePrice")}
            description={t("products.fields.expectedPurchasePriceHint")}
            step="0.01"
            min={0}
          />
          <FormField
            control={control}
            name="preferredPartnerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel optional>{t("products.fields.preferredSupplier")}</FormLabel>
                <FormControl>
                  <PartnerPicker
                    role="SUPPLIER"
                    value={preferredSupplier}
                    onChange={(partner) => {
                      setPreferredSupplier(partner);
                      field.onChange(partner.id);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <ModalFieldFullWidth>
            <TextareaFormField
              control={control}
              name="purchaseDescription"
              label={t("products.fields.purchaseDescription")}
              rows={2}
              optional
            />
          </ModalFieldFullWidth>
        </>
      ) : null}
    </>
  );
}

/** Reorder / min-max levels, batch & serial tracking, location, preferred warehouse and dimensions. */
export function ProductInventoryFields() {
  const { t } = useLocale();
  const { control } = useFormContext<ProductFormValues>();
  const warehouses = useWarehouses();

  return (
    <>
      <NumberFormField
        control={control}
        name="reorderLevel"
        label={t("products.fields.reorderLevel")}
        min={0}
      />
      <NumberFormField
        control={control}
        name="reorderQuantity"
        label={t("products.fields.reorderQuantity")}
        min={0}
      />
      <NumberFormField
        control={control}
        name="safetyStock"
        label={t("products.fields.safetyStock")}
        min={0}
      />
      <NumberFormField
        control={control}
        name="minQuantity"
        label={t("products.fields.minQuantity")}
        min={0}
      />
      <NumberFormField
        control={control}
        name="maxQuantity"
        label={t("products.fields.maxQuantity")}
        min={0}
      />
      <TextFormField
        control={control}
        name="storageLocation"
        label={t("products.fields.storageLocation")}
      />
      <SelectFormField
        control={control}
        name="inventoryTracking"
        label={t("products.fields.inventoryTracking")}
        options={(["NONE", "BATCH", "SERIAL"] as const).map((value) => ({
          value,
          label: t(`products.inventoryTracking.${value}`),
        }))}
      />
      <FormField
        control={control}
        name="preferredWarehouseId"
        render={({ field }) => (
          <FormItem>
            <FormLabel optional>{t("products.fields.preferredWarehouse")}</FormLabel>
            <FormControl>
              <WarehousePicker
                embedded
                value={warehouses.find((warehouse) => warehouse.id === field.value)}
                onChange={(warehouse) => field.onChange(warehouse.id)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {(["weight", "width", "height", "length"] as const).map((name) => (
        <NumberFormField
          key={name}
          control={control}
          name={name}
          label={t(`products.fields.${name}`)}
          min={0}
        />
      ))}
      <ModalFieldFullWidth>
        <p className="text-caption text-muted-foreground">{t("products.fields.dimensionsHint")}</p>
      </ModalFieldFullWidth>
    </>
  );
}

/** Names, barcode (unique), codes, keywords, tags, brand, cost center, image and descriptions. */
export function ProductIdentityFields({
  barcodeDuplicate,
  onBarcodeEdited,
  sourceProduct,
}: {
  /** The product that already holds the typed barcode (server 409), named inline. */
  barcodeDuplicate: BarcodeDuplicate | null;
  onBarcodeEdited: () => void;
  sourceProduct: ProductRow | null;
}) {
  const { t } = useLocale();
  const { control, watch, clearErrors } = useFormContext<ProductFormValues>();
  const brands = useProductBrands();
  const analyticAccounts = useAnalyticAccounts();
  const imageUrl = watch("imageUrl");

  const brandOptions = useMemo(
    () => brands.map((brand) => ({ value: brand.id, label: brand.name })),
    [brands],
  );
  const analyticOptions = useMemo(
    () =>
      analyticAccounts.map((account) => ({
        value: account.id,
        label: account.name,
        description: account.code,
        searchText: account.code,
      })),
    [analyticAccounts],
  );

  return (
    <>
      <TextFormField
        control={control}
        name="nameEn"
        label={t("products.fields.nameEn")}
        dir="ltr"
        optional
      />
      <TextFormField
        control={control}
        name="internalName"
        label={t("products.fields.internalName")}
        description={t("products.form.nameDefaultHint")}
      />
      <TextFormField
        control={control}
        name="displayName"
        label={t("products.fields.displayName")}
        description={t("products.form.nameDefaultHint")}
      />
      <FormField
        control={control}
        name="barcode"
        render={({ field }) => (
          <FormItem>
            <FormLabel optional>{t("products.fields.barcode")}</FormLabel>
            <FormControl>
              <Input
                {...field}
                dir="ltr"
                onChange={(event) => {
                  field.onChange(event);
                  if (barcodeDuplicate) onBarcodeEdited();
                  clearErrors("barcode");
                }}
              />
            </FormControl>
            <FormMessage />
            {barcodeDuplicate?.productId ? (
              <Link
                href={`/products/${barcodeDuplicate.productId}`}
                target="_blank"
                className="text-caption text-primary underline-offset-2 hover:underline"
              >
                {t("products.form.openOtherProduct")}
              </Link>
            ) : null}
          </FormItem>
        )}
      />
      <TextFormField
        control={control}
        name="qrCodeValue"
        label={t("products.fields.qrCodeValue")}
        dir="ltr"
        optional
      />
      <TextFormField
        control={control}
        name="searchKeywords"
        label={t("products.fields.searchKeywords")}
        description={t("products.fields.searchKeywordsHint")}
        optional
      />
      <TextFormField
        control={control}
        name="tagsInput"
        label={t("products.fields.tags")}
        description={t("products.fields.tagsHint")}
        optional
      />
      <ReferenceSelectField
        name="brandId"
        label={t("products.fields.brand")}
        optional
        allowClear
        options={brandOptions}
        selectedLabel={sourceProduct?.brand?.name}
      />
      <ReferenceSelectField
        name="analyticAccountId"
        label={t("products.fields.costCenter")}
        optional
        allowClear
        options={analyticOptions}
        selectedLabel={sourceProduct?.analyticAccount?.name}
      />
      <TextFormField
        control={control}
        name="imageUrl"
        label={t("products.fields.imageUrl")}
        dir="ltr"
        placeholder="https://…"
        optional
      />
      {imageUrl ? (
        <div className="flex items-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="h-16 w-16 rounded-sm border border-border object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : null}
      <ModalFieldFullWidth>
        <TextareaFormField
          control={control}
          name="description"
          label={t("products.fields.description")}
          rows={2}
          optional
        />
      </ModalFieldFullWidth>
      <ModalFieldFullWidth>
        <TextareaFormField
          control={control}
          name="internalNotes"
          label={t("products.fields.internalNotes")}
          rows={2}
          optional
        />
      </ModalFieldFullWidth>
    </>
  );
}
