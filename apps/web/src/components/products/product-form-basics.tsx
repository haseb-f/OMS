"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { Field, FormCardRow, FormCardSection } from "@/components/shared/form-card/form-card";
import { ReferenceSelectField } from "@/components/products/product-form-fields";
import { SimilarProductNames } from "@/components/products/similar-product-names";
import { ITEM_TYPES, type ItemType } from "@/config/products/attribute-rules";
import type { ProductFormValues } from "@/config/products/schema";
import type { CategoryRow, UnitRow } from "@/config/master-data/entities";
import type { SimilarProductName, ProductRow } from "@/services/products-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * The always-visible first screen of the product form: the Arabic name (with
 * the non-blocking similar-name hint), the generated SKU (read-only once it
 * exists), item type, category, unit and status. Unit and tax come from the
 * category (`onCategoryChange`) and stay overridable.
 */
export function ProductBasicsSection({
  savedProduct,
  sourceProduct,
  categories,
  units,
  similar,
  inheritedNote,
  canCreateCategory,
  onAddCategory,
  onItemTypeChange,
  onCategoryChange,
  onUnitChange,
}: {
  savedProduct: ProductRow | null;
  /** The record the form was loaded from — its embedded relations label a value missing from the (active-only) option lists. */
  sourceProduct: ProductRow | null;
  categories: CategoryRow[];
  units: UnitRow[];
  similar: SimilarProductName[];
  /** "Unit / tax filled from the category" — shown while either is still inherited. */
  inheritedNote: boolean;
  canCreateCategory: boolean;
  onAddCategory: () => void;
  onItemTypeChange: (itemType: ItemType) => void;
  onCategoryChange: (categoryId: string) => void;
  onUnitChange: (unitId: string) => void;
}) {
  const { t } = useLocale();
  const { control, clearErrors } = useFormContext<ProductFormValues>();

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ value: category.id, label: category.name })),
    [categories],
  );
  const unitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.id, label: unit.name })),
    [units],
  );

  return (
    <FormCardSection
      title={t("products.form.sections.basics")}
      description={savedProduct ? undefined : t("products.fields.skuHint")}
    >
      <FormCardRow>
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem data-size="lg">
              <FormLabel required>{t("products.fields.name")}</FormLabel>
              <FormControl>
                <Input {...field} autoFocus={!savedProduct} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {savedProduct ? (
          <Field size="sm">
            <Label htmlFor="product-sku">{t("products.fields.sku")}</Label>
            <Input id="product-sku" dir="ltr" readOnly value={savedProduct.sku} />
          </Field>
        ) : null}
      </FormCardRow>
      <SimilarProductNames items={similar} />

      <FormField
        control={control}
        name="itemType"
        render={({ field }) => (
          <FormItem data-field-name="itemType">
            <FormLabel required>{t("products.attr.itemType.label")}</FormLabel>
            <SegmentedRadioGroup<ItemType>
              aria-label={t("products.attr.itemType.label")}
              value={(field.value || "") as ItemType}
              onValueChange={(value) => {
                onItemTypeChange(value);
                clearErrors("itemType");
              }}
              options={ITEM_TYPES.map((value) => ({
                value,
                label: t(`products.attr.itemType.${value}`),
              }))}
            />
            <p className="text-caption text-muted-foreground">
              {field.value
                ? t(`products.attr.itemType.hint.${field.value}`)
                : t("products.attr.itemType.unset")}
            </p>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormCardRow>
        <ReferenceSelectField
          name="categoryId"
          label={t("products.fields.category")}
          required
          dataSize="lg"
          options={categoryOptions}
          selectedLabel={sourceProduct?.category?.name}
          createAction={
            canCreateCategory
              ? { label: t("products.addCategory"), onSelect: onAddCategory }
              : undefined
          }
          onValueChange={onCategoryChange}
          hint={categories.length === 0 ? t("products.noCategoryYet") : undefined}
        />
        <ReferenceSelectField
          name="unitId"
          label={t("products.fields.unit")}
          required
          dataSize="md"
          options={unitOptions}
          selectedLabel={sourceProduct?.unit?.name}
          onValueChange={onUnitChange}
        />
        <FormField
          control={control}
          name="status"
          render={({ field }) => (
            <FormItem data-size="sm">
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
      </FormCardRow>
      {inheritedNote ? (
        <p className="text-caption text-muted-foreground">{t("products.form.fromCategory")}</p>
      ) : null}
    </FormCardSection>
  );
}
