"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection, ModalFieldFullWidth } from "@/components/shared/modal-section";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { productsService, type ProductRow } from "@/services/products-service";
import type { CategoryRow, UnitRow, TaxRow, WarehouseRow } from "@/config/master-data/entities";
import type { PartnerRow } from "@/services/partners-service";
import {
  productCreateSchema,
  productCreateDefaultValues,
  PRODUCT_WIZARD_STEPS,
  type ProductCreateFormValues,
  type ProductWizardStep,
} from "@/config/products/create-schema";

const BUSINESS_BEHAVIORS = [
  "PURCHASE_ONLY",
  "SALES_ONLY",
  "PURCHASE_AND_SALE",
  "MANUFACTURED",
  "SERVICE",
  "EXPENSE_ITEM",
] as const;

const NUMBER_FIELDS = [
  "salesPrice",
  "purchasePrice",
  "reorderLevel",
  "weight",
  "width",
  "height",
  "length",
] as const;

/**
 * Product Creation Wizard — replaces the old single-section create dialog.
 * Four compact steps (الأساسيات / التسعير والتجارة / المخزون / مراجعة
 * وإنشاء); only Step 1's three fields (Name/Category/Unit) are ever
 * required — every other field across every step stays optional, and a
 * draft can be created straight after Step 1 via the persistent "إنشاء
 * كمسودة" action, never forcing the user through Steps 2-3. Values survive
 * moving back and forth between steps (one `react-hook-form` instance for
 * the whole wizard, not one per step).
 */
