"use client";

import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { FieldMessage } from "@/components/ui/form";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { ORDER_ATTACHMENT_ACCEPT, validateOrderAttachmentFile } from "@/lib/order-attachments";

export function FileDropField({
  files,
  onFilesChange,
  disabled,
  error,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const reject = (code: "empty" | "type" | "size") => {
    setLocalError(t(`storeOrders.detail.receipts.errors.${code}`));
  };

  const addFiles = (list: FileList | File[]) => {
    const next = [...files];
    for (const file of Array.from(list)) {
      const reason = validateOrderAttachmentFile(file);
      if (reason) {
        reject(reason);
        continue;
      }
      next.push(file);
    }
    setLocalError(null);
    onFilesChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border border-dashed border-border/80 bg-muted/20 p-3",
          dragOver && "border-primary bg-primary/5",
          error && "border-destructive/40 bg-destructive/5",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (!disabled) addFiles(event.dataTransfer.files);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <FileUp className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-caption text-muted-foreground">
            {t("storeOrders.detail.receipts.dropHint")}
          </p>
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {t("storeOrders.detail.receipts.chooseFiles")}
          </EnterpriseButton>
          <input
            ref={inputRef}
            type="file"
            accept={ORDER_ATTACHMENT_ACCEPT}
            multiple
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {files.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate" dir="ltr">
                  {file.name}
                </span>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common.remove")}
                  disabled={disabled}
                  onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                >
                  <X className="size-3.5" />
                </EnterpriseButton>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <FieldMessage>{error ?? localError}</FieldMessage>
    </div>
  );
}
