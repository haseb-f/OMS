"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { AttachmentPreviewDialog } from "@/components/business/attachment-preview-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { agentPortalService, type PortalFile } from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { formatFileSize } from "@/lib/format-file-size";
import { reportApiError } from "@/lib/toast";

/**
 * Evidence files (payment proof, payout evidence) served by the portal's
 * own authorized route (`/agent-portal/attachments/:id/file`). Downloaded
 * with the session's auth header and shown in the shared preview dialog —
 * never a bare link that would open without authorization.
 */
export function PortalFileList({ files, emptyText }: { files: PortalFile[]; emptyText?: string }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<{ title: string; mimeType: string; blob: Blob } | null>(
    null,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const open = async (file: PortalFile) => {
    setLoadingId(file.attachmentId);
    try {
      const blob = await agentPortalService.downloadFile(file.fileUrl);
      setPreview({ title: file.fileName, mimeType: file.mimeType || blob.type, blob });
    } catch (error) {
      reportApiError(error, "agentPortal.common.downloadFailed");
    } finally {
      setLoadingId(null);
    }
  };

  if (files.length === 0) {
    return emptyText ? <p className="text-caption text-muted-foreground">{emptyText}</p> : null;
  }

  return (
    <>
      <ul className="flex flex-wrap gap-1.5">
        {files.map((file) => (
          <li key={file.attachmentId} className="min-w-0 max-w-full">
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              className="max-w-full"
              disabled={loadingId === file.attachmentId}
              onClick={() => void open(file)}
              title={t("agentPortal.common.download")}
            >
              <Paperclip />
              <span className="truncate">{file.fileName}</span>
              <span className="num text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>
            </EnterpriseButton>
          </li>
        ))}
      </ul>
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
