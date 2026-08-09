import type { StatusTone } from "@/components/business/status-badge";
import type { ImportJobStatus } from "@/services/import-jobs-service";
import type { MessageKey } from "@/i18n/translate";

export const IMPORT_JOB_STATUS_LABEL_KEY: Record<ImportJobStatus, MessageKey> = {
  DRAFT: "importCenter.status.DRAFT",
  UPLOADING: "importCenter.status.UPLOADING",
  MAPPING: "importCenter.status.MAPPING",
  VALIDATING: "importCenter.status.VALIDATING",
  IMPORTING: "importCenter.status.IMPORTING",
  COMPLETED: "importCenter.status.COMPLETED",
  FAILED: "importCenter.status.FAILED",
  CANCELLED: "importCenter.status.CANCELLED",
};

export const IMPORT_JOB_STATUS_TONE: Record<ImportJobStatus, StatusTone> = {
  DRAFT: "neutral",
  UPLOADING: "info",
  MAPPING: "info",
  VALIDATING: "info",
  IMPORTING: "warning",
  COMPLETED: "success",
  FAILED: "destructive",
  CANCELLED: "neutral",
};
