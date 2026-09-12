"use client";

import { useRef, useState } from "react";
import { Download, Eye, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { AttachmentPreviewDialog } from "@/components/business/attachment-preview-dialog";
import { useLocale } from "@/providers/locale-provider";
import { storeOrdersService, type ShipmentAttachmentRow } from "@/services/store-orders-service";
import { attachmentsService } from "@/services/attachments-service";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = ".jpg,.jpeg,.png,.webp,.pdf";

/**
 * Compact per-row attachment action (Part 6/13/14) — shipping operational
 * evidence (carrier receipt/waybill/handover proof) on the current
 * shipment, never confused with a Payment Receipt. Reuses the generic
 * Attachment staging/download pipeline and `AttachmentPreviewDialog`.
 */
export function ShipmentAttachmentsPopover({
  storeOrderId,
  count,
  canEdit,
  onCountChanged,
}: {
  storeOrderId: string;
  count: number;
  canEdit: boolean;
  onCountChanged: (nextCount: number) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ShipmentAttachmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ShipmentAttachmentRow | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [preview, setPreview] = useState<{
    title: string;
    mimeType: string | null;
    blob: Blob;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const rows = await storeOrdersService.shipments.attachments.list(storeOrderId);
      setItems(rows);
      onCountChanged(rows.length);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      await storeOrdersService.shipments.attachments.upload(storeOrderId, file);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("shipping.quickEdit.uploadFailed"));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleView = async (item: ShipmentAttachmentRow) => {
    if (!item.attachmentId) {
      window.open(item.fileUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const blob = await attachmentsService.download(item.attachmentId);
      setPreview({ title: item.fileName ?? "attachment", mimeType: item.mimeType, blob });
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("shipping.quickEdit.downloadFailed"),
      );
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setIsRemoving(true);
    try {
      await storeOrdersService.shipments.attachments.remove(storeOrderId, removeTarget.id);
      setRemoveTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("shipping.quickEdit.removeFailed"));
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
        <PopoverTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("relative size-8", count > 0 && "text-primary")}
            title={t("shipping.quickEdit.attachmentsTooltip")}
            aria-label={t("shipping.quickEdit.attachmentsTooltip")}
          >
            <Paperclip className="size-4" />
            {count > 0 && (
              <EnterpriseBadge
                variant="secondary"
                className="absolute -end-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[0.65rem] leading-none"
              >
                {count}
              </EnterpriseBadge>
            )}
          </EnterpriseButton>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <PopoverHeader>
            <PopoverTitle>{t("shipping.quickEdit.attachmentsTitle")}</PopoverTitle>
            <PopoverDescription>{t("shipping.quickEdit.acceptedFileTypes")}</PopoverDescription>
          </PopoverHeader>

          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-2 text-center text-caption text-muted-foreground">
                {t("shipping.quickEdit.attachmentsEmpty")}
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xs px-1.5 py-1.5 hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 truncate text-caption">
                    {item.fileName ?? t("shipping.quickEdit.view")}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <EnterpriseButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={t("shipping.quickEdit.view")}
                      onClick={() => void handleView(item)}
                    >
                      {item.mimeType === "application/pdf" ? (
                        <Download className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </EnterpriseButton>
                    {canEdit && (
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 text-destructive hover:text-destructive"
                        aria-label={t("shipping.quickEdit.remove")}
                        onClick={() => setRemoveTarget(item)}
                      >
                        <Trash2 className="size-3.5" />
                      </EnterpriseButton>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                }}
              />
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {t("shipping.quickEdit.uploadAttachment")}
              </EnterpriseButton>
            </>
          )}
        </PopoverContent>
      </Popover>

      <ConfirmationDialog
        open={!!removeTarget}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        title={t("shipping.quickEdit.removeConfirmTitle")}
        description={t("shipping.quickEdit.removeConfirmDescription")}
        tone="destructive"
        confirmLabel={t("shipping.quickEdit.remove")}
        isConfirming={isRemoving}
        onConfirm={() => void handleRemove()}
      />

      <AttachmentPreviewDialog
        open={!!preview}
        onOpenChange={(next) => !next && setPreview(null)}
        title={preview?.title ?? ""}
        mimeType={preview?.mimeType ?? null}
        blob={preview?.blob ?? null}
      />
    </>
  );
}
