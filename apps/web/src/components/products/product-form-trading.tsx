"use client";

import { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { FormCardRow, FormCardSection } from "@/components/shared/form-card/form-card";
import { ReferenceSelectField, SwitchRow } from "@/components/products/product-form-fields";
import { agentOptionLabel, useAgentOptions } from "@/components/agents/agent-options";
import {
  SUPPLY_METHODS,
  investmentSwitchState,
  stockTrackingState,
  supplyMethodVisible,
  type InvestmentBlockedReason,
  type ItemType,
  type SupplyMethod,
} from "@/config/products/attribute-rules";
import { INVESTMENT_REASON_KEYS } from "@/config/products/product-errors";
import type { ProductFormValues } from "@/config/products/schema";
import type { ProductRow } from "@/services/products-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

type InvestmentFormSlice = Pick<
  ProductFormValues,
  "itemType" | "isSellable" | "status" | "ownership" | "availableForInvestmentOpportunities"
>;

/**
 * The investor-eligibility switch state for the form's current values — one
 * function for the section (what is shown) and the submit (what is sent), so a
 * blocked flag is never newly sent as ON. Staff who cannot choose an owner
 * still need the rule to know an existing agent-owned product.
 */
export function investmentStateFor(
  values: InvestmentFormSlice,
  context: { canSetOwnerAgent: boolean; sourceProduct: ProductRow | null },
) {
  const { canSetOwnerAgent, sourceProduct } = context;
  return investmentSwitchState(
    {
      isAgentOwned: canSetOwnerAgent
        ? values.ownership === "AGENT"
        : Boolean(sourceProduct?.ownerAgentId),
      itemType: (values.itemType || null) as ItemType | null,
      isSellable: values.isSellable,
      status: values.status,
      archived: Boolean(sourceProduct?.deletedAt),
    },
    values.availableForInvestmentOpportunities,
    Boolean(sourceProduct?.availableForInvestmentOpportunities),
  );
}

/**
 * "How it is traded and stocked": the independent attributes of a product
 * (spec §2) — can be sold, can be purchased (two separate switches, never a
 * Sale-or-Purchase choice), track stock, supply method, ownership and investor
 * eligibility. A value another attribute forces is shown disabled WITH its
 * one-line reason, never silently dropped (`attribute-rules.ts` decides).
 */
export function ProductTradingSection({
  sourceProduct,
  onSupplyMethodChange,
  investmentApiReason,
}: {
  /** The loaded product (edit) — the stored investor flag and owner label. */
  sourceProduct: ProductRow | null;
  onSupplyMethodChange: (supplyMethod: SupplyMethod) => void;
  /** A reason the server refused eligibility with (422) — shown even when the form's own rules did not predict it. */
  investmentApiReason: InvestmentBlockedReason | null;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const { control, setValue, clearErrors } = useFormContext<ProductFormValues>();
  const canSetOwnerAgent = hasPermission("agents.view");
  const { agents } = useAgentOptions();

  const [
    itemType,
    supplyMethod,
    isSellable,
    isPurchasable,
    isInventoryItem,
    ownership,
    status,
    investmentFlag,
  ] = useWatch({
    control,
    name: [
      "itemType",
      "supplyMethod",
      "isSellable",
      "isPurchasable",
      "isInventoryItem",
      "ownership",
      "status",
      "availableForInvestmentOpportunities",
    ],
  });

  const effectiveItemType = (itemType || "PRODUCT") as ItemType;
  const tracking = stockTrackingState({
    itemType: effectiveItemType,
    isInventoryItem,
    supplyMethod: supplyMethod as SupplyMethod,
  });

  const investment = investmentStateFor(
    {
      itemType,
      isSellable,
      status,
      ownership,
      availableForInvestmentOpportunities: investmentFlag,
    },
    { canSetOwnerAgent, sourceProduct },
  );
  const blockedReason = investment.blockedReason ?? investmentApiReason;

  const agentOptions = useMemo(
    () =>
      agents.map((agent) => ({
        value: agent.id,
        label: agentOptionLabel(agent),
        searchText: agent.agentNumber,
      })),
    [agents],
  );
  const owner = sourceProduct?.ownerAgent;

  const setFlag = (name: "isSellable" | "isPurchasable", value: boolean) =>
    setValue(name, value, { shouldDirty: true });

  return (
    <FormCardSection title={t("products.form.sections.trading")}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <SwitchRow
          id="product-can-sell"
          label={t("products.attr.canSell")}
          checked={isSellable}
          onCheckedChange={(value) => setFlag("isSellable", value)}
        />
        <SwitchRow
          id="product-can-purchase"
          label={t("products.attr.canPurchase")}
          checked={isPurchasable}
          onCheckedChange={(value) => setFlag("isPurchasable", value)}
        />
        {tracking.visible ? (
          <SwitchRow
            id="product-track-stock"
            label={t("products.attr.trackStock")}
            checked={tracking.value}
            disabled={tracking.locked}
            onCheckedChange={(value) => setValue("isInventoryItem", value, { shouldDirty: true })}
            note={
              tracking.reason
                ? t(`products.attr.trackStockReason.${tracking.reason}`)
                : t("products.attr.trackStockHint")
            }
          />
        ) : (
          <p className="text-caption text-muted-foreground">{t("products.attr.serviceNoStock")}</p>
        )}
      </div>

      {itemType && supplyMethodVisible(effectiveItemType) ? (
        <div className="flex min-w-0 flex-col gap-1">
          <Label>{t("products.attr.supplyMethod.label")}</Label>
          <SegmentedRadioGroup<SupplyMethod>
            aria-label={t("products.attr.supplyMethod.label")}
            value={supplyMethod as SupplyMethod}
            onValueChange={onSupplyMethodChange}
            options={SUPPLY_METHODS.map((value) => ({
              value,
              label: t(`products.attr.supplyMethod.${value}`),
            }))}
          />
          <p className="text-caption text-muted-foreground">
            {t("products.attr.supplyMethod.help")}
          </p>
        </div>
      ) : null}

      {canSetOwnerAgent ? (
        <FormCardRow>
          <div className="flex min-w-0 flex-col gap-1" data-size="md">
            <Label>{t("agentPricing.ownership.label")}</Label>
            <SegmentedRadioGroup<"COMPANY" | "AGENT">
              aria-label={t("agentPricing.ownership.label")}
              value={ownership}
              onValueChange={(next) => {
                setValue("ownership", next, { shouldDirty: true });
                if (next === "COMPANY") setValue("ownerAgentId", "", { shouldDirty: true });
                clearErrors("ownerAgentId");
              }}
              options={(["COMPANY", "AGENT"] as const).map((value) => ({
                value,
                label: t(`agentPricing.ownership.${value}`),
              }))}
            />
            <p className="text-caption text-muted-foreground">{t("agentPricing.ownership.hint")}</p>
          </div>
          {ownership === "AGENT" ? (
            <ReferenceSelectField
              name="ownerAgentId"
              label={t("agentPricing.ownership.agent")}
              required
              dataSize="md"
              options={agentOptions}
              selectedLabel={
                owner
                  ? owner.agentNumber
                    ? agentOptionLabel({ name: owner.name, agentNumber: owner.agentNumber })
                    : owner.name
                  : undefined
              }
              onValueChange={() => clearErrors("ownerAgentId")}
            />
          ) : null}
        </FormCardRow>
      ) : null}

      <SwitchRow
        id="product-investor"
        label={t("products.attr.investor")}
        checked={investment.value}
        disabled={investment.disabled}
        onCheckedChange={(value) =>
          setValue("availableForInvestmentOpportunities", value, { shouldDirty: true })
        }
        note={
          blockedReason
            ? t(INVESTMENT_REASON_KEYS[blockedReason])
            : t("products.fields.availableForInvestmentOpportunitiesHint")
        }
        noteTone={blockedReason ? "warning" : "muted"}
      />
    </FormCardSection>
  );
}
