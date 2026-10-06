"use client";

import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { FormCardStack } from "@/components/shared/form-card/form-card";
import { ModalSection } from "@/components/shared/modal-section";
import {
  FormErrorSummary,
  applyServerFieldErrors,
  formErrorsFromRhf,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { CategoryQuickCreateDialog } from "@/components/business/category-quick-create-dialog";
import { ProductBasicsSection } from "@/components/products/product-form-basics";
import {
  ProductTradingSection,
  investmentStateFor,
} from "@/components/products/product-form-trading";
import {
  ProductIdentityFields,
  ProductInventoryFields,
  ProductPricingFields,
} from "@/components/products/product-form-details";
import {
  ProductEffectiveDefaults,
  ProductInvestmentLinksPanel,
} from "@/components/products/product-form-insights";
import {
  ProductAttachments,
  ProductStockMovements,
  ProductStockSummary,
  ProductVariants,
} from "@/components/products/product-extras-panels";
import { RecipePanel } from "@/components/products/recipe-panel";
import {
  ProductCommissionDraftSection,
  ProductCommissionSection,
} from "@/components/products/product-commission-section";
import {
  EMPTY_COMMISSION_DRAFT,
  commissionDraftInput,
  commissionDraftInvalid,
  type ProductCommissionDraft,
} from "@/components/products/product-commission-form";
import { ProductOpeningBalanceDialog } from "@/app/(shell)/products/product-opening-balance-dialog";
import { useProductCategories, useUnits, useWarehouses } from "@/hooks/use-reference-data";
import { useSimilarProductNames } from "@/hooks/use-similar-product-names";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { toISODate } from "@/lib/date";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import type { MessageKey } from "@/i18n/translate";
import { productCommissionService } from "@/services/product-commission-service";
import { productsService, type ProductRow } from "@/services/products-service";
import {
  changeItemType,
  changeSupplyMethod,
  settleAttributes,
  stockTrackingState,
  usesRecipe,
  type InvestmentBlockedReason,
  type ItemType,
  type ProductAttributes,
  type SupplyMethod,
} from "@/config/products/attribute-rules";
import {
  NOT_INHERITED,
  applyCategoryDefaults,
  type InheritedFlags,
} from "@/config/products/category-defaults";
import {
  barcodeDuplicateFromError,
  investmentReasonFromError,
  productRuleMessage,
  type BarcodeDuplicate,
} from "@/config/products/product-errors";
import { toProductPayload } from "@/config/products/product-payload";
import {
  attributesOf,
  createProductSchema,
  toProductFormValues,
  type ProductFormValues,
} from "@/config/products/schema";

/** Same permission the Product Categories page and `POST /product-categories` enforce. */
const CREATE_CATEGORY_PERMISSION = "masterdata.categories.create";

/** The disclosure sections of the form; `initialSection` opens one on arrival (e.g. from a detail page's edit icon). */
export type ProductFormSection =
  | "pricing"
  | "inventory"
  | "recipe"
  | "accounting"
  | "commission"
  | "investment"
  | "details"
  | "variants"
  | "attachments";

/** Which section holds which field — a failed save opens the section(s) that hold an error. */
const SECTION_FIELDS: Partial<Record<ProductFormSection, readonly string[]>> = {
  pricing: [
    "taxId",
    "salesPrice",
    "salesDescription",
    "purchasePrice",
    "preferredPartnerId",
    "purchaseDescription",
  ],
  inventory: [
    "reorderLevel",
    "reorderQuantity",
    "safetyStock",
    "minQuantity",
    "maxQuantity",
    "storageLocation",
    "inventoryTracking",
    "preferredWarehouseId",
    "weight",
    "width",
    "height",
    "length",
  ],
  details: [
    "nameEn",
    "internalName",
    "displayName",
    "barcode",
    "qrCodeValue",
    "searchKeywords",
    "tagsInput",
    "brandId",
    "analyticAccountId",
    "imageUrl",
    "description",
    "internalNotes",
  ],
};

/** The order and labels of the form's fields in the error summary. */
const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  name: "products.fields.name",
  itemType: "products.attr.itemType.label",
  categoryId: "products.fields.category",
  unitId: "products.fields.unit",
  status: "products.fields.status",
  ownerAgentId: "agentPricing.ownership.agent",
  availableForInvestmentOpportunities: "products.attr.investor",
  supplyMethod: "products.attr.supplyMethod.label",
  taxId: "products.fields.taxGroup",
  salesPrice: "products.fields.salesPrice",
  purchasePrice: "products.fields.expectedPurchasePrice",
  barcode: "products.fields.barcode",
  weight: "products.fields.weight",
  width: "products.fields.width",
  height: "products.fields.height",
  length: "products.fields.length",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL_KEYS);
