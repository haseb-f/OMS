"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { productsService, type ProductRow } from "@/services/products-service";
import type { CategoryRow, UnitRow } from "@/config/master-data/entities";
import {
  productCreateSchema,
  productCreateDefaultValues,
  type ProductCreateFormValues,
} from "@/config/products/create-schema";

const BUSINESS_BEHAVIORS = [
  "PURCHASE_ONLY",
  "SALES_ONLY",
  "PURCHASE_AND_SALE",
  "MANUFACTURED",
  "SERVICE",
  "EXPENSE_ITEM",
] as const;

/**
 * TASK-028 (Inventory Foundation pass) — the lean, dedicated Create Product
 * surface: exactly 5 fields (Name, Category, Unit, Product Behavior, Sales
 * Price) — never dimensions, weight, purchase price, tax, warehouse,
 * analytic account, or anything else. All of that lives in the full product
 * modal's tabs, reachable only after saving. Deliberately a SEPARATE
 * component from `ProductModal` (the tabbed edit experience) so "minimum
 * clicks, minimum required fields" doesn't get diluted by reusing the rich
 * edit UI for first-time creation.
 */
export function ProductCreateDialog({
  open,
  onOpenChange,
  icon,
  categories,
  units,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
  categories: CategoryRow[];
  units: UnitRow[];
  onCreated: (product: ProductRow) => void;
}) {
  const { t } = useLocale();

  const form = useForm<ProductCreateFormValues>({
    resolver: zodResolver(productCreateSchema),
    defaultValues: productCreateDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(productCreateDefaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;

  const submit = form.handleSubmit(async (values) => {
    try {
      const created = await productsService.create(values);
      toast.success(t("products.createdSuccess"));
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  });

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={icon}
      title={t("products.createDialog.title")}
      description={t("products.createDialog.description")}
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
        <ModalSection title={t("products.createDialog.title")} columns={2}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("products.fields.name")} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("products.fields.type")} <span className="text-destructive">*</span>
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {BUSINESS_BEHAVIORS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`products.type.${type}`)}
                      </SelectItem>
                    ))}
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
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("products.fields.category")} <span className="text-destructive">*</span>
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
        </ModalSection>
      </Form>
    </EnterpriseModal>
  );
}