export function ProductCreateDialog({
  open,
  onOpenChange,
  icon,
  categories,
  units,
  taxes,
  suppliers,
  warehouses,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
  categories: CategoryRow[];
  units: UnitRow[];
  taxes?: TaxRow[];
  suppliers?: PartnerRow[];
  warehouses?: WarehouseRow[];
  onCreated: (product: ProductRow) => void;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState<ProductWizardStep>("basics");
  const stepIndex = PRODUCT_WIZARD_STEPS.indexOf(step);

  const form = useForm<ProductCreateFormValues>({
    resolver: zodResolver(productCreateSchema),
    defaultValues: productCreateDefaultValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(productCreateDefaultValues);
      setStep("basics");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isDirty = form.formState.isDirty;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const goNext = async () => {
    if (step === "basics") {
      const valid = await form.trigger(["name", "categoryId", "unitId"]);
      if (!valid) return;
    }
    setStep(PRODUCT_WIZARD_STEPS[Math.min(stepIndex + 1, PRODUCT_WIZARD_STEPS.length - 1)]);
  };
  const goBack = () => setStep(PRODUCT_WIZARD_STEPS[Math.max(stepIndex - 1, 0)]);

  const submitDraft = form.handleSubmit(
    async (values) => {
      setIsSubmitting(true);
      try {
        const created = await productsService.create(values);
        toast.success(t("products.createdSuccess"));
        onOpenChange(false);
        onCreated(created);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
      } finally {
        setIsSubmitting(false);
      }
    },
    () => {
      // Required-field errors live on Step 1 — jump the operator there
      // instead of leaving them staring at whichever step they were on.
      setStep("basics");
    },
  );

  const requestCreateDraft = async () => {
    const step1Valid = await form.trigger(["name", "categoryId", "unitId"]);
    if (!step1Valid) {
      setStep("basics");
      return;
    }
    await submitDraft();
  };

  const values = form.watch();
  const category = categories.find((c) => c.id === values.categoryId);
  const unit = units.find((u) => u.id === values.unitId);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
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
          {/* Always available — Step 1's fields are enough to create a
              draft, no need to step through Pricing/Inventory first. */}
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={() => void requestCreateDraft()}
            disabled={isSubmitting}
          >
            {t("products.wizard.createDraftNow")}
          </EnterpriseButton>
          {step !== "basics" && (
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={isSubmitting}
            >
              {t("products.wizard.back")}
            </EnterpriseButton>
          )}
          {step !== "review" ? (
            <EnterpriseButton type="button" onClick={() => void goNext()} disabled={isSubmitting}>
              {t("products.wizard.next")}
            </EnterpriseButton>
          ) : (
            <EnterpriseButton
              type="button"
              onClick={() => void submitDraft()}
              disabled={isSubmitting}
            >
              {t("products.wizard.createDraft")}
            </EnterpriseButton>
          )}
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <WizardStepIndicator currentStep={step} />

        <Form {...form}>
          {step === "basics" && (
            <ModalSection title={t("products.wizard.steps.basics")} columns={2}>
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
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
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
                        {units.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
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
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("products.fields.type")}</FormLabel>
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
                    <FormMessage />
                  </FormItem>
                )}
              />
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
            </ModalSection>
          )}

          {step === "pricing" && (
            <ModalSection title={t("products.wizard.steps.pricing")} columns={2} optional>
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
              {taxes && (
                <FormField
                  control={form.control}
                  name="taxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.taxGroup")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("common.none")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {taxes.map((tax) => (
                            <SelectItem key={tax.id} value={tax.id}>
                              {tax.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {suppliers && (
                <FormField
                  control={form.control}
                  name="preferredPartnerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.preferredSupplier")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("common.none")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </ModalSection>
          )}

          {step === "inventory" && (
            <ModalSection title={t("products.wizard.steps.inventory")} columns={2} optional>
              <ModalFieldFullWidth>
                <FormField
                  control={form.control}
                  name="isInventoryItem"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {t("products.fields.trackInventory")}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </ModalFieldFullWidth>
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
              {warehouses && (
                <FormField
                  control={form.control}
                  name="preferredWarehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("products.fields.preferredWarehouse")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("common.none")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {(["weight", "width", "height", "length"] as const).map((key) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(`products.fields.${key}`)}</FormLabel>
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
              ))}
            </ModalSection>
          )}

          {step === "review" && (
            <ModalSection title={t("products.wizard.steps.review")} columns={2}>
              <ModalFieldFullWidth>
                <p className="text-caption text-muted-foreground">
                  {t("products.wizard.reviewIntro")}
                </p>
              </ModalFieldFullWidth>
              <ReviewRow label={t("products.fields.name")} value={values.name} />
              <ReviewRow label={t("products.fields.category")} value={category?.name} />
              <ReviewRow label={t("products.fields.unit")} value={unit?.name} />
              <ReviewRow
                label={t("products.fields.type")}
                value={values.type ? t(`products.type.${values.type}`) : undefined}
              />
              {NUMBER_FIELDS.map((key) =>
                values[key] != null ? (
                  <ReviewRow
                    key={key}
                    label={t(`products.fields.${key}`)}
                    value={String(values[key])}
                  />
                ) : null,
              )}
              <ModalFieldFullWidth>
                <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-success" />
                  {t("products.wizard.willStartAsDraft")}
                </div>
              </ModalFieldFullWidth>
            </ModalSection>
          )}
        </Form>
      </div>
    </EnterpriseModal>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body font-medium">{value || t("products.wizard.notProvided")}</dd>
    </div>
  );
}

function WizardStepIndicator({ currentStep }: { currentStep: ProductWizardStep }) {
  const { t } = useLocale();
  const currentIndex = PRODUCT_WIZARD_STEPS.indexOf(currentStep);
  return (
    <ol className="flex items-center gap-2">
      {PRODUCT_WIZARD_STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                isCurrent && "bg-primary text-primary-foreground",
                isDone && "bg-success/15 text-success",
                !isCurrent && !isDone && "bg-muted text-muted-foreground",
              )}
            >
              {isDone ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "min-w-0 truncate text-caption",
                isCurrent ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {t(`products.wizard.steps.${step}`)}
            </span>
            {index < PRODUCT_WIZARD_STEPS.length - 1 && (
              <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
