"use client";

import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/business/status-badge";
import type {
  KpiDropdownOption,
  KpiEvaluationItemRow,
  ScoreKpiItemPayload,
} from "@/services/kpi-evaluations-service";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

const RATING_VALUES = [1, 2, 3, 4, 5] as const;

function formatScore(value: string | null) {
  return value === null ? "—" : `${Number(value).toFixed(1)}%`;
}

/**
 * One KPI Evaluation criterion's scoring row — the control matches the
 * item's snapshotted type (Part K: YES_NO/PERCENTAGE/RATING_1_TO_5/
 * DROPDOWN are manual, AUTO_METRIC is system-computed and never manually
 * scoreable — `KpiEvaluationsService.normalizeScore`/`assertCanScore` both
 * throw if attempted). Local draft state only, committed with one explicit
 * Save action per row (no per-keystroke autosave) so the score + comment
 * always reach the backend together, matching `ScoreKpiItemDto`'s shape.
 */
export function KpiEvaluationItemCard({
  item,
  dropdownOptions,
  disabled,
  isSaving,
  onSave,
  onRecompute,
  isRecomputing,
}: {
  item: KpiEvaluationItemRow;
  /** Resolved from the parent template's `KpiTemplateItem.dropdownOptions` — the evaluation item snapshot itself does not carry this (see `KpiEvaluationItem` schema: no `dropdownOptions` column). */
  dropdownOptions: KpiDropdownOption[];
  disabled: boolean;
  isSaving: boolean;
  onSave: (payload: ScoreKpiItemPayload) => void;
  onRecompute: () => void;
  isRecomputing: boolean;
}) {
  const { t } = useLocale();

  const [yesNo, setYesNo] = useState(item.rawValue?.yesNo ?? false);
  const [percentage, setPercentage] = useState<number | undefined>(item.rawValue?.percentage);
  const [rating, setRating] = useState<number | undefined>(item.rawValue?.rating);
  const [dropdownLabel, setDropdownLabel] = useState(item.rawValue?.dropdownLabel ?? "");
  const [comment, setComment] = useState(item.comment ?? "");

  const isAutoMetric = item.itemTypeSnapshot === "AUTO_METRIC";

  const isDirty = (() => {
    if (comment !== (item.comment ?? "")) return true;
    switch (item.itemTypeSnapshot) {
      case "YES_NO":
        return yesNo !== (item.rawValue?.yesNo ?? false);
      case "PERCENTAGE":
        return percentage !== item.rawValue?.percentage;
      case "RATING_1_TO_5":
        return rating !== item.rawValue?.rating;
      case "DROPDOWN":
        return dropdownLabel !== (item.rawValue?.dropdownLabel ?? "");
      default:
        return false;
    }
  })();

  const save = () => {
    switch (item.itemTypeSnapshot) {
      case "YES_NO":
        onSave({ yesNo, comment: comment || undefined });
        return;
      case "PERCENTAGE":
        onSave({ percentage, comment: comment || undefined });
        return;
      case "RATING_1_TO_5":
        onSave({ rating: rating as 1 | 2 | 3 | 4 | 5 | undefined, comment: comment || undefined });
        return;
      case "DROPDOWN":
        onSave({ dropdownLabel: dropdownLabel || undefined, comment: comment || undefined });
        return;
      default:
        return;
    }
  };

  return (
    <EnterpriseCard size="sm" className="gap-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body font-medium">{item.criterionArSnapshot}</p>
          <p className="text-caption text-muted-foreground">
            {t("hr.kpiTemplates.items.weight")}: {Number(item.weightSnapshot).toFixed(2)}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge
            tone="neutral"
            label={t(`hr.kpiTemplates.evaluatorSource.${item.evaluatorSourceSnapshot}`)}
          />
          {item.normalizedScore !== null && (
            <StatusBadge
              tone="info"
              label={`${t("hr.kpiEvaluations.scoring.normalizedScore")}: ${formatScore(item.normalizedScore)}`}
            />
          )}
        </div>
      </div>

      {isAutoMetric ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
          <p className="text-body">
            {item.rawValue?.autoMetricValue != null
              ? `${Number(item.rawValue.autoMetricValue).toFixed(2)}%`
              : "—"}
          </p>
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || isRecomputing}
            onClick={onRecompute}
          >
            <RefreshCw className={cn("size-3.5", isRecomputing && "animate-spin")} />
            {t("hr.kpiEvaluations.scoring.recompute")}
          </EnterpriseButton>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          {item.itemTypeSnapshot === "YES_NO" && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={yesNo}
                onCheckedChange={(checked) => setYesNo(!!checked)}
                disabled={disabled}
              />
              <span className="text-body">
                {yesNo
                  ? t("hr.kpiEvaluations.scoring.yesNoYes")
                  : t("hr.kpiEvaluations.scoring.yesNoNo")}
              </span>
            </div>
          )}

          {item.itemTypeSnapshot === "PERCENTAGE" && (
            <Input
              type="number"
              min={0}
              max={100}
              className="w-32"
              value={percentage ?? ""}
              disabled={disabled}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                setPercentage(Number.isNaN(raw) ? undefined : raw);
              }}
            />
          )}

          {item.itemTypeSnapshot === "RATING_1_TO_5" && (
            <div className="flex items-center gap-1.5">
              {RATING_VALUES.map((value) => (
                <EnterpriseButton
                  key={value}
                  type="button"
                  size="icon-sm"
                  variant={rating === value ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => setRating(value)}
                >
                  {value}
                </EnterpriseButton>
              ))}
            </div>
          )}

          {item.itemTypeSnapshot === "DROPDOWN" && (
            <Select
              value={dropdownLabel || undefined}
              onValueChange={setDropdownLabel}
              disabled={disabled}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder={t("hr.kpiTemplates.items.dropdownOptions")} />
              </SelectTrigger>
              <SelectContent>
                {dropdownOptions.map((option) => (
                  <SelectItem key={option.label} value={option.label}>
                    {option.label} ({option.score}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Textarea
            placeholder={t("hr.kpiEvaluations.scoring.commentLabel")}
            value={comment}
            disabled={disabled}
            onChange={(event) => setComment(event.target.value)}
          />

          <EnterpriseButton
            type="button"
            size="sm"
            className="self-end"
            disabled={disabled || !isDirty || isSaving}
            onClick={save}
          >
            <Check className="size-3.5" />
            {t("common.save")}
          </EnterpriseButton>
        </div>
      )}
    </EnterpriseCard>
  );
}
