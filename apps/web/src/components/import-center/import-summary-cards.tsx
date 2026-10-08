"use client";

import { CheckCircle2, CircleSlash, Copy, FilePlus2, ListChecks, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { InsightCard, InsightGroup, type InsightTone } from "@/components/shared/insight-card";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { ImportJobSummary, ImportPreviewSummary } from "@/services/import-jobs-service";

interface SummaryItem {
  key: string;
  labelKey: MessageKey;
  value: number;
  tone: InsightTone;
  icon: LucideIcon;
}

/** Preview: what the run would do with each row (same checks as the run). */
export function previewSummaryItems(summary: ImportPreviewSummary): SummaryItem[] {
  return [
    {
      key: "new",
      labelKey: "salesImport.summary.new",
      value: summary.newCount,
      tone: "success",
      icon: FilePlus2,
    },
    {
      key: "skipped",
      labelKey: "salesImport.summary.skipped",
      value: summary.skippedCount,
      tone: "info",
      icon: CircleSlash,
    },
    {
      key: "review",
      labelKey: "salesImport.summary.needsReview",
      value: summary.needsReviewCount,
      tone: "warning",
      icon: ListChecks,
    },
    {
      key: "invalid",
      labelKey: "salesImport.summary.rejected",
      value: summary.invalidCount,
      tone: "destructive",
      icon: XCircle,
    },
    ...(summary.duplicateCount > 0
      ? [
          {
            key: "duplicate",
            labelKey: "salesImport.summary.duplicate" as MessageKey,
            value: summary.duplicateCount,
            tone: "warning" as const,
            icon: Copy,
          },
        ]
      : []),
  ];
}

/** Result: created / skipped (already imported) / needs review / rejected. */
export function resultSummaryItems(summary: ImportJobSummary): SummaryItem[] {
  return [
    {
      key: "created",
      labelKey: "salesImport.summary.created",
      value: summary.created,
      tone: "success",
      icon: CheckCircle2,
    },
    {
      key: "skipped",
      labelKey: "salesImport.summary.skipped",
      value: summary.skipped,
      tone: "info",
      icon: CircleSlash,
    },
    {
      key: "review",
      labelKey: "salesImport.summary.needsReview",
      value: summary.needsReview,
      tone: "warning",
      icon: ListChecks,
    },
    {
      key: "rejected",
      labelKey: "salesImport.summary.rejected",
      value: summary.rejected,
      tone: "destructive",
      icon: XCircle,
    },
  ];
}

/**
 * R15 (spec §8) — an import's row buckets as dashboard summary cards
 * (`InsightCard`, design-system §12.8): two per row on a phone, one line on a
 * desktop. A zero bucket renders neutral (no false alarm).
 */
export function ImportSummaryCards({ items }: { items: SummaryItem[] }) {
  const { t, direction } = useLocale();
  return (
    <InsightGroup className="grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <InsightCard
          key={item.key}
          label={t(item.labelKey)}
          value={<span className="num">{item.value}</span>}
          amount={item.value}
          tone={item.tone}
          icon={item.icon}
          direction={direction}
        />
      ))}
    </InsightGroup>
  );
}