/** Every field a server error may be attached to inline. */
const KNOWN_FIELDS = [...new Set([...FIELD_ORDER, ...Object.values(SECTION_FIELDS).flat()])];

const ATTRIBUTE_FIELDS = [
  "itemType",
  "isSellable",
  "isPurchasable",
  "isInventoryItem",
  "supplyMethod",
] as const;

export interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The product being edited; null/omitted = create. */
  editingProduct?: ProductRow | null;
  /** A product whose values prefill a NEW one (its barcode and code are never copied). */
  duplicateSource?: ProductRow | null;
  /** Prefill from a picker's search text — a typed-but-unmatched name. */
  initialName?: string;
  /** A new product created from an agent's page starts agent-owned. */
  initialOwnerAgentId?: string;
  /** Opens one disclosure section on arrival. */
  initialSection?: ProductFormSection;
  /** After a successful save (the dialog closes itself). */
  onSaved?: (product: ProductRow, mode: "create" | "edit") => void;
}

/**
 * The ONE product form — create, edit and duplicate (R13). Everything needed to
 * define a product is on the first screen (name, item type, category, unit,
 * can-be-sold / can-be-purchased / track-stock, supply method, ownership,
 * investor eligibility); the rest is progressive disclosure that appears only
 * when it is relevant (pricing & purchasing, inventory, recipe, inherited
 * accounting, commission, investment links, identity extras, variants,
 * attachments). The rules between the attributes live in
 * `config/products/attribute-rules.ts`; the server re-validates every write.
 *
 * Mounted only while open, so every open starts from the record (or blank).
 */
export function ProductFormDialog(props: ProductFormDialogProps) {
  if (!props.open) return null;
  return <ProductFormDialogBody {...props} />;
}

