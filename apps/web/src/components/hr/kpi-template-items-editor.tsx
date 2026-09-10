"use client";

import { Plus, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseCard } from "@/components/ui/card";
import type {
  KpiAutoMetricSource,
  KpiDropdownOption,
  KpiEvaluatorSource,
  KpiItemType,
} from "@/services/kpi-templates-service";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export interface KpiTemplateItemDraft {
  /** Present for an existing item being edited in place; absent for a new one — mirrors `KpiTemplateItemInputDto`'s own "id present = update, absent = create" contract. */
  id?: string;
  criterionAr: string;
  criterionEn: string;
  weight: number | undefined;
  itemType: KpiItemType;
  evaluatorSource: KpiEvaluatorSource;
  autoMetricSource: KpiAutoMetricSource | "";
  dropdownOptions: KpiDropdownOption[];
  isActive: boolean;
}

const ITEM_TYPES: KpiItemType[] = [
  "YES_NO",
  "PERCENTAGE",
  "RATING_1_TO_5",
  "DROPDOWN",
  "AUTO_METRIC",
];
const EVALUATOR_SOURCES: KpiEvaluatorSource[] = ["MANAGER", "HR", "SYSTEM"];
const AUTO_METRIC_SOURCES: KpiAutoMetricSource[] = ["SALES_TARGET_ACHIEVEMENT"];

export const EMPTY_KPI_TEMPLATE_ITEM: KpiTemplateItemDraft = {
  criterionAr: "",
  criterionEn: "",
  weight: undefined,
  itemType: "PERCENTAGE",
  evaluatorSource: "MANAGER",
  autoMetricSource: "",
  dropdownOptions: [],
  isActive: true,
};

/**
 * KPI Template's weighted-criteria repeater — the same add/remove-rows
 * technique as `CompensationLinesEditor` (plain `useState`, not an RHF field
 * array), extended with per-row conditional fields: Auto Metric Source only
 * for `AUTO_METRIC`, a Dropdown Options mini-repeater only for `DROPDOWN`.
 * Includes a running weight-total readout for the active rows (the backend
 * — `KpiTemplatesService.assertWeightsSumTo100` — stays the authority; this
 * is guidance only, Save is never blocked locally).
 */
export function KpiTemplateItemsEditor({
  items,
  onChange,
}: {
  items: KpiTemplateItemDraft[];
  onChange: (items: KpiTemplateItemDraft[]) => void;
}) {
  const { t } = useLocale();

  const update = (index: number, patch: Partial<KpiTemplateItemDraft>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const add = () => onChange([...items, { ...EMPTY_KPI_TEMPLATE_ITEM }]);

  const updateOption = (
    itemIndex: number,
    optionIndex: number,
    patch: Partial<KpiDropdownOption>,
  ) => {
    const nextOptions = items[itemIndex].dropdownOptions.map((option, i) =>
      i === optionIndex ? { ...option, ...patch } : option,
    );
    update(itemIndex, { dropdownOptions: nextOptions });
  };
  const removeOption = (itemIndex: number, optionIndex: number) => {
    update(itemIndex, {
      dropdownOptions: items[itemIndex].dropdownOptions.filter((_, i) => i !== optionIndex),
    });
  };
  const addOption = (itemIndex: number) => {
    update(itemIndex, {
      dropdownOptions: [...items[itemIndex].dropdownOptions, { label: "", score: 0 }],
    });
  };

  const activeWeightTotal = items
    .filter((item) => item.isActive)
    .reduce((sum, item) => sum + (item.weight ?? 0), 0);
  const weightIsValid = Math.abs(activeWeightTotal - 100) < 0.01;

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <EnterpriseCard key={index} size="sm" className="gap-3 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                placeholder={t("hr.kpiTemplates.items.criterionAr")}
                value={item.criterionAr}
                onChange={(event) => update(index, { criterionAr: event.target.value })}
              />
              <Input
                placeholder={t("hr.kpiTemplates.items.criterionEn")}
                value={item.criterionEn}
                onChange={(event) => update(index, { criterionEn: event.target.value })}
              />
            </div>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.delete")}
              onClick={() => remove(index)}
            >
              <X className="size-4" />
            </EnterpriseButton>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Input
              type="number"
              placeholder={t("hr.kpiTemplates.items.weight")}
              value={item.weight ?? ""}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                update(index, { weight: Number.isNaN(raw) ? undefined : raw });
              }}
            />
            <Select
              value={item.itemType}
              onValueChange={(value) => update(index, { itemType: value as KpiItemType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("hr.kpiTemplates.items.itemType")} />
              </SelectTrigger>
              <SelectContent>
                {ITEM_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.kpiTemplates.itemType.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={item.evaluatorSource}
              onValueChange={(value) =>
                update(index, { evaluatorSource: value as KpiEvaluatorSource })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("hr.kpiTemplates.items.evaluatorSource")} />
              </SelectTrigger>
              <SelectContent>
                {EVALUATOR_SOURCES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.kpiTemplates.evaluatorSource.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 self-center">
              <Checkbox
                checked={item.isActive}
                onCheckedChange={(checked) => update(index, { isActive: !!checked })}
              />
              <span className="text-caption text-muted-foreground">
                {t("hr.kpiTemplates.fields.isActive")}
              </span>
            </div>
          </div>

          {item.itemType === "AUTO_METRIC" && (
            <Select
              value={item.autoMetricSource || undefined}
              onValueChange={(value) =>
                update(index, { autoMetricSource: value as KpiAutoMetricSource })
              }
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder={t("hr.kpiTemplates.items.autoMetricSource")} />
              </SelectTrigger>
              <SelectContent>
                {AUTO_METRIC_SOURCES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.kpiTemplates.autoMetricSource.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {item.itemType === "DROPDOWN" && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <p className="text-caption font-medium text-muted-foreground">
                {t("hr.kpiTemplates.items.dropdownOptions")}
              </p>
              {item.dropdownOptions.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <Input
                    placeholder={t("hr.kpiTemplates.items.optionLabel")}
                    value={option.label}
                    onChange={(event) =>
                      updateOption(index, optionIndex, { label: event.target.value })
                    }
                  />
                  <Input
                    type="number"
                    className="w-28 shrink-0"
                    placeholder={t("hr.kpiTemplates.items.optionScore")}
                    value={option.score}
                    onChange={(event) => {
                      const raw = event.target.valueAsNumber;
                      updateOption(index, optionIndex, { score: Number.isNaN(raw) ? 0 : raw });
                    }}
                  />
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("common.delete")}
                    onClick={() => removeOption(index, optionIndex)}
                  >
                    <X className="size-4" />
                  </EnterpriseButton>
                </div>
              ))}
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addOption(index)}
                className="self-start"
              >
                <Plus />
                {t("hr.kpiTemplates.items.addOption")}
              </EnterpriseButton>
            </div>
          )}
        </EnterpriseCard>
      ))}

      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="self-start"
      >
        <Plus />
        {t("hr.kpiTemplates.items.addItem")}
      </EnterpriseButton>

      <div
        className={cn(
          "flex items-center justify-between rounded-md border px-3 py-2 text-body font-medium",
          weightIsValid
            ? "border-border text-muted-foreground"
            : "border-destructive/40 bg-destructive/10 text-destructive",
        )}
      >
        <span>{t("hr.kpiTemplates.items.totalWeight")}</span>
        <span>{activeWeightTotal.toFixed(2)}%</span>
      </div>
      {!weightIsValid && (
        <p className="text-caption text-destructive">
          {t("hr.kpiTemplates.items.weightMustTotal100")}
        </p>
      )}
    </div>
  );
}
