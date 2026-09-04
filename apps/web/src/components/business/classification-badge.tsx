"use client";

import { cn } from "@/lib/utils";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

export const CLASSIFICATION_COLOR_TOKENS = [
  "neutral",
  "info",
  "warning",
  "success",
  "destructive",
] as const;

export type ClassificationColorToken = (typeof CLASSIFICATION_COLOR_TOKENS)[number];

const TOKEN_SWATCH: Record<ClassificationColorToken, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  destructive: "bg-destructive",
};

export function ClassificationColorPicker({
  value,
  onChange,
  previewLabel,
}: {
  value: string;
  onChange: (token: ClassificationColorToken) => void;
  previewLabel?: string;
}) {
  const { t } = useLocale();
  const token = (CLASSIFICATION_COLOR_TOKENS as readonly string[]).includes(value)
    ? (value as ClassificationColorToken)
    : "neutral";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {CLASSIFICATION_COLOR_TOKENS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={t(`masterData.colors.${option}` as MessageKey)}
            title={t(`masterData.colors.${option}` as MessageKey)}
            onClick={() => onChange(option)}
            className={cn(
              "flex size-8 items-center justify-center rounded-sm border",
              token === option ? "border-foreground ring-2 ring-ring/40" : "border-border",
            )}
          >
            <span className={cn("size-4 rounded-full", TOKEN_SWATCH[option])} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted-foreground">
          {t("masterData.customerClassifications.preview")}
        </span>
        <ClassificationBadge label={previewLabel || "—"} color={token} />
      </div>
    </div>
  );
}

export function ClassificationBadge({ label, color }: { label: string; color?: string | null }) {
  const token = (CLASSIFICATION_COLOR_TOKENS as readonly string[]).includes(color ?? "")
    ? (color as ClassificationColorToken)
    : "neutral";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span className={cn("size-2 shrink-0 rounded-full", TOKEN_SWATCH[token])} aria-hidden />
      <DynamicStatusBadge label={label} colorKey={token} />
    </span>
  );
}