function ProductFormDialogBody({
  onOpenChange,
  editingProduct = null,
  duplicateSource = null,
  initialName,
  initialOwnerAgentId,
  initialSection,
  onSaved,
}: ProductFormDialogProps) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const categories = useProductCategories();
  const units = useUnits();
  const warehouses = useWarehouses();

  const savedProduct = editingProduct;
  const isEditing = !!savedProduct;
  /** The record the form was loaded from — its embedded relations label a value missing from the (active-only) option lists. */
  const sourceProduct = savedProduct ?? duplicateSource;
  const canSetOwnerAgent = hasPermission("agents.view");
  const canCreateCategory = hasPermission(CREATE_CATEGORY_PERMISSION);

  const schema = useMemo(() => createProductSchema(t), [t]);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues(),
  });

  function initialValues(): ProductFormValues {
    const values = { ...toProductFormValues(savedProduct ?? duplicateSource) };
    if (!savedProduct && duplicateSource) {
      // A copy is a new draft: the barcode is unique and the code is generated.
      values.barcode = "";
      values.status = "DRAFT";
    }
    if (!sourceProduct) {
      if (initialName) values.name = initialName;
      if (initialOwnerAgentId) {
        values.ownership = "AGENT";
        values.ownerAgentId = initialOwnerAgentId;
      }
    }
    return values;
  }

  const [openSections, setOpenSections] = useState<ReadonlySet<ProductFormSection>>(
    () => new Set(initialSection ? [initialSection] : []),
  );
  const [inherited, setInherited] = useState<InheritedFlags>(NOT_INHERITED);
  const [categoryQuickCreateOpen, setCategoryQuickCreateOpen] = useState(false);
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const [commissionDraft, setCommissionDraft] =
    useState<ProductCommissionDraft>(EMPTY_COMMISSION_DRAFT);
  const [showDraftErrors, setShowDraftErrors] = useState(false);
  const [barcodeDuplicate, setBarcodeDuplicate] = useState<BarcodeDuplicate | null>(null);
  const [investmentApiReason, setInvestmentApiReason] = useState<InvestmentBlockedReason | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrorItem[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);

  const [name, categoryId, itemType, supplyMethod, isSellable, isPurchasable, isInventoryItem] =
    useWatch({
      control: form.control,
      name: [
        "name",
        "categoryId",
        "itemType",
        "supplyMethod",
        "isSellable",
        "isPurchasable",
        "isInventoryItem",
      ],
    });
  const ownership = useWatch({ control: form.control, name: "ownership" });
  const ownerAgentId = useWatch({ control: form.control, name: "ownerAgentId" });

  const similar = useSimilarProductNames({
    name,
    excludeId: savedProduct?.id,
    categoryId,
    // An existing product is compared only once its name is edited.
    enabled: !savedProduct || name.trim() !== savedProduct.name.trim(),
  });

  const effectiveItemType = (itemType || "PRODUCT") as ItemType;
  const attributes = { itemType: effectiveItemType, supplyMethod: supplyMethod as SupplyMethod };
  const tracked = stockTrackingState({ ...attributes, isInventoryItem }).value;
  const showRecipe = usesRecipe(attributes);
  // Hint for "the fields the recipe needs": it can only be built once the saved product is Assembled / Kit.
  const recipeReady = savedProduct?.supplyMethod === supplyMethod;

  // An owner chosen here on an existing product (or a new agent-owned one) has no commission setting yet.
  const showCommissionDraft =
    canSetOwnerAgent &&
    hasPermission("agents.agreements.manage") &&
    ownership === "AGENT" &&
    !!ownerAgentId &&
    savedProduct?.ownerAgentId !== ownerAgentId;

  const section = (id: ProductFormSection) => ({
    collapsible: true as const,
    open: openSections.has(id),
    onOpenChange: (open: boolean) =>
      setOpenSections((current) => {
        const next = new Set(current);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      }),
  });

  /** Opens the sections that hold any of the fields in error. */
  const revealSectionsFor = (fieldNames: string[]) =>
    setOpenSections((current) => {
      const next = new Set(current);
      for (const [id, fields] of Object.entries(SECTION_FIELDS)) {
        if (fields?.some((field) => fieldNames.includes(field))) next.add(id as ProductFormSection);
      }
      return next;
    });

  const setAttributes = (next: ProductAttributes) => {
    for (const key of ATTRIBUTE_FIELDS) {
      form.setValue(key, next[key], { shouldDirty: true });
    }
  };

  const currentAttributes = (): ProductAttributes | null => attributesOf(form.getValues());

  const handleItemTypeChange = (next: ItemType) => {
    const current = currentAttributes();
    if (!current) {
      // A legacy product with no item type yet: only the type is chosen, its flags are kept.
      form.setValue("itemType", next, { shouldDirty: true });
      setAttributes(
        settleAttributes({
          itemType: next,
          isSellable: form.getValues("isSellable"),
          isPurchasable: form.getValues("isPurchasable"),
          isInventoryItem: form.getValues("isInventoryItem"),
          supplyMethod: form.getValues("supplyMethod"),
        }),
      );
      return;
    }
    setAttributes(changeItemType(current, next));
  };

  const handleSupplyMethodChange = (next: SupplyMethod) => {
    const current = currentAttributes();
    if (current) setAttributes(changeSupplyMethod(current, next));
  };

  /** Create only: picking a category pre-fills unit and tax, which stay overridable. */
  const handleCategoryChange = (id: string) => {
    if (isEditing) return;
    const category = categories.find((row) => row.id === id);
    const result = applyCategoryDefaults(
      { unitId: form.getValues("unitId"), taxId: form.getValues("taxId") ?? "" },
      inherited,
      category,
    );
    if (result.unitId !== form.getValues("unitId")) {
      form.setValue("unitId", result.unitId, { shouldDirty: true, shouldValidate: true });
    }
    if (result.taxId !== (form.getValues("taxId") ?? "")) {
      form.setValue("taxId", result.taxId, { shouldDirty: true });
    }
    setInherited(result.inherited);
  };

  const labelFor = (field: string) => {
    const key = FIELD_LABEL_KEYS[field];
    return key ? t(key) : undefined;
  };

  const handleSaveFailure = (error: unknown) => {
    const duplicate = barcodeDuplicateFromError(error);
    if (duplicate) {
      setBarcodeDuplicate(duplicate);
      const message = t("products.form.barcodeDuplicate", {
        sku: duplicate.sku,
        name: duplicate.name,
      });
      form.setError("barcode", { type: "server", message });
      revealSectionsFor(["barcode"]);
      setServerErrors([]);
      focusFirstInvalid();
      toast.error(message);
      return;
    }
    const reason = investmentReasonFromError(error);
    if (reason) setInvestmentApiReason(reason);
    const ruleMessage = productRuleMessage(error, t);
    const items = applyServerFieldErrors(error, form.setError, {
      knownFields: KNOWN_FIELDS,
      labelFor,
      fallback: "common.failedToSave",
    });
    setServerErrors(ruleMessage ? [{ message: ruleMessage }] : items);
    revealSectionsFor(Object.keys(form.formState.errors));
    focusFirstInvalid();
    if (ruleMessage) toast.error(ruleMessage);
    else reportApiError(error, "common.failedToSave");
  };

  const onValid = async (submitted: ProductFormValues) => {
    if (!submitted.itemType) {
      form.setError("itemType", { message: t("agentPricing.itemType.required") });
      focusFirstInvalid();
      return;
    }
    if (canSetOwnerAgent && submitted.ownership === "AGENT" && !submitted.ownerAgentId) {
      form.setError("ownerAgentId", { message: t("agentPricing.ownership.agentRequired") });
      focusFirstInvalid();
      return;
    }
    if (showCommissionDraft && commissionDraftInvalid(commissionDraft)) {
      setShowDraftErrors(true);
      return;
    }
    // Whatever the user toggled, the saved combination is a legal one.
    const values: ProductFormValues = {
      ...submitted,
      ...settleAttributes(attributesOf(submitted) as ProductAttributes),
    };
    const investment = investmentStateFor(values, {
      canSetOwnerAgent,
      sourceProduct: savedProduct,
    });

    setIsSubmitting(true);
    try {
      const payload = toProductPayload(values, {
        initial: savedProduct,
        canSetOwnerAgent,
        investmentFlag: investment.value,
      });
      const saved = savedProduct
        ? await productsService.update(savedProduct.id, payload)
        : await productsService.create(payload);
      toast.success(t(savedProduct ? "products.saved" : "products.createdSuccess"));
      // The commission choice is saved with the product (no second step) — its failure never hides that the product saved.
      const draftInput = showCommissionDraft
        ? commissionDraftInput(commissionDraft, toISODate(new Date()))
        : null;
      if (draftInput && saved.ownerAgentId) {
        try {
          await productCommissionService.set(saved.id, draftInput);
        } catch (commissionError) {
          reportApiError(commissionError, "products.form.commissionNotSaved");
        }
      }
      onSaved?.(saved, savedProduct ? "edit" : "create");
      onOpenChange(false);
    } catch (error) {
      handleSaveFailure(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = () => {
    setSubmitAttempted(true);
    setServerErrors([]);
    setBarcodeDuplicate(null);
    return form.handleSubmit(onValid, (errors) => {
      revealSectionsFor(Object.keys(errors));
      focusFirstInvalid();
    })();
  };

  const summaryErrors: FormErrorItem[] = submitAttempted
    ? [
        ...formErrorsFromRhf(form.formState.errors, { labelFor, order: FIELD_ORDER }),
        ...serverErrors,
      ]
    : [];

  const title = isEditing
    ? t("products.editTitle")
    : duplicateSource
      ? t("products.duplicateTitle")
      : t("products.addTitle");

  return (
    <>
      <EnterpriseModal
        open
        onOpenChange={onOpenChange}
        size="lg"
        layout="form-card"
        title={title}
        description={savedProduct ? savedProduct.sku : t("products.form.description")}
        isDirty={form.formState.isDirty}
        errorSummary={<FormErrorSummary errors={summaryErrors} />}
        footer={(requestClose) => (
          <CreateOperationFooter
            requestClose={requestClose}
            onSubmit={() => void submit()}
            isSubmitting={isSubmitting}
          />
        )}
      >
        <Form {...form}>
          <div ref={bodyRef}>
            <FormCardStack>
              <ProductBasicsSection
                savedProduct={savedProduct}
                sourceProduct={sourceProduct}
                categories={categories}
                units={units}
                similar={similar}
                inheritedNote={inherited.unit || inherited.tax}
                canCreateCategory={canCreateCategory}
                onAddCategory={() => setCategoryQuickCreateOpen(true)}
                onItemTypeChange={handleItemTypeChange}
                onCategoryChange={handleCategoryChange}
                onUnitChange={() => setInherited((current) => ({ ...current, unit: false }))}
              />
              <ProductTradingSection
                sourceProduct={savedProduct}
                onSupplyMethodChange={handleSupplyMethodChange}
                investmentApiReason={investmentApiReason}
              />

              {isSellable || isPurchasable ? (
                <ModalSection
                  title={t("products.form.sections.pricing")}
                  columns={2}
                  {...section("pricing")}
                >
                  <ProductPricingFields
                    sourceProduct={sourceProduct}
                    taxFromCategory={inherited.tax}
                    onTaxChange={() => setInherited((current) => ({ ...current, tax: false }))}
                  />
                </ModalSection>
              ) : null}

              {tracked ? (
                <ModalSection
                  title={t("products.form.sections.inventory")}
                  columns={3}
                  {...section("inventory")}
                >
                  {savedProduct ? (
                    <ProductStockSummary
                      product={savedProduct}
                      onOpeningBalance={() => setOpeningBalanceOpen(true)}
                    />
                  ) : null}
                  <ProductInventoryFields />
                  {savedProduct ? (
                    <div className="col-span-full">
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <DisclosureTrigger>{t("products.tabs.stockMovements")}</DisclosureTrigger>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <ProductStockMovements productId={savedProduct.id} />
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  ) : null}
                </ModalSection>
              ) : null}

              {showRecipe ? (
                <ModalSection title={t("products.recipe.title")} columns={2} {...section("recipe")}>
                  <div className="col-span-full">
                    {savedProduct && recipeReady ? (
                      <RecipePanel product={savedProduct} />
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        {t(
                          isEditing
                            ? "products.recipe.saveMethodFirst"
                            : "products.recipe.saveFirst",
                        )}
                      </p>
                    )}
                  </div>
                </ModalSection>
              ) : null}

              {savedProduct ? (
                <ModalSection
                  title={t("products.form.sections.accounting")}
                  description={t("products.accounting.description")}
                  columns={3}
                  {...section("accounting")}
                >
                  <ProductEffectiveDefaults productId={savedProduct.id} />
                </ModalSection>
              ) : null}

              {/* commission-policy.md A4 — only an existing agent-owned product carries a commission setting. */}
              {canSetOwnerAgent && savedProduct?.ownerAgentId && !showCommissionDraft ? (
                <ProductCommissionSection
                  key={`${savedProduct.id}:${savedProduct.ownerAgentId}`}
                  productId={savedProduct.id}
                />
              ) : null}
              {showCommissionDraft ? (
                <ProductCommissionDraftSection
                  value={commissionDraft}
                  onChange={setCommissionDraft}
                  showErrors={showDraftErrors}
                />
              ) : null}

              {savedProduct ? (
                <ModalSection
                  title={t("products.form.sections.investment")}
                  columns={2}
                  {...section("investment")}
                >
                  <ProductInvestmentLinksPanel productId={savedProduct.id} />
                </ModalSection>
              ) : null}

              <ModalSection
                title={t("products.form.sections.details")}
                columns={2}
                {...section("details")}
              >
                <ProductIdentityFields
                  barcodeDuplicate={barcodeDuplicate}
                  onBarcodeEdited={() => setBarcodeDuplicate(null)}
                  sourceProduct={sourceProduct}
                />
              </ModalSection>

              {savedProduct && effectiveItemType === "PRODUCT" ? (
                <ModalSection
                  title={t("products.tabs.variants")}
                  columns={3}
                  {...section("variants")}
                >
                  <ProductVariants productId={savedProduct.id} />
                </ModalSection>
              ) : null}

              {savedProduct ? (
                <ModalSection
                  title={t("products.tabs.attachments")}
                  columns={2}
                  {...section("attachments")}
                >
                  <ProductAttachments productId={savedProduct.id} />
                </ModalSection>
              ) : null}
            </FormCardStack>
          </div>
        </Form>
      </EnterpriseModal>

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
          useProductCategories.add(category);
          form.setValue("categoryId", category.id, { shouldDirty: true, shouldValidate: true });
        }}
      />
    </>
  );
}
