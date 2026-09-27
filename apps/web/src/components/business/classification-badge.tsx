"use client";

import { cn } from "@/lib/utils";
import { StatusBadge, STATUS_TONE_DOT_CLASS } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
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

const TOKEN_SWATCH: Record<ClassificationColorToken, string> = STATUS_TONE_DOT_CLASS;

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
          <EnterpriseButton
            key={option}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(`masterData.colors.${option}` as MessageKey)}
            title={t(`masterData.colors.${option}` as MessageKey)}
            onClick={() => onChange(option)}
            className={cn(
              "border",
              token === option ? "border-foreground ring-2 ring-focus-ring" : "border-border",
            )}
          >
            <span className={cn("size-4 rounded-full", TOKEN_SWATCH[option])} />
          </EnterpriseButton>
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

/** Customer classification chip — the shared StatusBadge in its `dot` variant. */
export function ClassificationBadge({ label, color }: { label: string; color?: string | null }) {
  const token = (CLASSIFICATION_COLOR_TOKENS as readonly string[]).includes(color ?? "")
    ? (color as ClassificationColorToken)
    : "neutral";
  return <StatusBadge label={label} tone={token} dot />;
}
