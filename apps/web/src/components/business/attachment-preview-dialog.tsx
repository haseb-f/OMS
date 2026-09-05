"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { isImageAttachmentMime } from "@/lib/order-attachments";

export function AttachmentPreviewDialog({
  open,
  onOpenChange,
  title,
  mimeType,
  blob,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mimeType: string | null;
  blob: Blob | null;
}) {
  const { t } = useLocale();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  const isImage = isImageAttachmentMime(mimeType ?? blob?.type);
  const isPdf = (mimeType ?? blob?.type) === "application/pdf";

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={title}
      footer={() => (
        <div className="flex w-full flex-wrap justify-end gap-2">
          {url ? (
            <>
              <EnterpriseButton variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" />
                  {t("storeOrders.detail.receipts.open")}
                </a>
              </EnterpriseButton>
              <EnterpriseButton variant="outline" asChild>
                <a href={url} download={title}>
                  <Download className="size-3.5" />
                  {t("storeOrders.detail.receipts.download")}
                </a>
              </EnterpriseButton>
            </>
          ) : null}
        </div>
      )}
    >
      <div className="flex min-h-64 items-center justify-center rounded-md border border-border bg-muted/20 p-3">
        {!url ? (
          <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={title} className="max-h-[70vh] max-w-full object-contain" />
        ) : isPdf ? (
          <iframe title={title} src={url} className="h-[70vh] w-full rounded-sm border-0" />
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("storeOrders.detail.receipts.previewUnavailable")}
          </p>
        )}
      </div>
    </EnterpriseModal>
  );
}
