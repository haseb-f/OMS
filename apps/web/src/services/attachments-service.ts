import { apiClient } from "./api-client";

export interface StagingAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: "STAGING";
  createdAt: string;
}

export interface PaymentAttachmentRow {
  id: string;
  attachmentId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  source: "UPLOAD" | "URL";
  fileUrl: string;
  uploadedBy: string | null;
  createdAt: string;
}

export const attachmentsService = {
  uploadStaging: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<StagingAttachment>("/attachments/staging", form);
  },
  discardStaging: (id: string) => apiClient.delete<{ id: string }>(`/attachments/staging/${id}`),
  download: (attachmentId: string) => apiClient.getBlob(`/attachments/${attachmentId}/file`),
  listForPayment: (paymentId: string) =>
    apiClient.get<PaymentAttachmentRow[]>(`/payments/${paymentId}/attachments`),
  attachStaging: (paymentId: string, stagingAttachmentIds: string[]) =>
    apiClient.post(`/payments/${paymentId}/attachments/from-staging`, {
      stagingAttachmentIds,
    }),
  uploadForPayment: (paymentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm(`/payments/${paymentId}/attachments/upload`, form);
  },
  archive: (paymentId: string, attachmentId: string, reason?: string) =>
    apiClient.post(`/payments/${paymentId}/attachments/${attachmentId}/archive`, { reason }),
};
