"use client";

import { Plus, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/providers/locale-provider";
import type { CommissionRuleType } from "@/services/commission-plans-service";

export interface CommissionPlanTierDraft {
  minAchievementPercent: number | undefined;
  maxAchievementPercent: number | undefined;
  percentage: number | undefined;
  fixedAmount: number | undefined;
}

export const EMPTY_TIER_DRAFT: CommissionPlanTierDraft = {
  minAchievementPercent: 0,
  maxAchievementPercent: undefined,
  percentage: undefined,
  fixedAmount: undefined,
};

/**
 * The Commission Plan tiers repeater (Part T) — same add/remove-via-plain-
 * useState technique as `CompensationLinesEditor`, never react-hook-form
 * field arrays. Which inputs render per row depends on the parent Plan's
 * `ruleType`: FLAT_PERCENTAGE is a single fixed row using only `percentage`
 * (no achievement bands, no add/remove); ACHIEVEMENT_TIER is 1+ bands each
 * using `percentage`; FIXED_BONUS is 1+ bands each using `fixedAmount`
 * instead.
 */
export function CommissionPlanTiersEditor({
  ruleType,
  tiers,
  onChange,
}: {
  ruleType: CommissionRuleType;
  tiers: CommissionPlanTierDraft[];
  onChange: (tiers: CommissionPlanTierDraft[]) => void;
}) {
  const { t } = useLocale();

  const update = (index: number, patch: Partial<CommissionPlanTierDraft>) => {
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };
  const remove = (index: number) => onChange(tiers.filter((_, i) => i !== index));
  const add = () => onChange([...tiers, { ...EMPTY_TIER_DRAFT }]);

  const isFlat = ruleType === "FLAT_PERCENTAGE";
  const showBands = !isFlat;
  const showPercentage = ruleType !== "FIXED_BONUS";
  const showFixedAmount = ruleType === "FIXED_BONUS";

  return (
    <div className="flex flex-col gap-2">
      {tiers.map((tier, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {showBands && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted-foreground">
                  {t("hr.commissionPlans.tiers.minAchievementPercent")}
                </span>
                <Input
                  type="number"
                  min={0}
                  className="w-28"
                  value={tier.minAchievementPercent ?? ""}
                  onChange={(event) => {
                    const raw = event.target.valueAsNumber;
                    update(index, { minAchievementPercent: Number.isNaN(raw) ? undefined : raw });
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted-foreground">
                  {t("hr.commissionPlans.tiers.maxAchievementPercent")}
                </span>
                <Input
                  type="number"
                  min={0}
                  className="w-28"
                  placeholder={t("hr.commissionPlans.tiers.openEnded")}
                  value={tier.maxAchievementPercent ?? ""}
                  onChange={(event) => {
                    const raw = event.target.valueAsNumber;
                    update(index, { maxAchievementPercent: Number.isNaN(raw) ? undefined : raw });
                  }}
                />
              </div>
            </>
          )}
          {showPercentage && (
            <div className="flex flex-col gap-1">
              <span className="text-micro text-muted-foreground">
                {t("hr.commissionPlans.tiers.percentage")}
              </span>
              <Input
                type="number"
                min={0}
                className="w-24"
                value={tier.percentage ?? ""}
                onChange={(event) => {
                  const raw = event.target.valueAsNumber;
                  update(index, { percentage: Number.isNaN(raw) ? undefined : raw });
                }}
              />
            </div>
          )}
          {showFixedAmount && (
            <div className="flex flex-col gap-1">
              <span className="text-micro text-muted-foreground">
                {t("hr.commissionPlans.tiers.fixedAmount")}
              </span>
              <Input
                type="number"
                min={0}
                className="w-28"
                value={tier.fixedAmount ?? ""}
                onChange={(event) => {
                  const raw = event.target.valueAsNumber;
                  update(index, { fixedAmount: Number.isNaN(raw) ? undefined : raw });
                }}
              />
            </div>
          )}
          {!isFlat && tiers.length > 1 && (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ms-auto"
              aria-label={t("common.delete")}
              onClick={() => remove(index)}
            >
              <X className="size-4" />
            </EnterpriseButton>
          )}
        </div>
      ))}
      {!isFlat && (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="self-start"
        >
          <Plus />
          {t("hr.commissionPlans.tiers.addTier")}
        </EnterpriseButton>
      )}
    </div>
  );
}
