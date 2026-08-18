"use client";

import { Link2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EnterpriseButton } from "@/components/ui/button";
import { FieldMessage } from "@/components/ui/form";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Compact URL attachment — OMS has no binary upload pipeline. Receipts and
 * product attachments are stored as a pasted URL + display name, same as
 * Store Order detail and Product attachments.
 */
export function FileUrlField({
  fileName,
  fileUrl,
  onFileNameChange,
  onFileUrlChange,
  onClear,
  disabled,
  namePlaceholder,
  urlPlaceholder,
  error,
}: {
  fileName: string;
  fileUrl: string;
  onFileNameChange: (value: string) => void;
  onFileUrlChange: (value: string) => void;
  onClear?: () => void;
  disabled?: boolean;
  namePlaceholder?: string;
  urlPlaceholder?: string;
  error?: string | null;
}) {
  const { t } = useLocale();
  const filled = Boolean(fileName.trim() || fileUrl.trim());

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border border-dashed border-border/80 bg-muted/20 p-3 transition-[border-color,background-color] duration-(--duration-base)",
          filled && "border-solid border-border bg-card",
          error && "border-destructive/40 bg-destructive/5",
        )}
      >
        <div className="flex items-center gap-2">
          <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={fileName}
            onChange={(event) => onFileNameChange(event.target.value)}
            placeholder={namePlaceholder}
            disabled={disabled}
            inputSize="sm"
            className="flex-1"
          />
          {onClear && filled ? (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.remove")}
              onClick={onClear}
              disabled={disabled}
            >
              <X className="size-3.5" />
            </EnterpriseButton>
          ) : null}
        </div>
        <Input
          value={fileUrl}
          onChange={(event) => onFileUrlChange(event.target.value)}
          placeholder={urlPlaceholder}
          disabled={disabled}
          inputSize="sm"
          dir="ltr"
          inputMode="url"
        />
      </div>
      <FieldMessage>{error}</FieldMessage>
    </div>
  );
}
