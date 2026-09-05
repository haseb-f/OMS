"use client";

import { FileText, Image as ImageIcon, Loader2, RotateCcw, X } from "lucide-react";
import { FileDropField } from "@/components/shared/form-fields";
import { EnterpriseButton } from "@/components/ui/button";
import { attachmentsService, type StagingAttachment } from "@/services/attachments-service";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { formatFileSize } from "@/lib/format-file-size";
import { isImageAttachmentMime } from "@/lib/order-attachments";
import { toast } from "@/lib/toast";

export type ReceiptUploadItem = {
  localId: string;
  file: File;
  status: "uploading" | "success" | "error";
  staging?: StagingAttachment;
  error?: string;
};

export function PaymentReceiptsField({
  items,
  onChange,
  disabled,
  visible = true,
}: {
  items: ReceiptUploadItem[];
  onChange: (items: ReceiptUploadItem[]) => void;
  disabled?: boolean;
  visible?: boolean;
}) {
  const { t } = useLocale();

  if (!visible) return null;

  const uploadFiles = async (files: File[]) => {
    const next = [...items];
    for (const file of files) {
      const localId = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      const row: ReceiptUploadItem = { localId, file, status: "uploading" };
      next.push(row);
      onChange([...next]);
      try {
        const staging = await attachmentsService.uploadStaging(file);
        row.status = "success";
        row.staging = staging;
      } catch (error) {
        row.status = "error";
        row.error =
          error instanceof ApiError ? error.message : t("storeOrders.detail.receipts.attachFailed");
      }
      onChange([...next]);
    }
  };

  const remove = async (localId: string) => {
    const row = items.find((item) => item.localId === localId);
    if (row?.staging) {
      await attachmentsService.discardStaging(row.staging.id).catch(() => undefined);
    }
    onChange(items.filter((item) => item.localId !== localId));
  };

  const retry = async (localId: string) => {
    const row = items.find((item) => item.localId === localId);
    if (!row) return;
    onChange(
      items.map((item) =>
        item.localId === localId ? { ...item, status: "uploading", error: undefined } : item,
      ),
    );
    try {
      const staging = await attachmentsService.uploadStaging(row.file);
      onChange(
        items.map((item) =>
          item.localId === localId
            ? { ...item, status: "success", staging, error: undefined }
            : item,
        ),
      );
    } catch (error) {
      onChange(
        items.map((item) =>
          item.localId === localId
            ? {
                ...item,
                status: "error",
                error:
                  error instanceof ApiError
                    ? error.message
                    : t("storeOrders.detail.receipts.attachFailed"),
              }
            : item,
        ),
      );
      toast.error(t("storeOrders.detail.receipts.attachFailed"));
    }
  };

  return (
    <div className="col-span-full flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium">{t("crm.leads.convert.paymentProof")}</p>
        <p className="text-caption text-muted-foreground">
          {t("storeOrders.detail.receipts.acceptedTypes")}
        </p>
      </div>
      <FileDropField
        files={[]}
        onFilesChange={(files) => {
          if (files.length > 0) void uploadFiles(files);
        }}
        disabled={disabled}
      />
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.localId}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              {isImageAttachmentMime(item.file.type) ? (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" dir="ltr">
                  {item.file.name}
                </p>
                <p className="text-caption text-muted-foreground">
                  {[
                    item.file.type.includes("pdf")
                      ? "PDF"
                      : item.file.type.replace("image/", "").toUpperCase(),
                    formatFileSize(item.file.size),
                    item.status === "uploading"
                      ? t("storeOrders.detail.receipts.uploading", { name: item.file.name })
                      : item.status === "success"
                        ? t("storeOrders.detail.receipts.uploadSuccess")
                        : t("storeOrders.detail.receipts.uploadFailed"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {item.error ? <p className="text-caption text-destructive">{item.error}</p> : null}
              </div>
              {item.status === "uploading" ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : null}
              {item.status === "error" ? (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("storeOrders.detail.receipts.retry")}
                  onClick={() => void retry(item.localId)}
                >
                  <RotateCcw className="size-3.5" />
                </EnterpriseButton>
              ) : null}
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.remove")}
                disabled={item.status === "uploading"}
                onClick={() => void remove(item.localId)}
              >
                <X className="size-3.5" />
              </EnterpriseButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function stagingIdsOf(items: ReceiptUploadItem[]): string[] {
  return items
    .filter((item) => item.status === "success" && item.staging)
    .map((item) => item.staging!.id);
}
