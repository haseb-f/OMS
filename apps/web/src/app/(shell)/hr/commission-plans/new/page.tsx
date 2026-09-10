"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditorWorkspace, EditorHeader, DetailSection } from "@/components/shared/detail-workspace";
import { ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CommissionPlanTiersEditor,
  EMPTY_TIER_DRAFT,
  type CommissionPlanTierDraft,
} from "@/components/hr/commission-plan-tiers-editor";
import {
  commissionPlansService,
  type CommissionBasis,
  type CommissionRuleType,
} from "@/services/commission-plans-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const BASIS_VALUES: CommissionBasis[] = ["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"];
const RULE_TYPES: CommissionRuleType[] = ["FLAT_PERCENTAGE", "ACHIEVEMENT_TIER", "FIXED_BONUS"];

export default function NewCommissionPlanPage() {
  const { t } = useLocale();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState<CommissionBasis>("COLLECTED_SALES");
  const [ruleType, setRuleType] = useState<CommissionRuleType>("FLAT_PERCENTAGE");
  const [tiers, setTiers] = useState<CommissionPlanTierDraft[]>([{ ...EMPTY_TIER_DRAFT }]);
  const [isSaving, setIsSaving] = useState(false);

  const changeRuleType = (value: CommissionRuleType) => {
    setRuleType(value);
    if (value === "FLAT_PERCENTAGE") {
      setTiers([{ ...tiers[0], minAchievementPercent: 0, maxAchievementPercent: undefined }]);
    } else if (tiers.length === 0) {
      setTiers([{ ...EMPTY_TIER_DRAFT }]);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error(t("common.failedToSave"));
      return;
    }
    for (const tier of tiers) {
      if (tier.minAchievementPercent === undefined) {
        toast.error(t("common.failedToSave"));
        return;
      }
      if (ruleType === "FIXED_BONUS" && tier.fixedAmount === undefined) {
        toast.error(t("common.failedToSave"));
        return;
      }
      if (ruleType !== "FIXED_BONUS" && tier.percentage === undefined) {
        toast.error(t("common.failedToSave"));
        return;
      }
    }
    setIsSaving(true);
    try {
      const plan = await commissionPlansService.create({
        name,
        description: description || undefined,
        basis,
        ruleType,
        tiers: tiers.map((tier, index) => ({
          minAchievementPercent: tier.minAchievementPercent ?? 0,
          maxAchievementPercent: tier.maxAchievementPercent,
          percentage: ruleType === "FIXED_BONUS" ? undefined : tier.percentage,
          fixedAmount: ruleType === "FIXED_BONUS" ? tier.fixedAmount : undefined,
          sortOrder: index,
        })),
      });
      toast.success(t("hr.commissionPlans.toasts.saved"));
      router.push(`/hr/commission-plans/${plan.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorWorkspace>
      <EditorHeader
        title={t("hr.commissionPlans.addNew")}
        actions={
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        }
      />
      <div className="flex flex-col gap-3">
        <ModalSection title={t("common.generalInformation")} columns={2}>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-caption font-medium">
              {t("hr.commissionPlans.fields.name")}
            </label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-caption font-medium">
              {t("hr.commissionPlans.fields.description")}
            </label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.commissionPlans.fields.basis")}
            </label>
            <Select value={basis} onValueChange={(value) => setBasis(value as CommissionBasis)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASIS_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.commissionPlans.basis.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-caption font-medium">
              {t("hr.commissionPlans.fields.ruleType")}
            </label>
            <Select
              value={ruleType}
              onValueChange={(value) => changeRuleType(value as CommissionRuleType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.commissionPlans.ruleType.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </ModalSection>

        <DetailSection title={t("hr.commissionPlans.tiers.title")}>
          <CommissionPlanTiersEditor ruleType={ruleType} tiers={tiers} onChange={setTiers} />
        </DetailSection>
      </div>
    </EditorWorkspace>
  );
}
